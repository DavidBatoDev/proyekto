-- Give teams and projects an organizational home.
--
-- Deliberately nullable, and staying that way:
--   * ON DELETE SET NULL is the only sane behaviour when a workspace is
--     deleted — marketplace projects, contracts, and invoices must survive it,
--     so the column can legitimately go NULL at any time. NOT NULL would force
--     RESTRICT plus a reassignment flow nobody asked for.
--   * Guest-owned projects have no workspace until the guest converts.
--   * It is classification metadata, so a NULL is a display gap, not a hole in
--     authorization.
-- "New writes always carry one" is enforced in the backend write paths
-- (WorkspacesService.resolveWorkspaceForWrite), not by a constraint.

BEGIN;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES public.workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_teams_workspace_id
  ON public.teams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace_id
  ON public.projects(workspace_id);

COMMENT ON COLUMN public.teams.workspace_id IS
  'Organizational/billing home of the team. NEVER an authorization source; team access remains teams.owner_id + team_members.';
COMMENT ON COLUMN public.projects.workspace_id IS
  'Organizational/billing home of the project. NEVER an authorization source; project_access remains the only project authorization path.';

COMMIT;
