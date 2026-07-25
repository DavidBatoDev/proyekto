-- Migration: 20260724100020_member_rate_types.sql
-- Date: July 24, 2026
-- Description:
--   Member compensation can be hourly OR fixed per period, depending on the
--   project. Until now `team_member_rates` only expressed an hourly rate, so a
--   member on a flat monthly retainer had no representation.
--
--   Fixed members still LOG TIME (for client billing, hour caps, and internal
--   visibility) but their cost is the fixed amount, not duration x rate. To keep
--   historical cost immutable — the same reason `rate_snapshot` exists —
--   `task_time_logs` gains `rate_type_snapshot`, stamped at log creation.
--   Cost rollups branch on the SNAPSHOT, never on the member's current rate row.

ALTER TABLE public.team_member_rates
  ADD COLUMN IF NOT EXISTS rate_type text NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS fixed_amount numeric,
  ADD COLUMN IF NOT EXISTS fixed_period text NOT NULL DEFAULT 'month';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_member_rates_rate_type_check'
  ) THEN
    ALTER TABLE public.team_member_rates
      ADD CONSTRAINT team_member_rates_rate_type_check
      CHECK (rate_type IN ('hourly', 'fixed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_member_rates_fixed_period_check'
  ) THEN
    ALTER TABLE public.team_member_rates
      ADD CONSTRAINT team_member_rates_fixed_period_check
      CHECK (fixed_period IN ('month', 'semi_month'));
  END IF;

  -- A fixed-rate row is meaningless without an amount. Hourly rows may leave
  -- fixed_amount NULL.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_member_rates_fixed_amount_check'
  ) THEN
    ALTER TABLE public.team_member_rates
      ADD CONSTRAINT team_member_rates_fixed_amount_check
      CHECK (rate_type <> 'fixed' OR (fixed_amount IS NOT NULL AND fixed_amount > 0));
  END IF;
END
$$;

ALTER TABLE public.task_time_logs
  ADD COLUMN IF NOT EXISTS rate_type_snapshot text NOT NULL DEFAULT 'hourly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_time_logs_rate_type_snapshot_check'
  ) THEN
    ALTER TABLE public.task_time_logs
      ADD CONSTRAINT task_time_logs_rate_type_snapshot_check
      CHECK (rate_type_snapshot IN ('hourly', 'fixed'));
  END IF;
END
$$;

-- Cost rollups filter by (project, rate_type_snapshot, status) over a date
-- window; this supports the hourly-cost aggregate without scanning fixed rows.
CREATE INDEX IF NOT EXISTS idx_task_time_logs_cost_rollup
  ON public.task_time_logs(project_id, rate_type_snapshot, started_at)
  WHERE status IN ('approved', 'paid');
