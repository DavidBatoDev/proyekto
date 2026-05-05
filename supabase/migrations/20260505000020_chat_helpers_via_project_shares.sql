-- Migration: 20260505000020_chat_helpers_via_project_shares.sql
-- Date: May 5, 2026
-- Description:
--   Fixes the project chat RLS path after the project_members → project_shares
--   migration. Two SECURITY DEFINER helpers — project_chat_is_member and
--   project_chat_role — still pointed at the dropped public.project_members
--   table, so any chat read/write that ran the RLS policies hit
--   "relation project_members does not exist".
--
--   Both helpers now consult project_shares:
--     - is_member: a row in project_shares for (project, user) means access.
--     - role: maps the share row to the chat-flavor enum
--             ('consultant' | 'client' | 'freelancer') used by
--             project_chat_can_dm. Origin wins over role; falls back to the
--             projects.client_id/consultant_id columns for legacy rows.

CREATE OR REPLACE FUNCTION public.project_chat_is_member(
  target_project_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = target_project_id
      AND (p.client_id = target_user_id OR p.consultant_id = target_user_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_shares ps
    WHERE ps.project_id = target_project_id
      AND ps.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.project_chat_role(
  target_project_id uuid,
  target_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  project_row record;
  share_origin text;
BEGIN
  -- Legacy origin-pointer columns. project_shares is the authoritative
  -- membership table now, but keeping these checks first avoids returning
  -- NULL during the brief window between project creation and share-row
  -- insertion (defense in depth — the share row should always be there).
  SELECT p.client_id, p.consultant_id
  INTO project_row
  FROM public.projects p
  WHERE p.id = target_project_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF target_user_id = project_row.consultant_id THEN
    RETURN 'consultant';
  END IF;

  IF target_user_id = project_row.client_id THEN
    RETURN 'client';
  END IF;

  -- Fall back to project_shares. We bucket by `origin` (which the slice 2
  -- migrations populate at grant time), defaulting to 'freelancer' when
  -- origin is invited / personal_workspace / NULL.
  SELECT ps.origin
  INTO share_origin
  FROM public.project_shares ps
  WHERE ps.project_id = target_project_id
    AND ps.user_id = target_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF share_origin = 'consultant' THEN
    RETURN 'consultant';
  END IF;

  IF share_origin IN ('client', 'personal_workspace') THEN
    RETURN 'client';
  END IF;

  RETURN 'freelancer';
END;
$$;
