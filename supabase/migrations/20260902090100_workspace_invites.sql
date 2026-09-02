-- Email-based workspace invites. Structural mirror of team_invites
-- (20260507000060), which is itself modelled on project_invites:
--   - both invitee_id (resolved profile) and invitee_email (unresolved)
--   - reconciliation trigger on profiles INSERT
--   - notification_type 'workspace_invite_received'
--
-- Differences from the 2026-05 team version: the RLS policies call the
-- can_manage_workspace helper instead of inlining EXISTS clauses. The helper
-- pattern postdates team_invites and is what this schema standardized on after
-- its RLS-recursion incidents.
--
-- The deep link targets /teams/me/invites, which is the combined received-invites
-- inbox (team + project + workspace) rather than a workspace-specific page.

BEGIN;

-- 1. Table -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  CONSTRAINT workspace_invites_target_chk
    CHECK (invitee_id IS NOT NULL OR invitee_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id
  ON public.workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_invitee_id
  ON public.workspace_invites(invitee_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_invitee_email
  ON public.workspace_invites(invitee_email);

-- One pending invite per (workspace, email). Re-inviting refreshes the row
-- in place.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_pending_email_uniq
  ON public.workspace_invites (workspace_id, lower(invitee_email))
  WHERE status = 'pending' AND invitee_email IS NOT NULL;

-- One pending invite per (workspace, invitee_id) — covers the case where
-- the invitee was matched to an existing profile at invite time.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_pending_user_uniq
  ON public.workspace_invites (workspace_id, invitee_id)
  WHERE status = 'pending' AND invitee_id IS NOT NULL;

COMMENT ON TABLE public.workspace_invites IS
  'Email-based workspace membership invites. Mirrors team_invites.';

-- 2. updated_at trigger -----------------------------------------------------

DROP TRIGGER IF EXISTS trg_workspace_invites_updated_at ON public.workspace_invites;
CREATE TRIGGER trg_workspace_invites_updated_at
BEFORE UPDATE ON public.workspace_invites
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RLS --------------------------------------------------------------------

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- SELECT: the invitee, or a workspace owner/admin.
DROP POLICY IF EXISTS workspace_invites_select ON public.workspace_invites;
CREATE POLICY workspace_invites_select ON public.workspace_invites
FOR SELECT USING (
  invitee_id = auth.uid()
  OR public.can_manage_workspace(workspace_id, auth.uid())
);

-- UPDATE: the invitee may flip status (accept/decline); owners/admins may flip
-- to 'cancelled'. The API performs the actual authz; RLS just prevents
-- arbitrary clients from mutating others' rows.
DROP POLICY IF EXISTS workspace_invites_update ON public.workspace_invites;
CREATE POLICY workspace_invites_update ON public.workspace_invites
FOR UPDATE USING (
  invitee_id = auth.uid()
  OR public.can_manage_workspace(workspace_id, auth.uid())
)
WITH CHECK (
  invitee_id = auth.uid()
  OR public.can_manage_workspace(workspace_id, auth.uid())
);

-- INSERT is intentionally service-role only; the API enforces authz.

REVOKE ALL ON TABLE public.workspace_invites FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.workspace_invites TO authenticated;
GRANT ALL ON TABLE public.workspace_invites TO service_role;

-- 4. Notification type seed -----------------------------------------------
-- Not email-eligible: WorkspacesService sends the invite email itself, exactly
-- as TeamsService does. Marking it eligible here would send two emails.

INSERT INTO public.notification_types (name, category, priority)
VALUES ('workspace_invite_received', 'specific', 'high')
ON CONFLICT (name) DO NOTHING;

-- 5. Reconciliation trigger on profile insert -----------------------------
-- When an invited email finally registers, attach their new profile id to the
-- pending invite and notify them.

CREATE OR REPLACE FUNCTION public.handle_profile_workspace_invites_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notification_type_id uuid;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.workspace_invites wi
  SET
    invitee_id = NEW.id,
    updated_at = now()
  WHERE wi.invitee_id IS NULL
    AND wi.invitee_email IS NOT NULL
    AND lower(wi.invitee_email) = lower(NEW.email)
    AND wi.status = 'pending';

  SELECT id INTO v_notification_type_id
  FROM public.notification_types
  WHERE name = 'workspace_invite_received'
  LIMIT 1;

  IF v_notification_type_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, project_id, type_id, actor_id, content, link_url)
    SELECT
      NEW.id,
      NULL,
      v_notification_type_id,
      wi.invited_by,
      jsonb_build_object(
        'invite_id', wi.id,
        'workspace_id', wi.workspace_id,
        'invited_role', wi.role,
        'message', wi.message
      ),
      '/teams/me/invites'
    FROM public.workspace_invites wi
    WHERE wi.invitee_id = NEW.id
      AND wi.status = 'pending'
      AND wi.created_at >= now() - interval '1 minute'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.id
          AND n.type_id = v_notification_type_id
          AND n.content ->> 'invite_id' = wi.id::text
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_reconcile_workspace_invites ON public.profiles;
CREATE TRIGGER trg_profiles_reconcile_workspace_invites
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_workspace_invites_reconciliation();

COMMIT;
