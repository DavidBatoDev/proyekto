-- Migration: 20260724100000_create_contracts.sql
-- Date: July 24, 2026
-- Description:
--   Introduces the `contracts` domain: the commercial agreement between the
--   service provider (consultant/company) and the client for a project.
--   Before this, `projects` carried only `budget_range` (free text) and
--   `duration` (a bucket label), so nothing in the system knew the recurring
--   fee, the term length, when service ends, or when to bill. The contract is
--   the input that drives client invoicing and the project activation gate.
--
--   Term dates (`service_end_date`, `contract_end_date`) are computed in the
--   service layer and STORED rather than generated, so a renewal or amendment
--   can override them. A signed contract is never mutated in place: superseding
--   one inserts `version + 1`, which is why the live-contract uniqueness is a
--   partial index on status rather than a plain unique on project_id.

CREATE TABLE IF NOT EXISTS public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  contract_number text,
  status text NOT NULL DEFAULT 'draft',

  -- Parties. Snapshotted onto the contract so a later profile edit does not
  -- silently rewrite an agreement that was already signed.
  provider_name text,
  provider_address text,
  provider_tin text,
  provider_email text,
  client_name text,
  client_contact_name text,
  client_address text,
  client_tin text,
  client_email text,
  client_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Commercial terms.
  currency text NOT NULL DEFAULT 'USD',
  billing_mode text NOT NULL DEFAULT 'retainer',
  recurring_fee numeric,
  -- CLIENT-facing hourly rate. Deliberately distinct from
  -- task_time_logs.rate_snapshot, which is the member's internal cost rate and
  -- must never be billed to or shown to a client.
  client_hourly_rate numeric,
  included_hours numeric,
  invoice_cadence text NOT NULL DEFAULT 'monthly',
  period_source text NOT NULL DEFAULT 'team_config',
  invoice_offset_days integer NOT NULL DEFAULT 0,
  due_days integer NOT NULL DEFAULT 15,
  invoice_number_prefix text,
  service_description text,
  payment_method text,

  -- Term.
  service_start_date date,
  term_count integer,
  term_unit text,
  service_end_date date,
  contract_end_date date,
  auto_renew boolean NOT NULL DEFAULT false,
  notice_days integer,

  -- Document.
  clauses jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  signed_by_consultant_at timestamptz,
  signed_by_consultant_name text,
  signed_by_client_at timestamptz,
  signed_by_client_name text,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contracts_status_check
    CHECK (status IN ('draft', 'sent', 'signed', 'active', 'ended', 'cancelled')),
  CONSTRAINT contracts_billing_mode_check
    CHECK (billing_mode IN ('retainer', 'time_based', 'hybrid')),
  CONSTRAINT contracts_invoice_cadence_check
    CHECK (invoice_cadence IN ('monthly', 'semi_monthly', 'custom')),
  CONSTRAINT contracts_period_source_check
    CHECK (period_source IN ('team_config', 'contract')),
  CONSTRAINT contracts_term_unit_check
    CHECK (term_unit IS NULL OR term_unit IN ('month', 'year')),
  CONSTRAINT contracts_term_count_check
    CHECK (term_count IS NULL OR term_count > 0),
  CONSTRAINT contracts_due_days_check
    CHECK (due_days >= 0),
  CONSTRAINT contracts_invoice_offset_days_check
    CHECK (invoice_offset_days >= 0),
  CONSTRAINT contracts_version_check
    CHECK (version > 0),
  CONSTRAINT contracts_project_version_unique
    UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_contracts_project_id
  ON public.contracts(project_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_contracts_client_user_id
  ON public.contracts(client_user_id)
  WHERE client_user_id IS NOT NULL;

-- One live contract per project. Draft/sent/ended/cancelled rows are
-- unconstrained so amendments and history can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_live_per_project
  ON public.contracts(project_id)
  WHERE status IN ('signed', 'active');

-- Drives the scheduled-invoice scan: active contracts whose service window is
-- open.
CREATE INDEX IF NOT EXISTS idx_contracts_billing_window
  ON public.contracts(service_start_date, service_end_date)
  WHERE status IN ('signed', 'active');

DROP TRIGGER IF EXISTS trg_contracts_updated_at ON public.contracts;
CREATE TRIGGER trg_contracts_updated_at
BEFORE UPDATE ON public.contracts
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- SELECT: anyone with project access, plus the project's client/consultant of
-- record and the contract's own client user (who may not have an access row
-- until they accept an invite).
DROP POLICY IF EXISTS "Project members can view contracts" ON public.contracts;
CREATE POLICY "Project members can view contracts" ON public.contracts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = contracts.project_id
        AND pa.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = contracts.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
    OR contracts.client_user_id = auth.uid()
  );

-- INSERT/UPDATE: owner/admin/editor on the project, or the client/consultant of
-- record. Client counter-signing goes through the backend service role, not
-- this policy.
DROP POLICY IF EXISTS "Project editors can insert contracts" ON public.contracts;
CREATE POLICY "Project editors can insert contracts" ON public.contracts
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = contracts.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = contracts.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Project editors can update contracts" ON public.contracts;
CREATE POLICY "Project editors can update contracts" ON public.contracts
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = contracts.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = contracts.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = contracts.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = contracts.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
  );

-- DELETE: owner/admin only, and never a signed agreement.
DROP POLICY IF EXISTS "Project admins can delete draft contracts" ON public.contracts;
CREATE POLICY "Project admins can delete draft contracts" ON public.contracts
  FOR DELETE
  USING (
    contracts.status IN ('draft', 'cancelled')
    AND (
      EXISTS (
        SELECT 1 FROM public.project_access pa
        WHERE pa.project_id = contracts.project_id
          AND pa.user_id = auth.uid()
          AND pa.role IN ('owner', 'admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = contracts.project_id
          AND p.consultant_id = auth.uid()
      )
    )
  );
