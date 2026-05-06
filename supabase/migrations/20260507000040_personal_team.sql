-- ---------------------------------------------------------------------
-- Personal team flag: lane-scoped signup auto-provisions one team per
-- consultant marked is_personal=true. Partial unique index mirrors the
-- pattern used for personal workspaces on
-- projects(client_id) WHERE is_personal_workspace=true.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS teams_one_personal_per_owner
  ON public.teams (owner_id) WHERE is_personal;

COMMENT ON COLUMN public.teams.is_personal IS
  'Auto-provisioned on consultant signup. Partial unique index enforces at most one per owner. Regular (non-personal) teams are unaffected.';

COMMIT;
