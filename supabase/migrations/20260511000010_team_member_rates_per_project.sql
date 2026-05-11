-- Migration: 20260511000010_team_member_rates_per_project.sql
--
-- Purpose:
--   Scope team_member_rates to a specific project. Previously a single
--   active rate per (team, user) applied team-wide; now a member can hold
--   multiple concurrent active rates so long as each targets a different
--   attached project. "All projects" in the UI fans out at save time into
--   one row per attached project.
--
--   Uniqueness becomes (team_id, user_id, project_id) WHERE end_date IS NULL.
--   resolveTeamRate must now match on project_id; no fallback row.

-- 1) Add the column (nullable for backfill, tightened to NOT NULL at the end).
ALTER TABLE public.team_member_rates
  ADD COLUMN project_id uuid;

-- 2) FK to project_teams so a rate exists only for a project actually
--    attached to the team; cascades when the project is detached.
ALTER TABLE public.team_member_rates
  ADD CONSTRAINT team_member_rates_project_team_fk
    FOREIGN KEY (project_id, team_id)
    REFERENCES public.project_teams (project_id, team_id)
    ON DELETE CASCADE;

-- 3) Backfill: each pre-existing row applied team-wide. Fan it out into
--    one row per currently-attached project. Stage in a temp table first
--    so the UPDATE (step 3b) does not invalidate the source rows for the
--    INSERT (step 3c).
CREATE TEMP TABLE _rate_backfill ON COMMIT DROP AS
SELECT r.id            AS old_id,
       r.team_id,
       r.user_id,
       pt.project_id,
       r.hourly_rate,
       r.currency,
       r.custom_id,
       r.start_date,
       r.end_date,
       r.created_at,
       r.updated_at,
       row_number() OVER (PARTITION BY r.id ORDER BY pt.attached_at) AS rn
  FROM public.team_member_rates r
  JOIN public.project_teams pt ON pt.team_id = r.team_id
 WHERE r.project_id IS NULL;

-- 3b) First project -> reuse existing row id (cheap UPDATE).
UPDATE public.team_member_rates r
   SET project_id = b.project_id
  FROM _rate_backfill b
 WHERE r.id = b.old_id
   AND b.rn = 1;

-- 3c) Remaining projects -> INSERT clones.
INSERT INTO public.team_member_rates
  (team_id, user_id, project_id, hourly_rate, currency, custom_id,
   start_date, end_date, created_at, updated_at)
SELECT team_id, user_id, project_id, hourly_rate, currency, custom_id,
       start_date, end_date, created_at, updated_at
  FROM _rate_backfill
 WHERE rn > 1;

-- 4) Drop orphan rows whose teams have no attached projects (cannot be scoped).
DO $$
DECLARE orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
    FROM public.team_member_rates WHERE project_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE NOTICE 'Dropping % team_member_rates rows whose teams have no attached projects', orphan_count;
  END IF;
END $$;
DELETE FROM public.team_member_rates WHERE project_id IS NULL;

-- 5) Tighten the column.
ALTER TABLE public.team_member_rates
  ALTER COLUMN project_id SET NOT NULL;

-- 6) Replace the partial unique index with a project-scoped one.
DROP INDEX IF EXISTS public.team_member_rates_one_active;
CREATE UNIQUE INDEX team_member_rates_one_active_per_project
  ON public.team_member_rates (team_id, user_id, project_id)
  WHERE end_date IS NULL;

-- 7) Refresh the secondary index to include project_id.
DROP INDEX IF EXISTS public.team_member_rates_member_idx;
CREATE INDEX team_member_rates_member_idx
  ON public.team_member_rates (team_id, user_id, project_id, start_date DESC);

COMMENT ON TABLE public.team_member_rates IS
  'Rate history per (team, user, project). At most one row per (team, user, project) may have end_date IS NULL (the "active" rate for that project).';
