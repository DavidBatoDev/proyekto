-- Contraction migration. HOLD: apply to an environment only after the
-- workspace-aware backend revision is serving there, so nothing is still
-- reading personal_workspaces or calling provision_personal_workspace.
--
-- Expand half: 20260902090500_rename_personal_workspaces_to_personal_projects.sql

DROP VIEW IF EXISTS public.personal_workspaces;
DROP FUNCTION IF EXISTS public.provision_personal_workspace(uuid);
