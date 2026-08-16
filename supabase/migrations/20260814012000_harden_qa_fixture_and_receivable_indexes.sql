-- Keep service-role-only QA fixtures explicit to the database advisor and add
-- covering indexes for nullable actor/user foreign keys on the repaired tables.

BEGIN;

DROP POLICY IF EXISTS qa_fixtures_api_only ON public.qa_fixtures;
CREATE POLICY qa_fixtures_api_only ON public.qa_fixtures
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_qa_fixtures_consultant_user
  ON public.qa_fixtures(consultant_user_id);
CREATE INDEX IF NOT EXISTS idx_qa_fixtures_worker_user
  ON public.qa_fixtures(worker_user_id);
CREATE INDEX IF NOT EXISTS idx_qa_fixtures_client_user
  ON public.qa_fixtures(client_user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_recorded_by
  ON public.invoice_payments(recorded_by);
CREATE INDEX IF NOT EXISTS idx_invoice_events_actor
  ON public.invoice_events(actor_id);

COMMIT;
