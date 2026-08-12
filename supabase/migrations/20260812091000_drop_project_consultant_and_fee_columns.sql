-- Deploy gate: apply only after the consultant_id-free backend is deployed.
-- Production snapshot before authoring: all 32 project rows retain the default
-- platform_fee_percent=10.00 and consultant_fee_percent=15.00 values, and both
-- fee columns have zero application readers. Durable invoice facts already carry
-- their composed monetary snapshots, so no fee backfill is required.

DROP INDEX IF EXISTS public.idx_projects_consultant;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_consultant_id_fkey;

ALTER TABLE public.projects
  DROP COLUMN IF EXISTS consultant_id,
  DROP COLUMN IF EXISTS platform_fee_percent,
  DROP COLUMN IF EXISTS consultant_fee_percent;
