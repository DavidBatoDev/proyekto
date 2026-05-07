-- Migration: 20260507000120_drop_team_role_columns.sql
--
-- Purpose:
--   Make project_access the single source of truth for role + capabilities
--   on a (project, user) pair. Drop role/capabilities from
--   project_team_members and default_role from project_teams. Per-curation
--   role/capability overrides no longer exist; the yoke rule already
--   keeps every row in lockstep, so per-curation values are dead state.
--
-- Trigger change:
--   tg_project_team_members_sync_shares is simplified to DELETE-only.
--   INSERT/UPDATE no longer fan out to project_access — the application
--   service owns the access write because the role at insert time depends
--   on caller context (picked role for new users; existing yoked role
--   for users already on the project).

ALTER TABLE public.project_teams DROP COLUMN IF EXISTS default_role;

ALTER TABLE public.project_team_members
  DROP CONSTRAINT IF EXISTS project_team_members_role_check;
ALTER TABLE public.project_team_members DROP COLUMN IF EXISTS role;
ALTER TABLE public.project_team_members DROP COLUMN IF EXISTS capabilities;

CREATE OR REPLACE FUNCTION public.tg_project_team_members_sync_shares()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_origin text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_origin := 'team:' || OLD.team_id::text;
    DELETE FROM public.project_access
    WHERE project_id = OLD.project_id
      AND user_id    = OLD.user_id
      AND origin     = v_origin;
    RETURN OLD;
  END IF;
  -- INSERT/UPDATE no longer touch project_access. The application
  -- service writes the team-derived row in the same call as the
  -- project_team_members insert.
  RETURN NEW;
END $$;

COMMENT ON TABLE public.project_team_members IS
  'Structural curation marker (no role/caps). project_access is the source of truth for role + capabilities on a (project, user) pair. A trigger fans deletes here out to project_access(origin = team:<team_id>); inserts are paired with a project_access write by the application.';

COMMENT ON TABLE public.project_teams IS
  'Team attachment to a project. is_primary marks the project''s primary team. No default_role: role is picked per-member at attach/curate time and stored on project_access.';
