-- ---------------------------------------------------------------------
-- "Invite a team" — bring a team you are NOT on onto your project.
--
-- The gap this closes: attaching a team (project_teams) requires listing
-- it first, and GET /api/teams only ever returns teams the caller owns or
-- belongs to. A project owner therefore could not bring in an outside
-- team at all — there was no path and, more importantly, no consent step
-- for the people being brought in.
--
-- Shape: the invite targets a PERSON by email, not a team id. The inviter
-- cannot see other people's teams (nothing on this platform exposes a team
-- to someone outside it, and adding a cross-tenant team search to serve one
-- dialog would leak every org's name and roster). So team_id is null while
-- pending and is filled in by the invitee at accept time, when they choose
-- which of their teams to bring; team_name_hint carries whatever the
-- inviter typed so the recipient knows which team was meant.
--
-- Authority is split deliberately:
--   * the INVITER owns the project, so they set member_role (the role the
--     incoming members land on) and make_primary;
--   * the INVITEE owns the team, so they choose the team and which of its
--     members actually join.
--
-- Reference migrations (this mirrors them closely — read them together):
--   * 20260507000060_team_invites.sql       (email invite + reconciler)
--   * 20260507000010_teams_and_curation.sql (project_teams, curation)
-- ---------------------------------------------------------------------

BEGIN;

-- 1. Table -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invitee_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_email text,
  -- Null while pending: the invitee names the team when they accept.
  -- ON DELETE SET NULL rather than CASCADE — a settled invite is an audit
  -- record of what happened, and deleting the team later must not erase it.
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  team_name_hint text,
  -- Role the curated members land on, chosen by the inviter. 'owner' is
  -- excluded: an invitation must not be able to hand over the project.
  member_role share_role NOT NULL DEFAULT 'editor'
    CHECK (member_role <> 'owner'),
  make_primary boolean NOT NULL DEFAULT false,
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','cancelled')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_team_invites_target_chk
    CHECK (invitee_id IS NOT NULL OR invitee_email IS NOT NULL),
  -- An accepted invite must say which team was brought in, or the row
  -- cannot explain the project_teams attachment it produced.
  CONSTRAINT project_team_invites_accepted_has_team_chk
    CHECK (status <> 'accepted' OR team_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_project_team_invites_project
  ON public.project_team_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_project_team_invites_invitee
  ON public.project_team_invites(invitee_id);
CREATE INDEX IF NOT EXISTS idx_project_team_invites_invitee_email
  ON public.project_team_invites(invitee_email);

-- One pending invite per (project, email) and per (project, invitee).
-- Re-inviting refreshes the row in place, exactly as team_invites does.
CREATE UNIQUE INDEX IF NOT EXISTS project_team_invites_pending_email_uniq
  ON public.project_team_invites (project_id, lower(invitee_email))
  WHERE status = 'pending' AND invitee_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_team_invites_pending_user_uniq
  ON public.project_team_invites (project_id, invitee_id)
  WHERE status = 'pending' AND invitee_id IS NOT NULL;

COMMENT ON TABLE public.project_team_invites IS
  'Invitation asking someone to bring one of THEIR teams onto a project. Mirrors team_invites; team_id is null until the invitee picks a team at accept time.';
COMMENT ON COLUMN public.project_team_invites.member_role IS
  'Role the curated members get on project_access. Set by the inviter (who owns the project), never by the accepter. Never owner.';
COMMENT ON COLUMN public.project_team_invites.team_name_hint IS
  'Free text the inviter typed to say which team they meant. Never resolved to a team id server-side — teams are not searchable across tenants.';

-- 2. updated_at trigger -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_project_team_invites_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_project_team_invites_updated_at
  ON public.project_team_invites;
CREATE TRIGGER trg_project_team_invites_updated_at
BEFORE UPDATE ON public.project_team_invites
FOR EACH ROW
EXECUTE FUNCTION public.handle_project_team_invites_updated_at();

-- 3. RLS --------------------------------------------------------------------
--
-- Project-side visibility goes through get_user_project_role(), which is
-- SECURITY DEFINER over project_access. Inlining a project_access EXISTS
-- here instead would be the shape behind this schema's past RLS-recursion
-- incidents, so it is deliberately a function call.

ALTER TABLE public.project_team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_team_invites_select ON public.project_team_invites;
CREATE POLICY project_team_invites_select ON public.project_team_invites
FOR SELECT USING (
  invitee_id = auth.uid()
  OR public.get_user_project_role(auth.uid(), project_id)
       IN ('owner','admin')
);

-- The invitee flips status to accepted/declined; project owners/admins flip
-- it to cancelled. The API does the real authorization — this only stops a
-- direct PostgREST call from mutating someone else's row.
DROP POLICY IF EXISTS project_team_invites_update ON public.project_team_invites;
CREATE POLICY project_team_invites_update ON public.project_team_invites
FOR UPDATE USING (
  invitee_id = auth.uid()
  OR public.get_user_project_role(auth.uid(), project_id)
       IN ('owner','admin')
)
WITH CHECK (
  invitee_id = auth.uid()
  OR public.get_user_project_role(auth.uid(), project_id)
       IN ('owner','admin')
);

-- INSERT is service-role only, matching team_invites.

-- 4. Notification types -----------------------------------------------------

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('project_team_invite_received',  'specific', 'high'),
  ('project_team_invite_responded', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;

-- 5. Reconciliation on profile insert --------------------------------------
--
-- Someone invited at an address with no Proyekto account yet: when they sign
-- up with it, bind the invite to the new profile and materialise the in-app
-- notification, so the invitation really is waiting for them. Separate
-- function and trigger from handle_profile_team_invites_reconciliation --
-- profiles carries one AFTER INSERT trigger per invite kind.
--
-- The link path is hardcoded here for the same reason it is in the team
-- invite reconciler: a shipped SQL function body cannot import the
-- TypeScript constant. It must stay in step with TEAM_INVITES_PATH in
-- backend/src/modules/execution/teams/team-invites-path.ts. The ?inviteId=
-- suffix matches what the service and the email build, so a reader holding
-- several invitations lands on the right card either way.

CREATE OR REPLACE FUNCTION public.handle_profile_project_team_invites_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_notification_type_id uuid;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.project_team_invites pti
  SET
    invitee_id = NEW.id,
    updated_at = now()
  WHERE pti.invitee_id IS NULL
    AND pti.invitee_email IS NOT NULL
    AND lower(pti.invitee_email) = lower(NEW.email)
    AND pti.status = 'pending';

  SELECT id INTO v_notification_type_id
  FROM public.notification_types
  WHERE name = 'project_team_invite_received'
  LIMIT 1;

  IF v_notification_type_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, project_id, type_id, actor_id, content, link_url)
    SELECT
      NEW.id,
      pti.project_id,
      v_notification_type_id,
      pti.invited_by,
      jsonb_build_object(
        'invite_id', pti.id,
        'project_id', pti.project_id,
        'team_name_hint', pti.team_name_hint,
        'member_role', pti.member_role,
        'message', pti.message
      ),
      '/teams/me/invites?inviteId=' || pti.id::text
    FROM public.project_team_invites pti
    WHERE pti.invitee_id = NEW.id
      AND pti.status = 'pending'
      AND pti.created_at >= now() - interval '1 minute'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.id
          AND n.type_id = v_notification_type_id
          AND n.content ->> 'invite_id' = pti.id::text
      );
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_profiles_reconcile_project_team_invites
  ON public.profiles;
CREATE TRIGGER trg_profiles_reconcile_project_team_invites
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_project_team_invites_reconciliation();

COMMIT;
