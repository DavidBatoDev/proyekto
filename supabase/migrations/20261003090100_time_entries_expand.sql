-- Migration: 20261003090100_time_entries_expand.sql  (time management rebuild, M1)
--
-- docs/13-proposals/time-management/data-model.md
-- docs/13-proposals/time-management/migrations-and-rollout.md#m1-expand
--
-- EXPAND ONLY. The running (old) backend keeps working unchanged:
--   * task_time_logs keeps its name; the new columns are nullable or
--     defaulted, and trg_time_entries_10_context derives them for old-shape
--     inserts and updates.
--   * There is no context CHECK and no timesheet or lock trigger yet (M2), so
--     every existing write path (start, stop, edit, review, payout, account
--     deletion, FK cascades) still succeeds.
--   * The new DB floor for logging is viewer-level: a project_access row or
--     project ownership, and for team entries project_teams + team_members.
--     The old backend already requires all of these.
--
-- What it adds:
--   * btree_gist (for the timesheet no-overlap exclusion constraint).
--   * timesheets, timesheet_events, time_policies, time_policy_events,
--     user_time_preferences, time_logging_defaults, invoice_time_entries.
--   * Context columns on task_time_logs, filled in one statement under
--     app.time_maintenance (updated_at preserved). No contract context is
--     inferred (no-backfill rule): prod has 0 assignments.
--   * One running timer per person, enforced by the database.
--   * Policy, period, scope and decider functions, plus guards for timesheets,
--     invoice reservations and policies.
--   * can_manage_team accepts team_members.role 'owner' as well as 'admin'
--     (it now matches the TypeScript approver checks); grants kept.
--   * tg_engagement_assignments_guard: a placed talent's hirer must be the
--     client engagement's provider (ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER).
--   * Contract-layer period columns on engagement_time_settings.
--   * RLS + REVOKE from anon/authenticated on every time table. RLS on
--     task_time_logs and team_member_rates was enabled by hand and never in a
--     migration; anon and authenticated held full grants, TRUNCATE included.
--     Only the service-role backend reads these tables.
--   * Notification types for timesheets (nothing emits them before PR-1).
--   * Prodigitality's workspace + team policy seed (prod only; no-op on dev).
--   * D16: curation rows for people who already log for a team without one.
--
-- Deferred to M3 (decided 2026-10-02): time_timesheet_transition,
-- account_deletion_team_has_open_time and account_deletion_workspace_has_open_time.
-- Each has no caller before backend PR-1, and M3 rebuilds them on
-- time_entries anyway, so they land once, with their first callers.
--
-- ROLLBACK (manual; only before M2):
--   DROP TRIGGER trg_time_entries_10_context ON public.task_time_logs;
--   ALTER TRIGGER trg_time_entries_20_assignment_guard ON public.task_time_logs
--     RENAME TO trg_task_time_logs_engagement_assignment_guard;
--   ALTER TRIGGER trg_time_entries_90_updated_at ON public.task_time_logs
--     RENAME TO trg_set_task_time_logs_updated_at;
--   ALTER FUNCTION public.tg_time_entries_assignment_guard()
--     RENAME TO tg_task_time_logs_engagement_assignment_guard;
--   ALTER FUNCTION public.set_time_entries_updated_at()
--     RENAME TO set_task_time_logs_updated_at;
--   ALTER TABLE public.task_time_logs DROP COLUMN context_kind, DROP COLUMN
--     workspace_id, DROP COLUMN context_ref, DROP COLUMN context_label_snapshot,
--     DROP COLUMN timesheet_id, DROP COLUMN work_item, DROP COLUMN note,
--     DROP COLUMN payable_seconds, DROP COLUMN amount_snapshot,
--     DROP COLUMN legacy_status;
--   DROP INDEX public.uq_time_entries_one_running_per_member; (and the other 5)
--   DROP TABLE public.invoice_time_entries, public.time_logging_defaults,
--     public.user_time_preferences, public.time_policy_events,
--     public.time_policies, public.timesheet_events, public.timesheets;
--   DROP FUNCTION the new time_* / tg_time* / can_*_timesheet functions;
--   restore can_manage_team and tg_engagement_assignments_guard from
--     20260901160000 and 20260814020000;
--   ALTER TABLE public.engagement_time_settings DROP COLUMN period_kind,
--     DROP COLUMN timezone, DROP COLUMN week_start;
--   The REVOKEs, the D16 curation rows and the notification types are safe
--   to keep (nothing emits the new types before PR-1).

BEGIN;

SET LOCAL lock_timeout = '5s';
SELECT set_config('app.time_maintenance', 'on', true);

-- ── 1. Precheck (invariants, never counts) ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.plan_limit_keys WHERE key = 'time_team_rules') THEN
    RAISE EXCEPTION 'M1 precheck: M0 (time plan keys) has not been applied';
  END IF;

  IF to_regclass('public.timesheets') IS NOT NULL THEN
    RAISE EXCEPTION 'M1 precheck: public.timesheets already exists';
  END IF;

  IF EXISTS (
    SELECT member_user_id FROM public.task_time_logs
    WHERE ended_at IS NULL AND member_user_id IS NOT NULL
    GROUP BY member_user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'M1 precheck: a member has more than one running time log; stop one first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_time_logs
    WHERE team_id IS NOT NULL AND engagement_assignment_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'M1 precheck: a time log carries both team_id and engagement_assignment_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN
    RAISE EXCEPTION 'M1 precheck: extension btree_gist is not available';
  END IF;
END $$;

-- ── 2. Extension ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ── 3. New tables ───────────────────────────────────────────────────────────

-- One timesheet per person × sheet scope × period (CHANGE-2).
CREATE TABLE public.timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  member_display_name_snapshot text,
  scope_kind text NOT NULL CHECK (scope_kind IN ('workspace', 'team', 'engagement')),
  scope_ref uuid NOT NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  engagement_id uuid REFERENCES public.engagements(id) ON DELETE RESTRICT,
  scope_label_snapshot text NOT NULL,
  policy_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  period_kind text NOT NULL CHECK (period_kind IN ('weekly', 'biweekly', 'semi_monthly', 'monthly')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  timezone text NOT NULL,
  week_start smallint NOT NULL CHECK (week_start BETWEEN 1 AND 7),
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'returned', 'approved')),
  approver_scope text CHECK (approver_scope IN ('team', 'workspace', 'hirer', 'auto', 'self')),
  revision integer NOT NULL DEFAULT 0,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submission_kind text CHECK (submission_kind IN ('manual', 'auto', 'on_deletion', 'legacy')),
  decided_at timestamptz,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision_kind text CHECK (decision_kind IN ('manual', 'auto', 'self', 'legacy')),
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  overtime_approved boolean NOT NULL DEFAULT false,
  total_seconds integer,
  payable_seconds integer,
  origin text NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'legacy_migration')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheets_period_check CHECK (period_end >= period_start),
  CONSTRAINT timesheets_scope_check CHECK (CASE scope_kind
    WHEN 'workspace'  THEN num_nonnulls(team_id, engagement_id) = 0
                           AND (workspace_id IS NULL OR workspace_id = scope_ref)
    WHEN 'team'       THEN num_nonnulls(workspace_id, engagement_id) = 0
                           AND (team_id IS NULL OR team_id = scope_ref)
    WHEN 'engagement' THEN num_nonnulls(team_id, workspace_id) = 0
                           AND engagement_id = scope_ref
  END),
  CONSTRAINT timesheets_state_check CHECK (
    (status = 'open' OR (submitted_at IS NOT NULL AND submission_kind IS NOT NULL AND approver_scope IS NOT NULL))
    AND (status <> 'approved' OR (decided_at IS NOT NULL AND decision_kind IS NOT NULL AND payable_seconds IS NOT NULL))
    AND (status <> 'returned' OR decision_note IS NOT NULL)
  ),
  CONSTRAINT timesheets_no_overlap EXCLUDE USING gist (
    member_user_id WITH =,
    scope_kind WITH =,
    scope_ref WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  )
);
CREATE INDEX timesheets_queue_idx ON public.timesheets (approver_scope, scope_ref, period_start DESC)
  WHERE status = 'submitted';
CREATE INDEX timesheets_member_idx ON public.timesheets (member_user_id, period_start DESC);
CREATE INDEX timesheets_policy_ws_idx ON public.timesheets (policy_workspace_id)
  WHERE status = 'submitted';
COMMENT ON TABLE public.timesheets IS
  'One timesheet per person x sheet scope (workspace | team | engagement) x period. Approval, freezing and settlement happen here, not on the entry. Service role only.';

-- Append-only by contract; the Enterprise audit-export source.
CREATE TABLE public.timesheet_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timesheet_id uuid NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN ('submitted', 'auto_submitted', 'withdrawn', 'approved',
                                       'returned', 'reopened', 'reopen_requested', 'legacy_import')),
  from_status text,
  to_status text NOT NULL,
  note text,
  total_seconds integer,
  payable_seconds integer,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timesheet_events_timesheet_idx ON public.timesheet_events (timesheet_id, created_at);

-- Workspace and team layers of the time policy. NULL on a team row = inherit.
CREATE TABLE public.time_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Named explicitly: the default name (time_policies_scope_check) is taken
  -- by the table constraint below.
  scope text NOT NULL CONSTRAINT time_policies_scope_values_check CHECK (scope IN ('workspace', 'team')),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  tracking_enabled boolean,
  period_kind text CHECK (period_kind IN ('weekly', 'biweekly', 'semi_monthly', 'monthly')),
  week_start smallint CHECK (week_start BETWEEN 1 AND 7),
  timezone text,
  period_anchor date,
  approval_required boolean,
  approver_scope text CHECK (approver_scope IN ('team', 'workspace')),
  allow_manual_entries boolean,
  retroactive_days integer CHECK (retroactive_days BETWEEN 0 AND 3650),
  rounding_minutes smallint CHECK (rounding_minutes IN (0, 5, 6, 10, 15, 30)),
  weekly_limit_minutes integer CHECK (weekly_limit_minutes > 0),
  reminder_days smallint CHECK (reminder_days BETWEEN 0 AND 14),
  hidden_presets text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (hidden_presets <@ ARRAY['meeting', 'review', 'admin', 'other']::text[]),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_policies_scope_check CHECK (
    (scope = 'workspace' AND workspace_id IS NOT NULL AND team_id IS NULL AND approver_scope IS NULL
       AND num_nulls(tracking_enabled, period_kind, week_start, timezone, approval_required,
                     allow_manual_entries, rounding_minutes, reminder_days) = 0)
    OR (scope = 'team' AND team_id IS NOT NULL AND workspace_id IS NULL)
  )
);
CREATE UNIQUE INDEX uq_time_policies_workspace ON public.time_policies (workspace_id) WHERE scope = 'workspace';
CREATE UNIQUE INDEX uq_time_policies_team ON public.time_policies (team_id) WHERE scope = 'team';

CREATE TABLE public.time_policy_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  policy_id uuid NOT NULL REFERENCES public.time_policies(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_policy_events_policy_idx ON public.time_policy_events (policy_id, created_at DESC);

CREATE TABLE public.user_time_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  timezone text NOT NULL,
  week_start smallint CHECK (week_start BETWEEN 1 AND 7),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The remembered "For" choice per (user, project).
CREATE TABLE public.time_logging_defaults (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  context_kind text NOT NULL CHECK (context_kind IN ('assignment', 'team', 'workspace', 'personal')),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  engagement_assignment_id uuid REFERENCES public.engagement_assignments(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id),
  CONSTRAINT time_logging_defaults_context_check CHECK (CASE context_kind
    WHEN 'personal'   THEN num_nonnulls(team_id, workspace_id, engagement_assignment_id) = 0
    WHEN 'team'       THEN team_id IS NOT NULL AND num_nonnulls(workspace_id, engagement_assignment_id) = 0
    WHEN 'workspace'  THEN workspace_id IS NOT NULL AND num_nonnulls(team_id, engagement_assignment_id) = 0
    WHEN 'assignment' THEN engagement_assignment_id IS NOT NULL AND num_nonnulls(team_id, workspace_id) = 0
  END)
);

-- Billing reservation (CHANGE-6): each entry is billed on exactly one invoice.
-- The FK follows the M3 rename of task_time_logs by OID.
CREATE TABLE public.invoice_time_entries (
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.task_time_logs(id) ON DELETE RESTRICT,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  bill_seconds integer NOT NULL CHECK (bill_seconds >= 0),
  bill_rate numeric(12,2) NOT NULL CHECK (bill_rate >= 0),
  bill_amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_id, entry_id),
  CONSTRAINT uq_invoice_time_entries_entry UNIQUE (entry_id)
);
CREATE INDEX invoice_time_entries_contract_idx ON public.invoice_time_entries (contract_id);

-- New relations are service-role only (CHANGE-18).
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_policy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_time_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_logging_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_time_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.timesheets, public.timesheet_events, public.time_policies,
  public.time_policy_events, public.user_time_preferences, public.time_logging_defaults,
  public.invoice_time_entries FROM anon, authenticated;
-- Default privileges also grant anon/authenticated on new sequences.
REVOKE ALL ON SEQUENCE public.timesheet_events_id_seq, public.time_policy_events_id_seq
  FROM anon, authenticated;

-- ── 4. Existing triggers and functions on task_time_logs: new names ────────
-- BEFORE triggers fire in name order; the numeric prefixes fix the order from
-- here on (10 context, 20 assignment guard, 90 updated_at).
ALTER FUNCTION public.set_task_time_logs_updated_at() RENAME TO set_time_entries_updated_at;
CREATE OR REPLACE FUNCTION public.set_time_entries_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Migrations and backfills keep each row's updated_at (M2 uses it as the
  -- decided_at fallback, M4 as its "changed since M2" test).
  IF coalesce(current_setting('app.time_maintenance', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
ALTER TRIGGER trg_set_task_time_logs_updated_at ON public.task_time_logs
  RENAME TO trg_time_entries_90_updated_at;

ALTER FUNCTION public.tg_task_time_logs_engagement_assignment_guard()
  RENAME TO tg_time_entries_assignment_guard;
ALTER TRIGGER trg_task_time_logs_engagement_assignment_guard ON public.task_time_logs
  RENAME TO trg_time_entries_20_assignment_guard;

-- ── 5. New columns on task_time_logs (renamed to time_entries in M3) ──────
ALTER TABLE public.task_time_logs
  ADD COLUMN context_kind text,
  ADD COLUMN workspace_id uuid,
  ADD COLUMN context_ref uuid,
  ADD COLUMN context_label_snapshot text,
  ADD COLUMN timesheet_id uuid,
  ADD COLUMN work_item text NOT NULL DEFAULT 'task',
  ADD COLUMN note text,
  ADD COLUMN payable_seconds integer,
  ADD COLUMN amount_snapshot numeric(14,2),
  ADD COLUMN legacy_status text;

ALTER TABLE public.task_time_logs
  ADD CONSTRAINT time_entries_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL,
  ADD CONSTRAINT time_entries_timesheet_id_fkey
    FOREIGN KEY (timesheet_id) REFERENCES public.timesheets(id) ON DELETE RESTRICT;

-- Fill in one statement, before any new trigger exists. The renamed
-- updated_at trigger skips under app.time_maintenance, and the assignment
-- guard only fires for its own column list, so no row changes updated_at.
UPDATE public.task_time_logs l SET
  context_kind = CASE WHEN l.engagement_assignment_id IS NOT NULL THEN 'assignment'
                      WHEN l.team_id IS NOT NULL THEN 'team'
                      ELSE 'personal' END,
  context_ref = COALESCE(l.engagement_assignment_id, l.team_id),
  context_label_snapshot = (SELECT t.name FROM public.teams t WHERE t.id = l.team_id),
  work_item = CASE WHEN l.task_id IS NULL THEN 'other' ELSE 'task' END;

ALTER TABLE public.task_time_logs ALTER COLUMN context_kind SET NOT NULL;

ALTER TABLE public.task_time_logs
  ADD CONSTRAINT time_entries_context_kind_check
    CHECK (context_kind IN ('assignment', 'team', 'workspace', 'personal')),
  -- Values only; M2 tightens it to the task_id biconditional.
  ADD CONSTRAINT time_entries_work_item_check
    CHECK (work_item IN ('task', 'meeting', 'review', 'admin', 'other')),
  ADD CONSTRAINT time_entries_legacy_status_check
    CHECK (legacy_status IS NULL OR legacy_status IN ('rejected', 'paid_outside')),
  ADD CONSTRAINT time_entries_frozen_check
    CHECK (payable_seconds IS NULL OR (ended_at IS NOT NULL AND payable_seconds >= 0)),
  ADD CONSTRAINT time_entries_amount_check
    CHECK (amount_snapshot IS NULL OR payable_seconds IS NOT NULL),
  ADD CONSTRAINT time_entries_note_length
    CHECK (note IS NULL OR char_length(note) <= 2000);

-- One running timer per person, across every project (the old backend checks
-- this in app code only, so two concurrent starts could both succeed).
CREATE UNIQUE INDEX uq_time_entries_one_running_per_member
  ON public.task_time_logs (member_user_id) WHERE ended_at IS NULL;
CREATE INDEX time_entries_timesheet_idx ON public.task_time_logs (timesheet_id);
CREATE INDEX time_entries_assignment_started_idx
  ON public.task_time_logs (engagement_assignment_id, started_at)
  WHERE engagement_assignment_id IS NOT NULL;
CREATE INDEX time_entries_team_started_idx ON public.task_time_logs (team_id, started_at DESC);
CREATE INDEX time_entries_cost_rollup_idx
  ON public.task_time_logs (project_id, rate_type_snapshot, started_at)
  WHERE payable_seconds IS NOT NULL;
CREATE INDEX time_entries_owed_idx ON public.task_time_logs (team_id, member_user_id)
  WHERE payable_seconds IS NOT NULL AND payout_id IS NULL AND legacy_status IS NULL;

-- ── 6. Functions ────────────────────────────────────────────────────────────
-- All SECURITY DEFINER with a pinned search_path; EXECUTE is revoked from
-- PUBLIC/anon/authenticated at the end of this file (service role only).

-- Whether a workspace's effective plan includes a feature key. NULL
-- workspace = false.
CREATE OR REPLACE FUNCTION public.time_workspace_has_feature(p_workspace_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT pl.bool_value
    FROM public.workspace_plan_state(ARRAY[p_workspace_id]) s
    JOIN public.plan_limits pl ON pl.plan = s.effective_plan AND pl.limit_key = p_key
    LIMIT 1
  ), false);
$$;

-- The period holding p_at's local date, as daterange '[start, end]'
-- (normalised to [start, end + 1)). Callers use lower(r) and upper(r) - 1.
CREATE OR REPLACE FUNCTION public.time_period_for(
  p_kind text, p_tz text, p_week_start smallint, p_anchor date, p_at timestamptz
)
RETURNS daterange
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_d date;
  v_ws int := coalesce(p_week_start, 1);
  v_anchor date;
  v_start date;
  v_end date;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'TIME_POLICY_INVALID' USING DETAIL = 'p_at is required';
  END IF;
  BEGIN
    v_d := (p_at AT TIME ZONE coalesce(p_tz, 'UTC'))::date;
  EXCEPTION WHEN OTHERS THEN
    v_d := (p_at AT TIME ZONE 'UTC')::date;
  END;

  IF p_kind = 'weekly' THEN
    v_start := v_d - ((extract(isodow FROM v_d)::int - v_ws + 7) % 7);
    v_end := v_start + 6;
  ELSIF p_kind = 'biweekly' THEN
    -- 2024-01-01 is a Monday, so the default anchor falls on week_start.
    v_anchor := coalesce(p_anchor, date '2024-01-01' + (v_ws - 1));
    v_start := v_anchor + 14 * floor((v_d - v_anchor) / 14.0)::int;
    v_end := v_start + 13;
  ELSIF p_kind = 'semi_monthly' THEN
    IF extract(day FROM v_d) <= 15 THEN
      v_start := date_trunc('month', v_d)::date;
      v_end := v_start + 14;
    ELSE
      v_start := date_trunc('month', v_d)::date + 15;
      v_end := (date_trunc('month', v_d) + interval '1 month' - interval '1 day')::date;
    END IF;
  ELSIF p_kind = 'monthly' THEN
    v_start := date_trunc('month', v_d)::date;
    v_end := (date_trunc('month', v_d) + interval '1 month' - interval '1 day')::date;
  ELSE
    RAISE EXCEPTION 'TIME_POLICY_INVALID' USING DETAIL = format('unknown period kind %s', p_kind);
  END IF;

  RETURN daterange(v_start, v_end, '[]');
END;
$$;

-- The label a timesheet card shows for a sheet scope.
CREATE OR REPLACE FUNCTION public.time_scope_label(p_scope_kind text, p_scope_ref uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    CASE p_scope_kind
      WHEN 'workspace' THEN (SELECT w.name FROM public.workspaces w WHERE w.id = p_scope_ref)
      WHEN 'team' THEN (SELECT t.name FROM public.teams t WHERE t.id = p_scope_ref)
      WHEN 'engagement' THEN (
        SELECT ep.display_name_snapshot FROM public.engagement_parties ep
        WHERE ep.engagement_id = p_scope_ref AND ep.position = 'hirer'
        LIMIT 1)
    END,
    'Unknown');
$$;

-- Layered policy: platform default -> workspace -> team override (only when
-- the sheet scope is team and the team's workspace has time_team_rules) ->
-- contract terms (engagement scope, in force on p_at's local date). Every
-- resolved field also carries its source.
CREATE OR REPLACE FUNCTION public.time_resolve_policy(
  p_scope_kind text, p_scope_ref uuid, p_policy_workspace_id uuid, p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb := jsonb_build_object(
    'tracking_enabled', true,
    'period_kind', 'weekly',
    'week_start', 1,
    'timezone', 'UTC',
    'period_anchor', NULL,
    'approval_required', true,
    'approver_scope', 'workspace',
    'allow_manual_entries', true,
    'retroactive_days', NULL,
    'rounding_minutes', 0,
    'weekly_limit_minutes', NULL,
    'reminder_days', 1,
    'hidden_presets', '[]'::jsonb,
    'tracking_mode', NULL);
  s jsonb := '{}'::jsonb;
  k text;
  layer jsonb;
  v_ws public.time_policies%ROWTYPE;
  v_team_row public.time_policies%ROWTYPE;
  v_team public.teams%ROWTYPE;
  v_set public.engagement_time_settings%ROWTYPE;
  v_d date;
  v_has_tracking boolean := public.time_workspace_has_feature(p_policy_workspace_id, 'time_tracking');
  v_has_team_rules boolean := public.time_workspace_has_feature(p_policy_workspace_id, 'time_team_rules');
  v_team_applied boolean := false;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v) LOOP
    s := s || jsonb_build_object(k, 'default');
  END LOOP;

  -- Workspace layer.
  IF p_policy_workspace_id IS NOT NULL THEN
    SELECT * INTO v_ws FROM public.time_policies
    WHERE scope = 'workspace' AND workspace_id = p_policy_workspace_id;
    IF FOUND THEN
      layer := jsonb_strip_nulls(jsonb_build_object(
        'tracking_enabled', v_ws.tracking_enabled,
        'period_kind', v_ws.period_kind,
        'week_start', v_ws.week_start,
        'timezone', v_ws.timezone,
        'period_anchor', v_ws.period_anchor,
        'approval_required', v_ws.approval_required,
        'allow_manual_entries', v_ws.allow_manual_entries,
        'retroactive_days', v_ws.retroactive_days,
        'rounding_minutes', v_ws.rounding_minutes,
        'weekly_limit_minutes', v_ws.weekly_limit_minutes,
        'reminder_days', v_ws.reminder_days,
        'hidden_presets', to_jsonb(v_ws.hidden_presets)));
      v := v || layer;
      FOR k IN SELECT jsonb_object_keys(layer) LOOP
        s := s || jsonb_build_object(k, 'workspace');
      END LOOP;
    END IF;
  END IF;

  -- Team override layer.
  IF p_scope_kind = 'team' THEN
    SELECT * INTO v_team FROM public.teams WHERE id = p_scope_ref;
    SELECT * INTO v_team_row FROM public.time_policies WHERE scope = 'team' AND team_id = p_scope_ref;
    IF FOUND AND public.time_workspace_has_feature(v_team.workspace_id, 'time_team_rules') THEN
      v_team_applied := true;
      layer := jsonb_strip_nulls(jsonb_build_object(
        'period_kind', v_team_row.period_kind,
        'week_start', v_team_row.week_start,
        'timezone', v_team_row.timezone,
        'period_anchor', v_team_row.period_anchor,
        'approval_required', v_team_row.approval_required,
        'allow_manual_entries', v_team_row.allow_manual_entries,
        'retroactive_days', v_team_row.retroactive_days,
        'rounding_minutes', v_team_row.rounding_minutes,
        'weekly_limit_minutes', v_team_row.weekly_limit_minutes,
        'reminder_days', v_team_row.reminder_days));
      v := v || layer || jsonb_build_object('approver_scope', coalesce(v_team_row.approver_scope, 'workspace'));
      FOR k IN SELECT jsonb_object_keys(layer) LOOP
        s := s || jsonb_build_object(k, 'team');
      END LOOP;
      s := s || jsonb_build_object('approver_scope', 'team');
      -- A team that pays member rates never skips approval.
      IF v_team.member_rates_enabled AND (v->>'approval_required')::boolean = false THEN
        v := v || jsonb_build_object('approval_required', true);
        s := s || jsonb_build_object('approval_required', 'team');
      END IF;
    END IF;
  END IF;

  -- Contract layer: the governing engagement's settings in force on the
  -- local date. Every non-NULL contract field wins.
  IF p_scope_kind = 'engagement' THEN
    BEGIN
      v_d := (p_at AT TIME ZONE (v->>'timezone'))::date;
    EXCEPTION WHEN OTHERS THEN
      v_d := (p_at AT TIME ZONE 'UTC')::date;
    END;
    SELECT * INTO v_set FROM public.engagement_time_settings
    WHERE engagement_id = p_scope_ref
      AND effective_from <= v_d
      AND (effective_until IS NULL OR v_d <= effective_until)
    ORDER BY effective_from DESC
    LIMIT 1;
    IF FOUND THEN
      layer := jsonb_strip_nulls(jsonb_build_object(
        'tracking_mode', v_set.tracking_mode,
        'approval_required', v_set.approval_mode <> 'none',
        'allow_manual_entries', v_set.allow_manual_entries,
        'rounding_minutes', v_set.rounding_minutes,
        'weekly_limit_minutes', v_set.weekly_limit_minutes,
        'period_kind', v_set.period_kind,
        'timezone', v_set.timezone,
        'week_start', v_set.week_start));
      v := v || layer;
      FOR k IN SELECT jsonb_object_keys(layer) LOOP
        s := s || jsonb_build_object(k, 'contract');
      END LOOP;
    END IF;
  END IF;

  RETURN v || jsonb_build_object(
    'sources', s,
    'plan', jsonb_build_object('time_tracking', v_has_tracking, 'time_team_rules', v_has_team_rules),
    'policy_workspace_id', p_policy_workspace_id,
    'team_override_applied', v_team_applied);
END;
$$;

-- Lazy materialisation of a workspace's policy row (CHANGE-11). The timezone
-- is the first valid of: the hint (an admin's browser), the earliest owner's
-- preference, the member's preference, UTC.
CREATE OR REPLACE FUNCTION public.time_ensure_workspace_policy(
  p_workspace_id uuid, p_timezone_hint text DEFAULT NULL, p_member_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_tz text;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id FROM public.time_policies
  WHERE scope = 'workspace' AND workspace_id = p_workspace_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  SELECT c.tz INTO v_tz
  FROM (
    SELECT p_timezone_hint AS tz, 1 AS ord
    UNION ALL
    SELECT * FROM (
      SELECT utp.timezone, 2
      FROM public.workspace_members wm
      JOIN public.user_time_preferences utp ON utp.user_id = wm.user_id
      WHERE wm.workspace_id = p_workspace_id AND wm.role = 'owner'
        AND EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = utp.timezone)
      ORDER BY wm.joined_at
      LIMIT 1
    ) owner_tz
    UNION ALL
    SELECT utp.timezone, 3 FROM public.user_time_preferences utp
    WHERE utp.user_id = p_member_user_id
  ) c
  WHERE c.tz IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = c.tz)
  ORDER BY c.ord
  LIMIT 1;

  INSERT INTO public.time_policies (
    scope, workspace_id, tracking_enabled, period_kind, week_start, timezone,
    approval_required, allow_manual_entries, rounding_minutes, reminder_days
  ) VALUES (
    'workspace', p_workspace_id, true, 'weekly', 1, coalesce(v_tz, 'UTC'),
    true, true, 0, 1
  )
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_id FROM public.time_policies
  WHERE scope = 'workspace' AND workspace_id = p_workspace_id;
  RETURN v_id;
END;
$$;

-- Which timesheet an entry's context lands on (CHANGE-2). Personal: no row.
CREATE OR REPLACE FUNCTION public.time_sheet_scope_for(
  p_context_kind text, p_context_ref uuid, p_project_id uuid
)
RETURNS TABLE (scope_kind text, scope_ref uuid, policy_workspace_id uuid, scope_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_engagement uuid;
  v_team public.teams%ROWTYPE;
  v_ws uuid;
BEGIN
  IF p_context_kind = 'assignment' THEN
    SELECT coalesce(a.talent_engagement_id, a.client_engagement_id) INTO v_engagement
    FROM public.engagement_assignments a WHERE a.id = p_context_ref;
    IF v_engagement IS NULL THEN
      RAISE EXCEPTION 'LOGGING_FOR_INVALID' USING DETAIL = 'assignment not found';
    END IF;
    -- Never the project's workspace: one engagement sheet spans projects.
    SELECT coalesce(
      (SELECT c.workspace_id FROM public.engagements e
         JOIN public.contracts c ON c.id = e.activated_by_contract_id
       WHERE e.id = v_engagement),
      (SELECT t.workspace_id FROM public.engagement_parties ep
         JOIN public.teams t ON t.id = ep.team_id
       WHERE ep.engagement_id = v_engagement AND ep.position = 'hirer'
       LIMIT 1))
    INTO v_ws;
    RETURN QUERY SELECT 'engagement'::text, v_engagement, v_ws,
      public.time_scope_label('engagement', v_engagement);
  ELSIF p_context_kind = 'team' THEN
    SELECT * INTO v_team FROM public.teams WHERE id = p_context_ref;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'team'::text, p_context_ref, NULL::uuid, 'Deleted team'::text;
    ELSIF v_team.workspace_id IS NULL
       OR (EXISTS (SELECT 1 FROM public.time_policies tp WHERE tp.scope = 'team' AND tp.team_id = v_team.id)
           AND public.time_workspace_has_feature(v_team.workspace_id, 'time_team_rules')) THEN
      RETURN QUERY SELECT 'team'::text, v_team.id, v_team.workspace_id, v_team.name;
    ELSE
      RETURN QUERY SELECT 'workspace'::text, v_team.workspace_id, v_team.workspace_id,
        public.time_scope_label('workspace', v_team.workspace_id);
    END IF;
  ELSIF p_context_kind = 'workspace' THEN
    RETURN QUERY SELECT 'workspace'::text, p_context_ref, p_context_ref,
      public.time_scope_label('workspace', p_context_ref);
  END IF;
  -- 'personal': no timesheet.
END;
$$;

-- The (member, scope) sheet whose period holds p_at; created when missing.
-- Bounds are clipped to neighbouring sheets, so a policy change applies from
-- the next period boundary (E3).
CREATE OR REPLACE FUNCTION public.time_ensure_timesheet(
  p_member_user_id uuid, p_scope_kind text, p_scope_ref uuid,
  p_policy_workspace_id uuid, p_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_pol jsonb;
  v_tz text;
  v_d date;
  v_range daterange;
  v_start date;
  v_end date;
  v_maint boolean := coalesce(current_setting('app.time_maintenance', true), '') = 'on';
  r record;
BEGIN
  IF p_member_user_id IS NULL OR p_scope_kind IS NULL OR p_scope_ref IS NULL THEN
    RAISE EXCEPTION 'TIMESHEET_SCOPE_REQUIRED';
  END IF;

  SELECT t.id INTO v_id FROM public.timesheets t
  WHERE t.member_user_id = p_member_user_id
    AND t.scope_kind = p_scope_kind AND t.scope_ref = p_scope_ref
    AND (p_at AT TIME ZONE t.timezone)::date BETWEEN t.period_start AND t.period_end
  LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  PERFORM public.time_ensure_workspace_policy(p_policy_workspace_id, NULL, p_member_user_id);
  v_pol := public.time_resolve_policy(p_scope_kind, p_scope_ref, p_policy_workspace_id, p_at);
  v_tz := v_pol->>'timezone';
  BEGIN
    v_d := (p_at AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'UTC';
    v_d := (p_at AT TIME ZONE 'UTC')::date;
  END;
  v_range := public.time_period_for(v_pol->>'period_kind', v_tz, (v_pol->>'week_start')::smallint,
                                    (v_pol->>'period_anchor')::date, p_at);
  v_start := lower(v_range);
  v_end := upper(v_range) - 1;

  FOR r IN
    SELECT t.id, t.period_start, t.period_end FROM public.timesheets t
    WHERE t.member_user_id = p_member_user_id
      AND t.scope_kind = p_scope_kind AND t.scope_ref = p_scope_ref
      AND daterange(t.period_start, t.period_end, '[]') && daterange(v_start, v_end, '[]')
  LOOP
    IF r.period_end < v_d THEN
      v_start := greatest(v_start, r.period_end + 1);
    ELSIF r.period_start > v_d THEN
      v_end := least(v_end, r.period_start - 1);
    ELSE
      -- That sheet holds the date once read in this policy's timezone.
      RETURN r.id;
    END IF;
  END LOOP;

  INSERT INTO public.timesheets (
    member_user_id, member_display_name_snapshot, scope_kind, scope_ref,
    team_id, workspace_id, engagement_id, scope_label_snapshot, policy_workspace_id,
    period_kind, period_start, period_end, timezone, week_start, origin, submission_kind
  )
  SELECT
    p_member_user_id,
    coalesce(nullif(p.display_name, ''), nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')),
    p_scope_kind, p_scope_ref,
    CASE WHEN p_scope_kind = 'team' AND EXISTS (SELECT 1 FROM public.teams WHERE id = p_scope_ref) THEN p_scope_ref END,
    CASE WHEN p_scope_kind = 'workspace' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_scope_ref) THEN p_scope_ref END,
    CASE WHEN p_scope_kind = 'engagement' THEN p_scope_ref END,
    public.time_scope_label(p_scope_kind, p_scope_ref),
    p_policy_workspace_id,
    v_pol->>'period_kind', v_start, v_end, v_tz, (v_pol->>'week_start')::smallint,
    CASE WHEN v_maint THEN 'legacy_migration' ELSE 'app' END,
    CASE WHEN v_maint THEN 'legacy' END
  FROM (SELECT 1) one
  LEFT JOIN public.profiles p ON p.id = p_member_user_id
  ON CONFLICT DO NOTHING;

  SELECT t.id INTO v_id FROM public.timesheets t
  WHERE t.member_user_id = p_member_user_id
    AND t.scope_kind = p_scope_kind AND t.scope_ref = p_scope_ref
    AND v_d BETWEEN t.period_start AND t.period_end
  LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'TIMESHEET_ENSURE_FAILED'
      USING DETAIL = format('member %s scope %s/%s date %s', p_member_user_id, p_scope_kind, p_scope_ref, v_d);
  END IF;
  RETURN v_id;
END;
$$;

-- Who may decide a sheet with this frozen approver scope. Shared by
-- can_decide_timesheet and the timesheet guard. Never checks the plan.
CREATE OR REPLACE FUNCTION public.time_can_decide_scope(
  p_approver_scope text, p_team_id uuid, p_policy_workspace_id uuid,
  p_engagement_id uuid, p_member_user_id uuid, p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL OR p_user_id IS NOT DISTINCT FROM p_member_user_id THEN false
    WHEN p_approver_scope = 'team' THEN
      CASE WHEN p_team_id IS NOT NULL THEN coalesce(public.can_manage_team(p_team_id, p_user_id), false)
           ELSE coalesce(public.can_manage_workspace(p_policy_workspace_id, p_user_id), false) END
    WHEN p_approver_scope = 'workspace' THEN
      -- A team with no workspace (teams.workspace_id is ON DELETE SET NULL)
      -- would otherwise leave its sheets undecidable.
      CASE WHEN p_policy_workspace_id IS NULL AND p_team_id IS NOT NULL
           THEN coalesce(public.can_manage_team(p_team_id, p_user_id), false)
           ELSE coalesce(public.can_manage_workspace(p_policy_workspace_id, p_user_id), false) END
    WHEN p_approver_scope = 'hirer' THEN EXISTS (
      SELECT 1 FROM public.engagement_parties ep
      WHERE ep.engagement_id = p_engagement_id AND ep.position = 'hirer' AND ep.user_id = p_user_id)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_decide_timesheet(p_timesheet_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT public.time_can_decide_scope(t.approver_scope, t.team_id, t.policy_workspace_id,
                                        t.engagement_id, t.member_user_id, p_user_id)
    FROM public.timesheets t WHERE t.id = p_timesheet_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.can_view_timesheet(p_timesheet_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT p_user_id IS NOT NULL AND (
      t.member_user_id = p_user_id
      OR public.can_decide_timesheet(t.id, p_user_id)
      OR (t.scope_kind = 'team' AND t.team_id IS NOT NULL
          AND coalesce(public.can_manage_team(t.team_id, p_user_id), false)))
    FROM public.timesheets t WHERE t.id = p_timesheet_id
  ), false);
$$;

-- Hours before this date are never billed by the contract: the later of its
-- service start and the day legacy entries were imported (NULLs ignored).
CREATE OR REPLACE FUNCTION public.time_billing_floor(p_contract_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT greatest(
    c.service_start_date,
    (SELECT min(e.created_at)::date FROM public.timesheet_events e WHERE e.event = 'legacy_import'))
  FROM public.contracts c WHERE c.id = p_contract_id;
$$;

-- trg_time_entries_10_context: derive the context for old-shape writes, keep
-- work_item consistent with task_id, and enforce the DB floor for logging.
CREATE OR REPLACE FUNCTION public.tg_time_entries_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_maint boolean := coalesce(current_setting('app.time_maintenance', true), '') = 'on';
  v_context_changed boolean := false;
  v_validate boolean := false;
  v_owner uuid;
  v_project_ws uuid;
  v_assignment_created timestamptz;
BEGIN
  -- Derive.
  IF TG_OP = 'INSERT' THEN
    IF NEW.context_kind IS NULL THEN
      NEW.context_kind := CASE
        WHEN NEW.engagement_assignment_id IS NOT NULL THEN 'assignment'
        WHEN NEW.team_id IS NOT NULL THEN 'team'
        WHEN NEW.workspace_id IS NOT NULL THEN 'workspace'
        ELSE 'personal' END;
      NEW.context_ref := CASE NEW.context_kind
        WHEN 'assignment' THEN NEW.engagement_assignment_id
        WHEN 'team' THEN NEW.team_id
        WHEN 'workspace' THEN NEW.workspace_id END;
    END IF;
    v_context_changed := true;
  ELSE
    IF NEW.context_kind IS NOT DISTINCT FROM OLD.context_kind
       AND NEW.context_ref IS NOT DISTINCT FROM OLD.context_ref THEN
      -- The caller left the context alone: a context FK moving to a new
      -- non-NULL value re-derives it (the old backend's project move). An FK
      -- going to NULL (cascade) never touches context_ref.
      IF NEW.engagement_assignment_id IS NOT NULL
         AND NEW.engagement_assignment_id IS DISTINCT FROM OLD.engagement_assignment_id THEN
        NEW.context_kind := 'assignment';
        NEW.context_ref := NEW.engagement_assignment_id;
      ELSIF NEW.team_id IS NOT NULL AND NEW.team_id IS DISTINCT FROM OLD.team_id THEN
        NEW.context_kind := 'team';
        NEW.context_ref := NEW.team_id;
      ELSIF NEW.workspace_id IS NOT NULL AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
        NEW.context_kind := 'workspace';
        NEW.context_ref := NEW.workspace_id;
      END IF;
    END IF;
    v_context_changed := NEW.context_kind IS DISTINCT FROM OLD.context_kind
                         OR NEW.context_ref IS DISTINCT FROM OLD.context_ref;
  END IF;

  IF v_context_changed THEN
    NEW.context_label_snapshot := CASE NEW.context_kind
      WHEN 'team' THEN (SELECT t.name FROM public.teams t WHERE t.id = NEW.context_ref)
      WHEN 'workspace' THEN (SELECT w.name FROM public.workspaces w WHERE w.id = NEW.context_ref)
      WHEN 'assignment' THEN (
        SELECT ep.display_name_snapshot
        FROM public.engagement_assignments a
        JOIN public.engagement_parties ep
          ON ep.engagement_id = coalesce(a.talent_engagement_id, a.client_engagement_id)
         AND ep.position = 'hirer'
        WHERE a.id = NEW.context_ref
        LIMIT 1)
      END;
  END IF;

  -- work_item follows task_id: 'task' exactly when a task is set.
  IF TG_OP = 'INSERT' OR NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    IF NEW.task_id IS NOT NULL THEN
      NEW.work_item := 'task';
    ELSIF NEW.work_item = 'task' THEN
      NEW.work_item := 'other';
    END IF;
  END IF;

  IF v_maint THEN
    RETURN NEW;
  END IF;

  -- Validate on insert, and when the project, member or context moves to a
  -- non-NULL value. A stop (ended_at) and an FK cascade to NULL never do.
  IF TG_OP = 'INSERT' THEN
    v_validate := true;
  ELSE
    v_validate := (NEW.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id)
               OR (NEW.member_user_id IS NOT NULL AND NEW.member_user_id IS DISTINCT FROM OLD.member_user_id)
               OR (NEW.team_id IS NOT NULL AND NEW.team_id IS DISTINCT FROM OLD.team_id)
               OR (NEW.context_kind IS DISTINCT FROM OLD.context_kind)
               OR (NEW.context_ref IS NOT NULL AND NEW.context_ref IS DISTINCT FROM OLD.context_ref);
  END IF;

  IF NOT v_validate THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'TIME_ENTRY_NO_PROJECT_ACCESS' USING DETAIL = 'project_id is required';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.member_user_id IS NULL THEN
    RAISE EXCEPTION 'TIME_ENTRY_NO_PROJECT_ACCESS' USING DETAIL = 'member_user_id is required';
  END IF;

  SELECT p.owner_id, p.workspace_id INTO v_owner, v_project_ws
  FROM public.projects p WHERE p.id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIME_ENTRY_NO_PROJECT_ACCESS' USING DETAIL = 'project not found';
  END IF;

  -- Viewer-level floor on purpose: the editor rule (time.log) lives in the
  -- backend, so the old backend's viewer inserts keep working until cutover.
  IF NEW.member_user_id IS NOT NULL
     AND v_owner IS DISTINCT FROM NEW.member_user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.project_access pa
       WHERE pa.project_id = NEW.project_id AND pa.user_id = NEW.member_user_id) THEN
    RAISE EXCEPTION 'TIME_ENTRY_NO_PROJECT_ACCESS';
  END IF;

  IF NEW.context_kind = 'team' THEN
    -- Curation (project_team_members) is enforced by the new resolver, not
    -- here: the old backend falls back to project_teams ∩ team_members.
    IF NEW.context_ref IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.project_teams pt
                      WHERE pt.project_id = NEW.project_id AND pt.team_id = NEW.context_ref)
       OR (NEW.member_user_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.team_members tm
             WHERE tm.team_id = NEW.context_ref AND tm.user_id = NEW.member_user_id)) THEN
      RAISE EXCEPTION 'TIME_ENTRY_NOT_ON_PROJECT_TEAM';
    END IF;
  ELSIF NEW.context_kind = 'workspace' THEN
    IF NEW.context_ref IS NULL
       OR v_project_ws IS DISTINCT FROM NEW.context_ref
       OR (NEW.member_user_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.workspace_members wm
             WHERE wm.workspace_id = NEW.context_ref AND wm.user_id = NEW.member_user_id)) THEN
      RAISE EXCEPTION 'TIME_ENTRY_NOT_WORKSPACE_MEMBER';
    END IF;
  ELSIF NEW.context_kind = 'assignment' AND v_context_changed THEN
    -- No backfill into an agreement: an entry can only move into an
    -- assignment created before it. The window check is trg_20's.
    SELECT a.created_at INTO v_assignment_created
    FROM public.engagement_assignments a WHERE a.id = NEW.context_ref;
    IF v_assignment_created IS NULL
       OR (TG_OP = 'UPDATE' AND OLD.created_at < v_assignment_created) THEN
      RAISE EXCEPTION 'LOGGING_FOR_INVALID' USING DETAIL = 'entry predates the assignment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_time_entries_10_context
  BEFORE INSERT OR UPDATE OF context_kind, context_ref, team_id, workspace_id,
    engagement_assignment_id, project_id, member_user_id, task_id, work_item
  ON public.task_time_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entries_context();

-- trg_timesheets_guard: immutability, legal transitions and decider checks.
CREATE OR REPLACE FUNCTION public.tg_timesheets_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_maint boolean := coalesce(current_setting('app.time_maintenance', true), '') = 'on';
  v_legacy boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'TIMESHEET_TRANSITION_INVALID' USING DETAIL = 'a timesheet is created open';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_maint THEN
      RETURN OLD;
    END IF;
    IF OLD.status <> 'open' OR EXISTS (
      SELECT 1 FROM public.task_time_logs l WHERE l.timesheet_id = OLD.id) THEN
      RAISE EXCEPTION 'TIMESHEET_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_ref IS DISTINCT FROM OLD.scope_ref
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.timezone IS DISTINCT FROM OLD.timezone
     OR NEW.week_start IS DISTINCT FROM OLD.week_start
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'TIMESHEET_IMMUTABLE';
  END IF;

  -- These may only become NULL, and only when the referenced row is gone.
  IF (NEW.member_user_id IS DISTINCT FROM OLD.member_user_id
        AND (NEW.member_user_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.member_user_id)))
     OR (NEW.team_id IS DISTINCT FROM OLD.team_id
        AND (NEW.team_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.teams WHERE id = OLD.team_id)))
     OR (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        AND (NEW.workspace_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id)))
     OR (NEW.policy_workspace_id IS DISTINCT FROM OLD.policy_workspace_id
        AND (NEW.policy_workspace_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.policy_workspace_id))) THEN
    RAISE EXCEPTION 'TIMESHEET_IMMUTABLE' USING DETAIL = 'identity columns only clear on cascade';
  END IF;

  -- approver_scope is frozen at submit: it may only be set on the way into
  -- submitted (or cleared when a sheet goes back to open / returned).
  IF NEW.approver_scope IS DISTINCT FROM OLD.approver_scope AND NOT v_maint
     AND NOT (NEW.status = 'submitted' AND OLD.status IN ('open', 'returned'))
     AND NOT (NEW.status IN ('open', 'returned') AND NEW.approver_scope IS NULL) THEN
    RAISE EXCEPTION 'TIMESHEET_IMMUTABLE' USING DETAIL = 'approver_scope is frozen at submit';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_legacy := v_maint AND NEW.origin = 'legacy_migration';
    IF NOT (
      (OLD.status, NEW.status) IN (('open', 'submitted'), ('returned', 'submitted'),
                                   ('submitted', 'approved'), ('submitted', 'open'),
                                   ('submitted', 'returned'), ('approved', 'returned'),
                                   ('approved', 'open'))
      OR (v_legacy AND (OLD.status, NEW.status) = ('open', 'approved'))
    ) THEN
      RAISE EXCEPTION 'TIMESHEET_TRANSITION_INVALID'
        USING DETAIL = format('%s -> %s', OLD.status, NEW.status);
    END IF;

    IF NEW.status = 'approved' THEN
      IF NEW.decision_kind = 'manual' THEN
        IF NEW.decided_by IS NULL OR NOT public.time_can_decide_scope(
             NEW.approver_scope, NEW.team_id, NEW.policy_workspace_id,
             NEW.engagement_id, NEW.member_user_id, NEW.decided_by) THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
        END IF;
      ELSIF NEW.decision_kind = 'self' THEN
        IF NEW.approver_scope IS DISTINCT FROM 'self' OR NEW.decided_by IS DISTINCT FROM NEW.member_user_id THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
        END IF;
      ELSIF NEW.decision_kind = 'auto' THEN
        IF NEW.approver_scope IS DISTINCT FROM 'auto' OR NEW.decided_by IS NOT NULL THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
        END IF;
      ELSIF NEW.decision_kind = 'legacy' THEN
        -- Legacy import skips the decider check; decided_by may be NULL or
        -- even the member (one prod sheet's last reviewer is the member).
        IF NOT v_maint THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID' USING DETAIL = 'legacy decisions are migration-only';
        END IF;
      END IF;
    ELSIF NEW.status = 'returned' AND NOT v_maint THEN
      IF NEW.decided_by IS NULL OR NOT public.time_can_decide_scope(
           NEW.approver_scope, NEW.team_id, NEW.policy_workspace_id,
           NEW.engagement_id, NEW.member_user_id, NEW.decided_by) THEN
        RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
      END IF;
    ELSIF OLD.status = 'approved' AND NEW.status = 'open' AND NOT v_maint THEN
      -- A member reopens only their own auto or self sheet.
      IF OLD.approver_scope NOT IN ('auto', 'self') THEN
        RAISE EXCEPTION 'TIMESHEET_TRANSITION_INVALID' USING DETAIL = 'only auto or self sheets reopen to open';
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_timesheets_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_timesheets_guard();

-- trg_invoice_time_entries_guard: only approved, billable entries reserve,
-- only onto draft invoices of the same contract.
CREATE OR REPLACE FUNCTION public.tg_invoice_time_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv_status text;
  v_inv_contract uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT i.status INTO v_inv_status FROM public.invoices i WHERE i.id = OLD.invoice_id;
    IF FOUND AND v_inv_status NOT IN ('draft', 'void') THEN
      RAISE EXCEPTION 'INVOICE_TIME_ENTRY_NOT_BILLABLE' USING DETAIL = 'reservation is locked by an issued invoice';
    END IF;
    RETURN OLD;
  END IF;

  SELECT i.status, i.contract_id INTO v_inv_status, v_inv_contract
  FROM public.invoices i WHERE i.id = NEW.invoice_id;
  IF NOT FOUND OR v_inv_status <> 'draft' OR v_inv_contract IS DISTINCT FROM NEW.contract_id THEN
    RAISE EXCEPTION 'INVOICE_TIME_ENTRY_NOT_BILLABLE' USING DETAIL = 'target invoice must be a draft of the same contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.task_time_logs l
    WHERE l.id = NEW.entry_id
      AND l.payable_seconds IS NOT NULL
      AND l.legacy_status IS DISTINCT FROM 'rejected'
      AND l.context_kind <> 'personal'
      AND coalesce(l.work_type_snapshot, 'real_work') <> 'training'
  ) THEN
    RAISE EXCEPTION 'INVOICE_TIME_ENTRY_NOT_BILLABLE' USING DETAIL = 'entry is not approved billable time';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_time_entries_guard
  BEFORE INSERT OR UPDATE OF invoice_id, entry_id OR DELETE ON public.invoice_time_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_time_entries_guard();

-- trg_time_policies_guard: timezone and anchor validity, rates-need-approval.
CREATE OR REPLACE FUNCTION public.tg_time_policies_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Each rule re-checks only what this write changes, so an FK cascade
  -- (created_by/updated_by SET NULL on account deletion) always passes.
  IF NEW.timezone IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone)
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = NEW.timezone) THEN
    RAISE EXCEPTION 'TIME_POLICY_INVALID' USING DETAIL = format('unknown timezone %s', NEW.timezone);
  END IF;

  IF NEW.period_anchor IS NOT NULL AND NEW.week_start IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.period_anchor IS DISTINCT FROM OLD.period_anchor
          OR NEW.week_start IS DISTINCT FROM OLD.week_start)
     AND extract(isodow FROM NEW.period_anchor)::int <> NEW.week_start THEN
    RAISE EXCEPTION 'TIME_POLICY_INVALID' USING DETAIL = 'period_anchor must fall on week_start';
  END IF;

  -- time_resolve_policy also forces approval while member rates are on, so a
  -- row saved before rates were switched on stays safe.
  IF NEW.scope = 'team' AND NEW.approval_required = false
     AND (TG_OP = 'INSERT' OR NEW.approval_required IS DISTINCT FROM OLD.approval_required)
     AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.team_id AND t.member_rates_enabled) THEN
    RAISE EXCEPTION 'TEAM_RATES_REQUIRE_APPROVAL';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_time_policies_guard
  BEFORE INSERT OR UPDATE ON public.time_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_policies_guard();

-- trg_time_policies_events: append-only audit of every policy write.
CREATE OR REPLACE FUNCTION public.tg_time_policies_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changes := to_jsonb(NEW) - 'updated_at';
  ELSE
    SELECT jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value))
    INTO v_changes
    -- updated_by stays in the diff: an admin confirming the policy unchanged
    -- ("Looks right") only sets it, and that confirmation is worth a row.
    FROM jsonb_each(to_jsonb(NEW) - 'updated_at') n
    JOIN jsonb_each(to_jsonb(OLD) - 'updated_at') o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value;
    IF v_changes IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.time_policy_events (policy_id, actor_user_id, changes)
  VALUES (NEW.id, coalesce(NEW.updated_by, NEW.created_by), v_changes);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_time_policies_events
  AFTER INSERT OR UPDATE ON public.time_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_policies_events();

-- ── 7. Policy seed (C17, L28, L59) ─────────────────────────────────────────
-- Prodigitality is the only prod team with time on (team id constant, as in
-- 20260702000010). Its workspace row keeps tracking_enabled = false, so its
-- people stay on the team option and nobody is asked a new question; the
-- team row routes approval to team approvers (Business comp). No-op on dev.
INSERT INTO public.time_policies (scope, workspace_id, tracking_enabled, period_kind, week_start, timezone,
                                  approval_required, allow_manual_entries, rounding_minutes, reminder_days)
SELECT 'workspace', t.workspace_id, false, 'weekly', 1, 'Asia/Manila', true, true, 0, 1
FROM public.teams t
WHERE t.id = 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba' AND t.workspace_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.time_policies (scope, team_id, approver_scope, retroactive_days)
SELECT 'team', t.id, 'team', t.retroactive_log_days
FROM public.teams t
WHERE t.id = 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba'
ON CONFLICT DO NOTHING;

-- teams.retroactive_log_days moves to team policy rows (column dropped in M5).
-- Approver stays the workspace for these.
INSERT INTO public.time_policies (scope, team_id, retroactive_days)
SELECT 'team', t.id, t.retroactive_log_days
FROM public.teams t
WHERE t.retroactive_log_days IS NOT NULL
  AND t.id <> 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba'
ON CONFLICT DO NOTHING;

-- ── 8. Rebuilt existing functions (latest bodies) ──────────────────────────

-- A11. Body from 20260901160000_team_resources_and_status.sql:52-68 (the only
-- definition). Now also accepts team_members.role 'owner', matching the
-- TypeScript approver checks. Every prod 'owner' row is also teams.owner_id,
-- so nobody's access changes. CREATE OR REPLACE keeps the grants: six
-- team_resource_* RLS policies call it as authenticated.
CREATE OR REPLACE FUNCTION public.can_manage_team(p_team_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = p_team_id AND t.owner_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.team_id = p_team_id
      AND m.user_id = p_user_id
      AND m.role IN ('owner', 'admin')
  );
$$;

COMMENT ON FUNCTION public.can_manage_team(uuid, uuid) IS
  'True for the team owner or a team member with role owner or admin. Mirrors the TypeScript team approver checks.';

-- A12. Body from 20260814020000_engagement_core.sql:444-534 (the only
-- definition), plus one rule: when an assignment carries both engagements,
-- the talent engagement's hirer must be the client engagement's provider.
CREATE OR REPLACE FUNCTION public.tg_engagement_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_DELETE_FORBIDDEN';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.worker_user_id IS DISTINCT FROM OLD.worker_user_id
      OR NEW.client_engagement_id IS DISTINCT FROM OLD.client_engagement_id
      OR NEW.talent_engagement_id IS DISTINCT FROM OLD.talent_engagement_id
      OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
      OR NEW.project_title_snapshot IS DISTINCT FROM OLD.project_title_snapshot
      OR NEW.team_name_snapshot IS DISTINCT FROM OLD.team_name_snapshot
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR (
        NEW.project_id IS DISTINCT FROM OLD.project_id
        AND NOT (OLD.project_id IS NOT NULL AND NEW.project_id IS NULL)
      ) THEN
      RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_IDENTITY_IMMUTABLE';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT (OLD.status = 'active' AND NEW.status IN ('ended', 'cancelled')) THEN
      RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_STATUS_INVALID';
    END IF;

    RETURN NEW;
  ELSIF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_PROJECT_REQUIRED';
  END IF;

  IF NEW.client_engagement_id IS NOT NULL THEN
    SELECT kind, status INTO v_kind, v_status
    FROM public.engagements WHERE id = NEW.client_engagement_id;
    IF v_kind <> 'client_services' OR v_status <> 'active' THEN
      RAISE EXCEPTION 'CLIENT_ENGAGEMENT_NOT_ACTIVE';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.engagement_project_links
      WHERE engagement_id = NEW.client_engagement_id
        AND project_id = NEW.project_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'CLIENT_ENGAGEMENT_PROJECT_NOT_LINKED';
    END IF;
  END IF;

  IF NEW.talent_engagement_id IS NOT NULL THEN
    SELECT kind, status INTO v_kind, v_status
    FROM public.engagements WHERE id = NEW.talent_engagement_id;
    IF v_kind <> 'talent_services' OR v_status <> 'active' THEN
      RAISE EXCEPTION 'TALENT_ENGAGEMENT_NOT_ACTIVE';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.engagement_parties
      WHERE engagement_id = NEW.talent_engagement_id
        AND position = 'provider'
        AND capacity = 'talent'
        AND user_id = NEW.worker_user_id
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_WORKER_NOT_TALENT_PROVIDER';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.engagement_project_links
      WHERE engagement_id = NEW.talent_engagement_id
        AND project_id = NEW.project_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'TALENT_ENGAGEMENT_PROJECT_NOT_LINKED';
    END IF;
    -- New (A12): a placed talent's hirer is the client engagement's provider.
    IF NEW.client_engagement_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.engagement_parties hirer
      JOIN public.engagement_parties provider
        ON provider.engagement_id = NEW.client_engagement_id
       AND provider.position = 'provider'
       AND provider.user_id = hirer.user_id
      WHERE hirer.engagement_id = NEW.talent_engagement_id
        AND hirer.position = 'hirer'
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER';
    END IF;
  ELSIF NEW.client_engagement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.engagement_parties
    WHERE engagement_id = NEW.client_engagement_id
      AND position = 'provider'
      AND capacity = 'consultant'
      AND user_id = NEW.worker_user_id
  ) THEN
    RAISE EXCEPTION 'UNCONTRACTED_WORKER_REQUIRES_TALENT_ENGAGEMENT';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 9. Contract layer: period columns (authoring later, D8) ────────────────
-- Nullable; NULL falls back to the policy workspace's policy, then the
-- platform default. The settings guard ignores unlisted columns, and
-- sign_contract_position_and_activate leaves them NULL.
ALTER TABLE public.engagement_time_settings
  ADD COLUMN period_kind text CHECK (period_kind IN ('weekly', 'biweekly', 'semi_monthly', 'monthly')),
  ADD COLUMN timezone text,
  ADD COLUMN week_start smallint CHECK (week_start BETWEEN 1 AND 7);

-- ── 10. RLS + REVOKE on existing time tables (CHANGE-18, L42) ─────────────
-- Codifies the RLS that was enabled by hand, and removes the full anon and
-- authenticated grants. Only the service-role backend reads these tables;
-- web/ never queries them.
ALTER TABLE public.task_time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_time_log_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_log_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_member_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_time_logs, public.task_time_log_segments, public.time_log_comments,
  public.team_member_rates FROM anon, authenticated;
-- REVOKE only (RLS is already on, with no policies).
REVOKE ALL ON public.payouts, public.engagement_time_settings, public.engagement_time_rates,
  public.engagement_assignments, public.invoice_line_items FROM anon, authenticated;

-- ── 11. Notification types (emitted from backend PR-1 on) ──────────────────
INSERT INTO public.notification_types (name, category, priority, email_eligible, email_delay_seconds) VALUES
  ('timesheet_submitted',        'specific', 'medium', true,  3600),
  ('timesheet_returned',         'specific', 'high',   true,  600),
  ('timesheet_reminder',         'specific', 'medium', true,  600),
  ('time_payout_recorded',       'specific', 'medium', true,  600),
  ('timesheet_approved',         'specific', 'medium', false, 600),
  ('timesheet_reopened',         'specific', 'medium', false, 600),
  ('timesheet_reopen_requested', 'specific', 'medium', false, 600),
  ('timer_running_long',         'specific', 'medium', false, 600),
  ('timesheets_imported',        'specific', 'medium', false, 600),
  ('timer_auto_stopped',         'specific', 'high',   false, 600)
ON CONFLICT (name) DO NOTHING;

-- ── 12. D16: curation for today's uncurated team loggers ───────────────────
-- People who log for a team through the old fallback (project_teams ∩
-- team_members, no project_team_members row) would lose the team option at
-- cutover. Give them the curation row. The insert never touches
-- project_access (the sync trigger acts only on DELETE), and only pairs
-- that already have project access are curated.
INSERT INTO public.project_team_members (project_id, team_id, user_id, added_by)
SELECT DISTINCT l.project_id, l.team_id, l.member_user_id, NULL::uuid
FROM public.task_time_logs l
JOIN public.project_access pa ON pa.project_id = l.project_id AND pa.user_id = l.member_user_id
JOIN public.project_teams pt ON pt.project_id = l.project_id AND pt.team_id = l.team_id
JOIN public.team_members tm ON tm.team_id = l.team_id AND tm.user_id = l.member_user_id
WHERE l.team_id IS NOT NULL
ON CONFLICT (project_id, team_id, user_id) DO NOTHING;

-- ── 13. Function privileges: service role only ─────────────────────────────
-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon and authenticated; take it back. can_manage_team keeps its grants.
REVOKE ALL ON FUNCTION
  public.time_workspace_has_feature(uuid, text),
  public.time_period_for(text, text, smallint, date, timestamptz),
  public.time_scope_label(text, uuid),
  public.time_resolve_policy(text, uuid, uuid, timestamptz),
  public.time_ensure_workspace_policy(uuid, text, uuid),
  public.time_sheet_scope_for(text, uuid, uuid),
  public.time_ensure_timesheet(uuid, text, uuid, uuid, timestamptz),
  public.time_can_decide_scope(text, uuid, uuid, uuid, uuid, uuid),
  public.can_decide_timesheet(uuid, uuid),
  public.can_view_timesheet(uuid, uuid),
  public.time_billing_floor(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.time_workspace_has_feature(uuid, text),
  public.time_period_for(text, text, smallint, date, timestamptz),
  public.time_scope_label(text, uuid),
  public.time_resolve_policy(text, uuid, uuid, timestamptz),
  public.time_ensure_workspace_policy(uuid, text, uuid),
  public.time_sheet_scope_for(text, uuid, uuid),
  public.time_ensure_timesheet(uuid, text, uuid, uuid, timestamptz),
  public.time_can_decide_scope(text, uuid, uuid, uuid, uuid, uuid),
  public.can_decide_timesheet(uuid, uuid),
  public.can_view_timesheet(uuid, uuid),
  public.time_billing_floor(uuid)
TO service_role;

REVOKE ALL ON FUNCTION
  public.tg_time_entries_context(),
  public.tg_timesheets_guard(),
  public.tg_invoice_time_entries_guard(),
  public.tg_time_policies_guard(),
  public.tg_time_policies_events(),
  public.set_time_entries_updated_at()
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
