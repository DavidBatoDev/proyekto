-- Migration: 20260724100010_create_project_economics.sql
-- Date: July 24, 2026
-- Description:
--   Per-project budget split (projections): how much of the contract revenue is
--   company margin versus the pool available to pay team members. Required
--   before a project can be flipped to `active`.
--
--   SECURITY NOTE: this table is INTERNAL. A client-role member of the project
--   must never be able to read it — the RLS SELECT policy deliberately excludes
--   projects.client_id and any `viewer`/`commenter` access row, unlike
--   `contracts` (which the client must be able to read and sign).

CREATE TABLE IF NOT EXISTS public.project_economics (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  currency text NOT NULL DEFAULT 'USD',
  company_percent numeric NOT NULL DEFAULT 0,
  team_percent numeric NOT NULL DEFAULT 100,
  -- Free-form flags set by the consultant during activation, e.g.
  -- {"hour_limits_ack": true} when they deliberately run hourly members
  -- without a weekly/monthly cap.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_economics_percent_range_check
    CHECK (company_percent >= 0 AND team_percent >= 0),
  CONSTRAINT project_economics_percent_sum_check
    CHECK (company_percent + team_percent = 100)
);

CREATE INDEX IF NOT EXISTS idx_project_economics_contract_id
  ON public.project_economics(contract_id)
  WHERE contract_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_project_economics_updated_at ON public.project_economics;
CREATE TRIGGER trg_project_economics_updated_at
BEFORE UPDATE ON public.project_economics
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

ALTER TABLE public.project_economics ENABLE ROW LEVEL SECURITY;

-- SELECT/INSERT/UPDATE: the project's consultant of record, or an
-- owner/admin access row. No client, no editor, no viewer.
DROP POLICY IF EXISTS "Project owners can view project economics" ON public.project_economics;
CREATE POLICY "Project owners can view project economics" ON public.project_economics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_economics.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_economics.project_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can insert project economics" ON public.project_economics;
CREATE POLICY "Project owners can insert project economics" ON public.project_economics
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_economics.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_economics.project_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can update project economics" ON public.project_economics;
CREATE POLICY "Project owners can update project economics" ON public.project_economics
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_economics.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_economics.project_id
        AND p.consultant_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_economics.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_economics.project_id
        AND p.consultant_id = auth.uid()
    )
  );
