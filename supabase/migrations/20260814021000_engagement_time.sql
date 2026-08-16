-- P4b expand: engagement-scoped time policy, contractual rates, talent
-- submissions, and durable work attribution.
--
-- Signed contract versions remain the legal pricing authority. These tables
-- project their effective time rules and rates; they never override a signed
-- contract. team_member_rates remains a legacy/unengaged execution default.
-- A fixed-price client engagement can therefore coexist with an hourly talent
-- engagement without exposing talent identity, cost, or consultant margin.
--
-- This migration is backend-dark. Existing logs remain valid with a null
-- engagement_assignment_id, and no current runtime path is changed.

BEGIN;

CREATE TABLE public.engagement_time_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.engagements(id) ON DELETE RESTRICT,
  source_contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  tracking_mode text NOT NULL DEFAULT 'optional',
  approval_mode text NOT NULL DEFAULT 'none',
  allow_manual_entries boolean NOT NULL DEFAULT true,
  rounding_minutes integer NOT NULL DEFAULT 0,
  weekly_limit_minutes integer,
  client_hours_detail_level text NOT NULL DEFAULT 'none',
  effective_from date NOT NULL,
  effective_until date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_time_settings_tracking_mode_check
    CHECK (tracking_mode IN ('disabled', 'optional', 'required')),
  CONSTRAINT engagement_time_settings_approval_mode_check
    CHECK (approval_mode IN ('none', 'provider_submit_hirer_approve')),
  CONSTRAINT engagement_time_settings_rounding_check
    CHECK (rounding_minutes IN (0, 5, 6, 10, 15, 30)),
  CONSTRAINT engagement_time_settings_weekly_limit_check
    CHECK (weekly_limit_minutes IS NULL OR weekly_limit_minutes > 0),
  CONSTRAINT engagement_time_settings_detail_level_check
    CHECK (client_hours_detail_level IN ('none', 'summary', 'detailed')),
  CONSTRAINT engagement_time_settings_window_check
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE INDEX idx_engagement_time_settings_effective
  ON public.engagement_time_settings(engagement_id, effective_from DESC);

COMMENT ON TABLE public.engagement_time_settings IS
  'Effective-dated projection of signed engagement time policy. Attributed commercial work follows this policy even when a team default disables time tracking.';
COMMENT ON COLUMN public.engagement_time_settings.client_hours_detail_level IS
  'Controls client-facing invoice evidence only. It never exposes worker identity, talent-side rates, payouts, or consultant margin.';

CREATE TABLE public.engagement_time_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.engagements(id) ON DELETE RESTRICT,
  source_contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  worker_user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  rate_kind text NOT NULL,
  unit text NOT NULL,
  work_type text,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_time_rates_kind_check
    CHECK (rate_kind IN ('billing', 'cost')),
  CONSTRAINT engagement_time_rates_unit_check
    CHECK (unit IN ('hour', 'month', 'fixed')),
  CONSTRAINT engagement_time_rates_work_type_check
    CHECK (work_type IS NULL OR work_type IN ('real_work', 'training')),
  CONSTRAINT engagement_time_rates_amount_check
    CHECK (amount >= 0),
  CONSTRAINT engagement_time_rates_currency_check
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT engagement_time_rates_window_check
    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE INDEX idx_engagement_time_rates_effective
  ON public.engagement_time_rates(
    engagement_id,
    rate_kind,
    unit,
    effective_from DESC
  );
CREATE INDEX idx_engagement_time_rates_worker
  ON public.engagement_time_rates(worker_user_id, effective_from DESC)
  WHERE worker_user_id IS NOT NULL;

COMMENT ON TABLE public.engagement_time_rates IS
  'Effective-dated rate projection sourced from a signed contract. Client-service rows are billing rates; talent-service rows are consultant cost rates.';

CREATE TABLE public.engagement_time_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.engagements(id) ON DELETE RESTRICT,
  worker_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_time_approvals_period_check
    CHECK (period_end >= period_start),
  CONSTRAINT engagement_time_approvals_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'reopened')),
  CONSTRAINT engagement_time_approvals_submission_check
    CHECK (
      status IN ('draft', 'reopened')
      OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
    ),
  CONSTRAINT engagement_time_approvals_review_check
    CHECK (
      status NOT IN ('approved', 'rejected')
      OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
  CONSTRAINT engagement_time_approvals_period_unique
    UNIQUE (engagement_id, worker_user_id, period_start, period_end)
);

CREATE INDEX idx_engagement_time_approvals_review_queue
  ON public.engagement_time_approvals(engagement_id, status, period_start DESC);
CREATE INDEX idx_engagement_time_approvals_worker
  ON public.engagement_time_approvals(worker_user_id, period_start DESC);

COMMENT ON TABLE public.engagement_time_approvals IS
  'Talent-provider timesheet submission reviewed by the consultant hirer. Client invoice acceptance never changes this payable-time decision.';

CREATE TABLE public.engagement_time_approval_items (
  approval_id uuid NOT NULL REFERENCES public.engagement_time_approvals(id) ON DELETE RESTRICT,
  time_log_id uuid NOT NULL REFERENCES public.task_time_logs(id) ON DELETE RESTRICT,
  payable_duration_seconds integer NOT NULL,
  rate_amount_snapshot numeric(12,2) NOT NULL,
  rate_unit_snapshot text NOT NULL,
  currency_snapshot text NOT NULL,
  amount_snapshot numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (approval_id, time_log_id),
  CONSTRAINT engagement_time_approval_items_duration_check
    CHECK (payable_duration_seconds >= 0),
  CONSTRAINT engagement_time_approval_items_rate_check
    CHECK (rate_amount_snapshot >= 0),
  CONSTRAINT engagement_time_approval_items_unit_check
    CHECK (rate_unit_snapshot IN ('hour', 'month', 'fixed')),
  CONSTRAINT engagement_time_approval_items_amount_check
    CHECK (amount_snapshot >= 0),
  CONSTRAINT engagement_time_approval_items_currency_check
    CHECK (length(trim(currency_snapshot)) > 0)
);

CREATE INDEX idx_engagement_time_approval_items_log
  ON public.engagement_time_approval_items(time_log_id);

COMMENT ON TABLE public.engagement_time_approval_items IS
  'Exact logs and payable snapshots covered by one talent timesheet approval. Submitted/approved items are immutable.';

ALTER TABLE public.task_time_logs
  ADD COLUMN IF NOT EXISTS engagement_assignment_id uuid;

ALTER TABLE public.task_time_logs
  DROP CONSTRAINT IF EXISTS task_time_logs_engagement_assignment_id_fkey,
  ADD CONSTRAINT task_time_logs_engagement_assignment_id_fkey
    FOREIGN KEY (engagement_assignment_id)
    REFERENCES public.engagement_assignments(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_task_time_logs_engagement_assignment
  ON public.task_time_logs(engagement_assignment_id, started_at DESC)
  WHERE engagement_assignment_id IS NOT NULL;

COMMENT ON COLUMN public.task_time_logs.engagement_assignment_id IS
  'Commercial attribution for engagement-enabled work. Null remains valid for internal work and all legacy contracts/logs.';

CREATE OR REPLACE FUNCTION public.tg_engagement_time_settings_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_contract_engagement_id uuid;
  v_contract_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_SETTINGS_DELETE_FORBIDDEN';
  END IF;

  SELECT kind INTO v_kind
  FROM public.engagements
  WHERE id = NEW.engagement_id;

  SELECT engagement_id, status INTO v_contract_engagement_id, v_contract_status
  FROM public.contracts
  WHERE id = NEW.source_contract_id;

  IF v_contract_engagement_id IS DISTINCT FROM NEW.engagement_id
    OR v_contract_status NOT IN ('signed', 'ended') THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_SETTINGS_CONTRACT_MISMATCH';
  END IF;

  IF v_kind = 'talent_services' THEN
    IF NEW.approval_mode <> 'provider_submit_hirer_approve'
      OR NEW.client_hours_detail_level <> 'none' THEN
      RAISE EXCEPTION 'TALENT_TIME_POLICY_INVALID';
    END IF;
  ELSIF NEW.approval_mode <> 'none' THEN
    RAISE EXCEPTION 'CLIENT_TIME_APPROVAL_NOT_SUPPORTED';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
    OR NEW.source_contract_id IS DISTINCT FROM OLD.source_contract_id
    OR NEW.tracking_mode IS DISTINCT FROM OLD.tracking_mode
    OR NEW.approval_mode IS DISTINCT FROM OLD.approval_mode
    OR NEW.allow_manual_entries IS DISTINCT FROM OLD.allow_manual_entries
    OR NEW.rounding_minutes IS DISTINCT FROM OLD.rounding_minutes
    OR NEW.weekly_limit_minutes IS DISTINCT FROM OLD.weekly_limit_minutes
    OR NEW.client_hours_detail_level IS DISTINCT FROM OLD.client_hours_detail_level
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_SETTINGS_IMMUTABLE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.engagement_time_settings s
    WHERE s.engagement_id = NEW.engagement_id
      AND s.id <> NEW.id
      AND daterange(s.effective_from, COALESCE(s.effective_until + 1, 'infinity'::date), '[)')
          && daterange(NEW.effective_from, COALESCE(NEW.effective_until + 1, 'infinity'::date), '[)')
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_SETTINGS_OVERLAP';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_time_rates_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_contract_engagement_id uuid;
  v_contract_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_RATE_DELETE_FORBIDDEN';
  END IF;

  SELECT kind INTO v_kind
  FROM public.engagements
  WHERE id = NEW.engagement_id;

  SELECT engagement_id, status INTO v_contract_engagement_id, v_contract_status
  FROM public.contracts
  WHERE id = NEW.source_contract_id;

  IF v_contract_engagement_id IS DISTINCT FROM NEW.engagement_id
    OR v_contract_status NOT IN ('signed', 'ended') THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_RATE_CONTRACT_MISMATCH';
  END IF;
  IF (v_kind = 'client_services' AND NEW.rate_kind <> 'billing')
    OR (v_kind = 'talent_services' AND NEW.rate_kind <> 'cost') THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_RATE_KIND_INVALID';
  END IF;
  IF v_kind = 'talent_services'
    AND NEW.worker_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.engagement_parties
      WHERE engagement_id = NEW.engagement_id
        AND position = 'provider'
        AND user_id = NEW.worker_user_id
    ) THEN
    RAISE EXCEPTION 'TALENT_TIME_RATE_WORKER_INVALID';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
    OR NEW.source_contract_id IS DISTINCT FROM OLD.source_contract_id
    OR NEW.worker_user_id IS DISTINCT FROM OLD.worker_user_id
    OR NEW.rate_kind IS DISTINCT FROM OLD.rate_kind
    OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.work_type IS DISTINCT FROM OLD.work_type
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_RATE_IMMUTABLE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.engagement_time_rates r
    WHERE r.engagement_id = NEW.engagement_id
      AND r.id <> NEW.id
      AND r.rate_kind = NEW.rate_kind
      AND r.unit = NEW.unit
      AND r.worker_user_id IS NOT DISTINCT FROM NEW.worker_user_id
      AND r.work_type IS NOT DISTINCT FROM NEW.work_type
      AND daterange(r.effective_from, COALESCE(r.effective_until + 1, 'infinity'::date), '[)')
          && daterange(NEW.effective_from, COALESCE(NEW.effective_until + 1, 'infinity'::date), '[)')
  ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_RATE_OVERLAP';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_time_approvals_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_provider_id uuid;
  v_hirer_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENGAGEMENT_TIME_APPROVAL_DELETE_FORBIDDEN';
  END IF;

  SELECT kind INTO v_kind FROM public.engagements WHERE id = NEW.engagement_id;
  IF v_kind <> 'talent_services' THEN
    RAISE EXCEPTION 'TIME_APPROVAL_REQUIRES_TALENT_ENGAGEMENT';
  END IF;

  SELECT user_id INTO v_provider_id
  FROM public.engagement_parties
  WHERE engagement_id = NEW.engagement_id AND position = 'provider';
  SELECT user_id INTO v_hirer_id
  FROM public.engagement_parties
  WHERE engagement_id = NEW.engagement_id AND position = 'hirer';

  IF NEW.worker_user_id IS DISTINCT FROM v_provider_id THEN
    RAISE EXCEPTION 'TIME_APPROVAL_WORKER_NOT_PROVIDER';
  END IF;
  IF NEW.status IN ('submitted', 'approved', 'rejected')
    AND NEW.submitted_by IS DISTINCT FROM v_provider_id THEN
    RAISE EXCEPTION 'TIME_APPROVAL_SUBMITTER_INVALID';
  END IF;
  IF NEW.status IN ('approved', 'rejected')
    AND NEW.reviewed_by IS DISTINCT FROM v_hirer_id THEN
    RAISE EXCEPTION 'TIME_APPROVAL_REVIEWER_INVALID';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
      OR NEW.worker_user_id IS DISTINCT FROM OLD.worker_user_id
      OR NEW.period_start IS DISTINCT FROM OLD.period_start
      OR NEW.period_end IS DISTINCT FROM OLD.period_end
      OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'TIME_APPROVAL_IDENTITY_IMMUTABLE';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'draft' AND NEW.status = 'submitted')
      OR (OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status IN ('approved', 'rejected') AND NEW.status = 'reopened')
      OR (OLD.status = 'reopened' AND NEW.status = 'submitted')
    ) THEN
      RAISE EXCEPTION 'TIME_APPROVAL_STATUS_TRANSITION_INVALID';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_time_approval_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approval public.engagement_time_approvals%ROWTYPE;
  v_log public.task_time_logs%ROWTYPE;
  v_assignment public.engagement_assignments%ROWTYPE;
  v_approval_id uuid;
BEGIN
  v_approval_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.approval_id ELSE NEW.approval_id END;

  SELECT * INTO v_approval
  FROM public.engagement_time_approvals
  WHERE id = v_approval_id;

  IF v_approval.status NOT IN ('draft', 'reopened') THEN
    RAISE EXCEPTION 'TIME_APPROVAL_ITEMS_LOCKED';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'TIME_APPROVAL_ITEM_IMMUTABLE';
  END IF;

  SELECT * INTO v_log
  FROM public.task_time_logs
  WHERE id = NEW.time_log_id;

  IF v_log.engagement_assignment_id IS NULL THEN
    RAISE EXCEPTION 'TIME_APPROVAL_ITEM_REQUIRES_ASSIGNMENT';
  END IF;

  SELECT * INTO v_assignment
  FROM public.engagement_assignments
  WHERE id = v_log.engagement_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIME_APPROVAL_ITEM_ASSIGNMENT_NOT_FOUND';
  END IF;

  IF v_log.member_user_id IS DISTINCT FROM v_approval.worker_user_id
    OR v_assignment.talent_engagement_id IS DISTINCT FROM v_approval.engagement_id
    OR v_log.started_at::date < v_approval.period_start
    OR v_log.started_at::date > v_approval.period_end THEN
    RAISE EXCEPTION 'TIME_APPROVAL_ITEM_CONTEXT_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_task_time_logs_engagement_assignment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment public.engagement_assignments%ROWTYPE;
BEGIN
  IF NEW.engagement_assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.engagement_assignment_id IS DISTINCT FROM OLD.engagement_assignment_id
    AND OLD.status IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'APPROVED_TIME_ASSIGNMENT_LOCKED';
  END IF;

  SELECT * INTO v_assignment
  FROM public.engagement_assignments
  WHERE id = NEW.engagement_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIME_LOG_ASSIGNMENT_NOT_FOUND';
  END IF;
  IF v_assignment.status = 'cancelled' THEN
    RAISE EXCEPTION 'TIME_LOG_ASSIGNMENT_INVALID';
  END IF;
  IF NEW.member_user_id IS NOT NULL
    AND NEW.member_user_id IS DISTINCT FROM v_assignment.worker_user_id THEN
    RAISE EXCEPTION 'TIME_LOG_ASSIGNMENT_WORKER_MISMATCH';
  END IF;
  IF NEW.project_id IS NOT NULL
    AND NEW.project_id IS DISTINCT FROM v_assignment.project_id THEN
    RAISE EXCEPTION 'TIME_LOG_ASSIGNMENT_PROJECT_MISMATCH';
  END IF;
  IF NEW.started_at < v_assignment.started_at
    OR (v_assignment.ended_at IS NOT NULL AND NEW.started_at > v_assignment.ended_at)
    OR (NEW.ended_at IS NOT NULL AND v_assignment.ended_at IS NOT NULL
        AND NEW.ended_at > v_assignment.ended_at) THEN
    RAISE EXCEPTION 'TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_assignment_running_timer_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'active'
    AND NEW.status IN ('ended', 'cancelled')
    AND EXISTS (
      SELECT 1 FROM public.task_time_logs
      WHERE engagement_assignment_id = OLD.id
        AND ended_at IS NULL
    ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_HAS_RUNNING_TIMER';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_engagement_time_settings_touch_updated_at ON public.engagement_time_settings;
CREATE TRIGGER trg_engagement_time_settings_touch_updated_at
BEFORE UPDATE ON public.engagement_time_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_touch_updated_at();
DROP TRIGGER IF EXISTS trg_engagement_time_settings_guard ON public.engagement_time_settings;
CREATE TRIGGER trg_engagement_time_settings_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.engagement_time_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_time_settings_guard();

DROP TRIGGER IF EXISTS trg_engagement_time_rates_touch_updated_at ON public.engagement_time_rates;
CREATE TRIGGER trg_engagement_time_rates_touch_updated_at
BEFORE UPDATE ON public.engagement_time_rates
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_touch_updated_at();
DROP TRIGGER IF EXISTS trg_engagement_time_rates_guard ON public.engagement_time_rates;
CREATE TRIGGER trg_engagement_time_rates_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.engagement_time_rates
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_time_rates_guard();

DROP TRIGGER IF EXISTS trg_engagement_time_approvals_touch_updated_at ON public.engagement_time_approvals;
CREATE TRIGGER trg_engagement_time_approvals_touch_updated_at
BEFORE UPDATE ON public.engagement_time_approvals
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_touch_updated_at();
DROP TRIGGER IF EXISTS trg_engagement_time_approvals_guard ON public.engagement_time_approvals;
CREATE TRIGGER trg_engagement_time_approvals_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.engagement_time_approvals
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_time_approvals_guard();

DROP TRIGGER IF EXISTS trg_engagement_time_approval_items_guard ON public.engagement_time_approval_items;
CREATE TRIGGER trg_engagement_time_approval_items_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.engagement_time_approval_items
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_time_approval_items_guard();

DROP TRIGGER IF EXISTS trg_task_time_logs_engagement_assignment_guard ON public.task_time_logs;
CREATE TRIGGER trg_task_time_logs_engagement_assignment_guard
BEFORE INSERT OR UPDATE OF engagement_assignment_id, member_user_id, project_id, started_at, ended_at, status
ON public.task_time_logs
FOR EACH ROW EXECUTE FUNCTION public.tg_task_time_logs_engagement_assignment_guard();

DROP TRIGGER IF EXISTS trg_engagement_assignment_running_timer_guard ON public.engagement_assignments;
CREATE TRIGGER trg_engagement_assignment_running_timer_guard
BEFORE UPDATE OF status ON public.engagement_assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_assignment_running_timer_guard();

ALTER TABLE public.engagement_time_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_time_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_time_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_time_approval_items ENABLE ROW LEVEL SECURITY;

-- Intentionally no anon/authenticated policies. Client-facing APIs expose only
-- contract-governed invoice evidence; talent-side time and cost remain private.

REVOKE EXECUTE ON FUNCTION public.tg_engagement_time_settings_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_time_rates_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_time_approvals_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_time_approval_items_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_task_time_logs_engagement_assignment_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_assignment_running_timer_guard()
  FROM PUBLIC, anon, authenticated;

COMMIT;
