-- ---------------------------------------------------------------------
-- Email-based team invites. Mirrors project_invites:
--   - both invitee_id (resolved profile) and invitee_email (unresolved)
--   - reconciliation trigger on profiles INSERT
--   - notification_type 'team_invite_received'
--
-- Reference migrations:
--   * supabase/migrations/20260303221000_freelancer_marketplace.sql (project_invites create)
--   * supabase/migrations/20260304133000_project_invites_email_flow.sql (email + reconcile)
-- ---------------------------------------------------------------------

BEGIN;

-- 1. Table -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invitee_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_email text,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner','admin','member')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','cancelled')),
  message text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_invites_target_chk
    CHECK (invitee_id IS NOT NULL OR invitee_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team_id
  ON public.team_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_invitee_id
  ON public.team_invites(invitee_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_invitee_email
  ON public.team_invites(invitee_email);

-- One pending invite per (team, email). Re-inviting refreshes the row
-- in place. Mirrors project_invites_project_email_unique behavior.
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_pending_email_uniq
  ON public.team_invites (team_id, lower(invitee_email))
  WHERE status = 'pending' AND invitee_email IS NOT NULL;

-- One pending invite per (team, invitee_id) — covers the case where
-- the invitee was matched to an existing profile at invite time.
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_pending_user_uniq
  ON public.team_invites (team_id, invitee_id)
  WHERE status = 'pending' AND invitee_id IS NOT NULL;

COMMENT ON TABLE public.team_invites IS
  'Email-based team membership invites. Mirrors project_invites.';

-- 2. updated_at trigger -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_team_invites_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_invites_updated_at ON public.team_invites;
CREATE TRIGGER trg_team_invites_updated_at
BEFORE UPDATE ON public.team_invites
FOR EACH ROW
EXECUTE FUNCTION public.handle_team_invites_updated_at();

-- 3. RLS --------------------------------------------------------------------

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

-- SELECT: invitee, team owner, or any team member with role admin.
DROP POLICY IF EXISTS team_invites_select ON public.team_invites;
CREATE POLICY team_invites_select ON public.team_invites
FOR SELECT USING (
  invitee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_invites.team_id AND t.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = team_invites.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
  )
);

-- UPDATE: invitee may flip status (accept/decline); team owner / admins
-- may flip to 'cancelled'. The API performs the actual authz; RLS just
-- prevents arbitrary clients from mutating others' rows.
DROP POLICY IF EXISTS team_invites_update ON public.team_invites;
CREATE POLICY team_invites_update ON public.team_invites
FOR UPDATE USING (
  invitee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_invites.team_id AND t.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = team_invites.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
  )
)
WITH CHECK (
  invitee_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_invites.team_id AND t.owner_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = team_invites.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
  )
);

-- INSERT is intentionally service-role only; the API enforces authz.

-- 4. Notification type seed -----------------------------------------------

INSERT INTO public.notification_types (name, category, priority)
VALUES ('team_invite_received', 'specific', 'high')
ON CONFLICT (name) DO NOTHING;

-- 5. Reconciliation trigger on profile insert -----------------------------

CREATE OR REPLACE FUNCTION public.handle_profile_team_invites_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_type_id uuid;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.team_invites ti
  SET
    invitee_id = NEW.id,
    updated_at = now()
  WHERE ti.invitee_id IS NULL
    AND ti.invitee_email IS NOT NULL
    AND lower(ti.invitee_email) = lower(NEW.email)
    AND ti.status = 'pending';

  SELECT id INTO v_notification_type_id
  FROM public.notification_types
  WHERE name = 'team_invite_received'
  LIMIT 1;

  IF v_notification_type_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, project_id, type_id, actor_id, content, link_url)
    SELECT
      NEW.id,
      NULL,
      v_notification_type_id,
      ti.invited_by,
      jsonb_build_object(
        'invite_id', ti.id,
        'team_id', ti.team_id,
        'invited_role', ti.role,
        'message', ti.message
      ),
      '/teams/me/invites'
    FROM public.team_invites ti
    WHERE ti.invitee_id = NEW.id
      AND ti.status = 'pending'
      AND ti.created_at >= now() - interval '1 minute'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.id
          AND n.type_id = v_notification_type_id
          AND n.content ->> 'invite_id' = ti.id::text
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_reconcile_team_invites ON public.profiles;
CREATE TRIGGER trg_profiles_reconcile_team_invites
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_team_invites_reconciliation();

COMMIT;
