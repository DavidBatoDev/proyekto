-- Migration: 20261003090000_time_plan_keys.sql  (time management rebuild, M0)
--
-- docs/13-proposals/time-management/migrations-and-rollout.md#m0-plan-keys
--
-- Splits the single `time_tracking` plan feature into the pricing ladder:
--   Free        personal timer only ("Just me" needs no key)
--   Pro         time_tracking (relabelled "Timesheets and approvals"),
--               time_billable_invoices
--   Business    + time_team_rules, time_payouts, time_reports_export
--   Enterprise  + time_approval_chains, time_audit_export
-- Contract (engagement) time is never plan-gated, so it has no key.
--
-- Additive only. `time_tracking` keeps its kind and its per-plan values; only
-- its label and description change. Applied before M1 because M1's
-- time_resolve_policy reads `time_team_rules`.
--
-- Until backend PR-1 registers the new keys in entitlement-keys.ts, the
-- running backend reports them as unknown_to_code drift (enforced: false).
-- That is cosmetic: nothing enforces them yet.
--
-- ROLLBACK (manual):
--   DELETE FROM public.plan_limits WHERE limit_key IN ('time_billable_invoices',
--     'time_team_rules','time_payouts','time_reports_export',
--     'time_approval_chains','time_audit_export');
--   DELETE FROM public.plan_limit_keys WHERE key IN (same six);
--   UPDATE public.plan_limit_keys SET label = 'Time tracking and timesheets',
--     description = 'Log time against work and review team timesheets.'
--     WHERE key = 'time_tracking';

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.plan_limit_keys
    WHERE key = 'time_tracking' AND kind = 'feature'
  ) THEN
    RAISE EXCEPTION 'M0 precheck: plan key time_tracking (feature) is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.plan_limit_keys
    WHERE key IN ('time_billable_invoices', 'time_team_rules', 'time_payouts',
                  'time_reports_export', 'time_approval_chains', 'time_audit_export')
      AND kind <> 'feature'
  ) THEN
    RAISE EXCEPTION 'M0 precheck: a time plan key already exists with a non-feature kind';
  END IF;
END $$;

INSERT INTO public.plan_limit_keys (key, kind, label, description, unit, group_key, sort_order) VALUES
  ('time_tracking', 'feature', 'Timesheets and approvals',
   'Group time into timesheets and route them for approval.', NULL, 'team', 120),
  ('time_billable_invoices', 'feature', 'Billable hours on invoices',
   'Bill approved hours on client invoices.', NULL, 'team', 121),
  ('time_team_rules', 'feature', 'Team approvers and time rules',
   'Let a team set its own approvers, periods and rules.', NULL, 'team', 122),
  ('time_payouts', 'feature', 'Payouts',
   'Record payouts for approved team time.', NULL, 'team', 123),
  ('time_reports_export', 'feature', 'Workspace time reports and export',
   'Workspace-wide time reports and CSV export.', NULL, 'team', 124),
  ('time_approval_chains', 'feature', 'Custom approval chains',
   'Multi-step approval for timesheets.', NULL, 'team', 125),
  ('time_audit_export', 'feature', 'Time audit export',
   'Export the full timesheet history.', NULL, 'team', 126)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  group_key = EXCLUDED.group_key,
  sort_order = EXCLUDED.sort_order;   -- never kind

INSERT INTO public.plan_limits (plan, limit_key, kind, int_value, bool_value, per_seat, display_label) VALUES
  ('free',       'time_billable_invoices', 'feature', NULL, false, false, NULL),
  ('pro',        'time_billable_invoices', 'feature', NULL, true,  false, NULL),
  ('business',   'time_billable_invoices', 'feature', NULL, true,  false, NULL),
  ('enterprise', 'time_billable_invoices', 'feature', NULL, true,  false, NULL),
  ('free',       'time_team_rules',        'feature', NULL, false, false, NULL),
  ('pro',        'time_team_rules',        'feature', NULL, false, false, NULL),
  ('business',   'time_team_rules',        'feature', NULL, true,  false, NULL),
  ('enterprise', 'time_team_rules',        'feature', NULL, true,  false, NULL),
  ('free',       'time_payouts',           'feature', NULL, false, false, NULL),
  ('pro',        'time_payouts',           'feature', NULL, false, false, NULL),
  ('business',   'time_payouts',           'feature', NULL, true,  false, NULL),
  ('enterprise', 'time_payouts',           'feature', NULL, true,  false, NULL),
  ('free',       'time_reports_export',    'feature', NULL, false, false, NULL),
  ('pro',        'time_reports_export',    'feature', NULL, false, false, NULL),
  ('business',   'time_reports_export',    'feature', NULL, true,  false, NULL),
  ('enterprise', 'time_reports_export',    'feature', NULL, true,  false, NULL),
  ('free',       'time_approval_chains',   'feature', NULL, false, false, NULL),
  ('pro',        'time_approval_chains',   'feature', NULL, false, false, NULL),
  ('business',   'time_approval_chains',   'feature', NULL, false, false, NULL),
  ('enterprise', 'time_approval_chains',   'feature', NULL, true,  false, NULL),
  ('free',       'time_audit_export',      'feature', NULL, false, false, NULL),
  ('pro',        'time_audit_export',      'feature', NULL, false, false, NULL),
  ('business',   'time_audit_export',      'feature', NULL, false, false, NULL),
  ('enterprise', 'time_audit_export',      'feature', NULL, true,  false, NULL)
ON CONFLICT (plan, limit_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
