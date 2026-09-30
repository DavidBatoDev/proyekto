-- Plan estimates for two-way contract authoring and document intake.
--
-- 20260930100000_contract_authoring_history and 20260930120000_document_intake
-- seeded these four keys open on every plan. This sets the published estimates
-- (Free / Pro / Business / Enterprise). NULL int_value means unlimited.
--
--   contract_counterparty_authoring   off / on / on / on
--   active_contracts                  3 / 25 / 250 / unlimited
--   document_intake_pages_monthly     30 / 500 / 3,000 / unlimited
--   document_intake_onboarding_pages  200 on every plan
--
-- Additive and idempotent: the cells already exist, so ON CONFLICT updates the
-- values in place and leaves kind, per_seat and display_label as seeded.
BEGIN;

INSERT INTO public.plan_limits (plan, limit_key, kind, int_value, bool_value, per_seat, display_label) VALUES
  ('free',       'contract_counterparty_authoring', 'feature', NULL, false, false, NULL),
  ('pro',        'contract_counterparty_authoring', 'feature', NULL, true, false, NULL),
  ('business',   'contract_counterparty_authoring', 'feature', NULL, true, false, NULL),
  ('enterprise', 'contract_counterparty_authoring', 'feature', NULL, true, false, NULL),
  ('free',       'active_contracts', 'count', 3, NULL, false, NULL),
  ('pro',        'active_contracts', 'count', 25, NULL, false, NULL),
  ('business',   'active_contracts', 'count', 250, NULL, false, NULL),
  ('enterprise', 'active_contracts', 'count', NULL, NULL, false, NULL),
  ('free',       'document_intake_pages_monthly', 'quota', 30, NULL, false, NULL),
  ('pro',        'document_intake_pages_monthly', 'quota', 500, NULL, false, NULL),
  ('business',   'document_intake_pages_monthly', 'quota', 3000, NULL, false, NULL),
  ('enterprise', 'document_intake_pages_monthly', 'quota', NULL, NULL, false, NULL),
  ('free',       'document_intake_onboarding_pages', 'quota', 200, NULL, false, NULL),
  ('pro',        'document_intake_onboarding_pages', 'quota', 200, NULL, false, NULL),
  ('business',   'document_intake_onboarding_pages', 'quota', 200, NULL, false, NULL),
  ('enterprise', 'document_intake_onboarding_pages', 'quota', 200, NULL, false, NULL)
ON CONFLICT (plan, limit_key) DO UPDATE SET
  int_value = EXCLUDED.int_value,
  bool_value = EXCLUDED.bool_value,
  updated_at = now();

COMMIT;
