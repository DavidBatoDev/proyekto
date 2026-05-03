-- Migration: 20260503000020_add_personal_workspace_to_projects.sql
-- Date: May 3, 2026
-- Description:
--   Adds an `is_personal_workspace` flag to projects so signup can
--   auto-provision a Linear-style personal workspace per user. A partial
--   unique index enforces the "one personal workspace per user" invariant
--   at the DB level so PersonalWorkspaceService.provision() can be naively
--   idempotent.

ALTER TABLE public.projects
ADD COLUMN is_personal_workspace boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX one_personal_workspace_per_user
ON public.projects (client_id)
WHERE is_personal_workspace = true;

COMMENT ON COLUMN public.projects.is_personal_workspace IS 'True for the auto-provisioned per-user workspace created on signup. Always client_id = owner_user_id, consultant_id = NULL. At most one row per user (enforced by partial unique index).';
