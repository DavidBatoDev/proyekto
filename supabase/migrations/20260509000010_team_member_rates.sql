-- Migration: 20260509000010_team_member_rates.sql
--
-- Purpose:
--   Extract rate / billing fields from team_members into a dedicated
--   team_member_rates table that supports rate history.
--
--   Rationale: team_members conflated two concerns — team identity
--   (role, position) and pay (hourly_rate + window). One row per
--   member meant raises overwrote history. The new table lets a
--   member carry many rate rows over time, while a partial unique
--   index guarantees at most one open-ended ("current") rate per
--   (team_id, user_id). task_time_logs continues to snapshot the
--   rate active at log creation, so historical billing rows stay
--   correct independent of later edits or deletions.
--
--   The consultant-verified gate moves from the old team_members
--   trigger onto the new table; the old trigger + function are
--   dropped along with the now-empty rate columns.

-- 1. New table.
CREATE TABLE public.team_member_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  hourly_rate numeric(12,2) NOT NULL CHECK (hourly_rate >= 0),
  currency text NOT NULL DEFAULT 'USD',
  custom_id text,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Composite FK so a rate row only exists for an actual member;
  -- removing a member from the team cascades their rate history away.
  CONSTRAINT team_member_rates_team_user_fk
    FOREIGN KEY (team_id, user_id)
    REFERENCES public.team_members (team_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT team_member_rates_date_range
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

COMMENT ON TABLE public.team_member_rates IS
  'Rate history per team member. At most one row per (team, user) may have end_date IS NULL (the "active" rate).';

-- 2. At most one open-ended (active) rate per member.
CREATE UNIQUE INDEX team_member_rates_one_active
  ON public.team_member_rates (team_id, user_id)
  WHERE end_date IS NULL;

CREATE INDEX team_member_rates_member_idx
  ON public.team_member_rates (team_id, user_id, start_date DESC);

-- 3. Backfill from team_members. Members with no hourly_rate get no
--    initial row. The legacy fields are about to be dropped, so we
--    must move them across before step 5.
INSERT INTO public.team_member_rates
  (team_id, user_id, hourly_rate, currency, custom_id, start_date, end_date)
SELECT team_id,
       user_id,
       hourly_rate,
       COALESCE(currency, 'USD'),
       custom_id,
       start_date,
       end_date
FROM public.team_members
WHERE hourly_rate IS NOT NULL;

-- 4. Move the consultant-verified gate to the new table. The old
--    trigger guarded rate columns on team_members; those columns are
--    going away. New trigger fires on every INSERT or UPDATE of
--    team_member_rates.
CREATE OR REPLACE FUNCTION public.tg_team_member_rates_check_consultant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_owner_verified boolean;
BEGIN
  SELECT p.is_consultant_verified INTO v_owner_verified
  FROM public.teams t
  JOIN public.profiles p ON p.id = t.owner_id
  WHERE t.id = NEW.team_id;

  IF v_owner_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'Team owner must be consultant-verified to set rates on team members';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER team_member_rates_check_consultant
  BEFORE INSERT OR UPDATE ON public.team_member_rates
  FOR EACH ROW EXECUTE FUNCTION public.tg_team_member_rates_check_consultant();

-- updated_at touch trigger.
CREATE OR REPLACE FUNCTION public.tg_team_member_rates_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER team_member_rates_touch_updated_at
  BEFORE UPDATE ON public.team_member_rates
  FOR EACH ROW EXECUTE FUNCTION public.tg_team_member_rates_touch_updated_at();

-- 5. Drop the now-redundant trigger + columns from team_members.
DROP TRIGGER IF EXISTS team_members_check_consultant_for_rate
  ON public.team_members;
DROP FUNCTION IF EXISTS public.tg_team_members_check_consultant_for_rate();

ALTER TABLE public.team_members DROP COLUMN IF EXISTS hourly_rate;
ALTER TABLE public.team_members DROP COLUMN IF EXISTS currency;
ALTER TABLE public.team_members DROP COLUMN IF EXISTS custom_id;
ALTER TABLE public.team_members DROP COLUMN IF EXISTS start_date;
ALTER TABLE public.team_members DROP COLUMN IF EXISTS end_date;

COMMENT ON TABLE public.team_members IS
  'Roster of a team (role + position). Rates live in team_member_rates.';
