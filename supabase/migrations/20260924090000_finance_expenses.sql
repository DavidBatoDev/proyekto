-- Migration: 20260924090000_finance_expenses.sql
--
-- Purpose:
--   Team operating expenses (money out that is not a member payout): salaries
--   paid outside the payouts module, contractors, software subscriptions,
--   overhead, taxes/fees. One row per expense; a recurring expense is ONE row
--   with recurrence = monthly|yearly that the backend expands at read time
--   (expense-rollup.ts) — occurrences are never materialized.
--
--   Payouts are NOT copied here: the backend adds non-void payouts to the
--   expense summary as virtual salary rows, so the payouts table stays the
--   single source of truth for member pay.
--
--   Voiding is soft (voided_at/voided_by); financial history is never deleted.
--
--   document_id deliberately has NO foreign key: finance_documents
--   (20260826090000) is not applied in every environment yet.
--
--   Like finance_books, the table is backend-dark under RLS: service-role
--   only, no anon/authenticated policies. The backend access check (team book
--   role -> manage_expenses / view_costs) is the security boundary.

BEGIN;

CREATE TABLE IF NOT EXISTS public.finance_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  book_id uuid REFERENCES public.finance_books(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL,
  vendor text,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  incurred_on date NOT NULL,
  recurrence text NOT NULL DEFAULT 'none',
  recurrence_ends_on date,
  document_id uuid,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT finance_expenses_category_check
    CHECK (category IN (
      'salary', 'contractor', 'software_subscription',
      'overhead', 'tax_fees', 'other'
    )),
  CONSTRAINT finance_expenses_description_length_check
    CHECK (char_length(description) BETWEEN 1 AND 300),
  CONSTRAINT finance_expenses_amount_positive_check
    CHECK (amount > 0),
  CONSTRAINT finance_expenses_currency_check
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_expenses_recurrence_check
    CHECK (recurrence IN ('none', 'monthly', 'yearly')),
  CONSTRAINT finance_expenses_recurrence_end_check
    CHECK (recurrence_ends_on IS NULL OR recurrence_ends_on >= incurred_on)
);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_team_incurred
  ON public.finance_expenses (team_id, incurred_on);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_project
  ON public.finance_expenses (project_id)
  WHERE project_id IS NOT NULL;

COMMENT ON TABLE public.finance_expenses IS
  'Team operating expenses (money out other than payouts). Recurring rows are expanded at read time by the backend, never materialized; payouts are added to summaries as virtual salary rows, never copied here. Service-role only; voiding is soft.';
COMMENT ON COLUMN public.finance_expenses.document_id IS
  'Optional finance_documents id (proof/receipt). No FK: finance_documents is not applied in every environment.';

DROP TRIGGER IF EXISTS update_finance_expenses_updated_at
  ON public.finance_expenses;
CREATE TRIGGER update_finance_expenses_updated_at
  BEFORE UPDATE ON public.finance_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- No permissive policy: all access is via the backend service-role client.
ALTER TABLE public.finance_expenses ENABLE ROW LEVEL SECURITY;

COMMIT;
