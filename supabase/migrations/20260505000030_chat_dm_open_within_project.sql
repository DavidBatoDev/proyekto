-- Migration: 20260505000030_chat_dm_open_within_project.sql
-- Date: May 5, 2026
-- Description:
--   Drops the legacy persona-DM matrix from project_chat_can_dm. Within an
--   active project, any member should be able to DM any other member —
--   the matrix (client ↔ consultant only, freelancer ↔ consultant+freelancer)
--   was a marketplace-mediation concern that doesn't apply once people are
--   collaborators on a project. It also broke personal-workspace owners
--   (bucketed as 'client') from DMing their invited team (bucketed as
--   'freelancer'), which is the expected default behavior.
--
--   New rule:
--     - Both parties must be project members (project_chat_is_member).
--     - Self-DMs blocked.
--     - That's it.

CREATE OR REPLACE FUNCTION public.project_chat_can_dm(
  target_project_id uuid,
  actor_user_id uuid,
  recipient_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF actor_user_id IS NULL OR recipient_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF actor_user_id = recipient_user_id THEN
    RETURN false;
  END IF;

  IF NOT public.project_chat_is_member(target_project_id, actor_user_id) THEN
    RETURN false;
  END IF;

  IF NOT public.project_chat_is_member(target_project_id, recipient_user_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
