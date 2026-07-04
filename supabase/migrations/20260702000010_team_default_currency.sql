-- Team-level default currency for time tracking.
--
-- Adds teams.default_currency (USD/CAD/PHP), used as the fallback when a member
-- has no per-project rate currency set. Then switches the Prodigitality Services
-- Inc. team to PHP and relabels its existing logs/rates to PHP.
--
-- NOTE: the backfill RELABELS currency without converting amounts (the numeric
-- rate_snapshot values are unchanged). This is intentional for this PH-focused
-- team, whose non-PHP entries were test data. It is scoped to that one team, so
-- it is a no-op in any environment where the team does not exist.

-- 1. Schema: default currency on teams (constrained to the supported set).
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'USD';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_default_currency_check'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_default_currency_check
      CHECK (default_currency IN ('USD', 'CAD', 'PHP'));
  END IF;
END $$;

COMMENT ON COLUMN public.teams.default_currency IS
  'Default currency for time tracking; fallback when a per-project rate has no currency. One of USD/CAD/PHP.';

-- 2. Switch the Prodigitality Services Inc. team to PHP (team-scoped, no-op elsewhere).
DO $$
DECLARE
  v_team_id uuid := 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba';
BEGIN
  IF EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_id) THEN
    UPDATE public.teams
      SET default_currency = 'PHP'
      WHERE id = v_team_id;

    UPDATE public.team_member_rates
      SET currency = 'PHP'
      WHERE team_id = v_team_id
        AND currency IS DISTINCT FROM 'PHP';

    UPDATE public.task_time_logs
      SET currency_snapshot = 'PHP'
      WHERE team_id = v_team_id
        AND currency_snapshot IS DISTINCT FROM 'PHP';
  END IF;
END $$;
