-- Migration: 20260503000090_decouple_time_rates_from_project_members.sql
-- Date: May 3, 2026
-- Description:
--   Slice 3b prep: decouple `project_member_time_rates.project_member_id`
--   from `project_members.id` so the legacy `project_members` table can be
--   dropped without cascading away the rate rows.
--
--   The `project_member_id` column is retained as an opaque identifier (the
--   frontend uses it as a per-user URL param). Going forward it's set equal
--   to `member_user_id` on every new rate, and existing rows are backfilled
--   to align. The FK constraint is dropped, and we add an explicit index
--   so the column remains efficient to query.

-- 1. Drop the FK constraint.
ALTER TABLE public.project_member_time_rates
  DROP CONSTRAINT IF EXISTS project_member_time_rates_project_member_id_fkey;

-- 2. Backfill existing rows: align project_member_id with member_user_id.
--    For dev environments this is just bookkeeping; values are now opaque.
UPDATE public.project_member_time_rates
SET project_member_id = member_user_id
WHERE project_member_id IS NOT NULL
  AND project_member_id <> member_user_id;

-- 3. Index to keep lookups by project_member_id efficient (frontend uses
--    it as a stable per-member key for team-logs URLs).
CREATE INDEX IF NOT EXISTS idx_project_member_time_rates_project_member_id
  ON public.project_member_time_rates (project_member_id);

COMMENT ON COLUMN public.project_member_time_rates.project_member_id IS 'Opaque per-user identifier (set equal to member_user_id since slice 3b). Retained to keep frontend URLs stable. Was previously a FK to project_members.id.';
