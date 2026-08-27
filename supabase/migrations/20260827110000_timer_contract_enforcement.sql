-- Timer contract gating: "no contract -> no timer", rolled out per team.
--
-- Existing teams stay 'off' (grandfathered, nothing changes on release day);
-- an owner opts into 'warn' (timer allowed, warning surfaced) or 'enforce'
-- (timer refused with NO_ACTIVE_CONTRACT for members without a signed seat on
-- a live contract). Eligibility itself is computed in
-- EngagementEligibilityService, never in SQL.
--
-- task_time_logs.flagged_reason marks logs the enforcement pass wants a
-- reviewer to look at (e.g. 'contract_lapsed' when the contract ended before
-- the timer stopped) without blocking the stop itself.

BEGIN;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS contract_enforcement text NOT NULL DEFAULT 'off';

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_contract_enforcement_check,
  ADD CONSTRAINT teams_contract_enforcement_check
    CHECK (contract_enforcement IN ('off', 'warn', 'enforce'));

COMMENT ON COLUMN public.teams.contract_enforcement IS
  'Per-team rollout of contract-gated time tracking: off (grandfathered default), warn (allow + surface warning), enforce (refuse timer without a live signed contract seat).';

ALTER TABLE public.task_time_logs
  ADD COLUMN IF NOT EXISTS flagged_reason text;

COMMENT ON COLUMN public.task_time_logs.flagged_reason IS
  'Set by the enforcement pass when a log needs reviewer attention (e.g. contract_lapsed, no_active_contract). Never blocks the log itself.';

COMMIT;
