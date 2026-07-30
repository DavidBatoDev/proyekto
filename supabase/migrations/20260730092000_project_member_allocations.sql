-- Migration: 20260730092000_project_member_allocations.sql
-- Date: July 30, 2026
-- Description:
--   Persists the per-member slice of the team pool, and whether the split is
--   even or hand-tuned.
--
--   Until now the per-member "Monthly budget" in the rate calculator was pure
--   client-side draft state: it was re-seeded from an even split on every mount
--   and never sent to any API, so every edit was lost on reload. Only the
--   values DERIVED from it (hourly rate, hour caps) survived, which is why the
--   numbers looked half-saved.
--
--   Why a new table rather than a column on `team_member_rates`:
--     * That table is rate HISTORY — a partial unique index on `end_date IS
--       NULL` plus `task_time_logs.rate_snapshot` exist precisely so past cost
--       is immutable. Storing a budget there means either mutating the live
--       rate row (an allocation is a budget, not a price) or spawning a rate
--       row per edit, which pollutes the history cost rollups read.
--     * Its BEFORE INSERT OR UPDATE consultant-verification trigger
--       (20260509000010) would fire on every budget edit — an unrelated failure
--       mode for a slider drag.
--     * The allocation MODE is a per-project scalar with no home on a
--       per-member rate row at all.
--   The PK (project_id, team_id, user_id) also structurally fixes a real bug:
--   the calculator keyed its drafts by user_id alone while its rows were keyed
--   by team+user, so one person on two attached teams shared a single draft.
--
--   SECURITY NOTE: this table is INTERNAL, exactly like `project_economics`.
--   A client-role member must never read it — the policies below deliberately
--   exclude projects.client_id and any viewer/commenter/editor access row.

ALTER TABLE public.project_economics
  ADD COLUMN IF NOT EXISTS allocation_mode text NOT NULL DEFAULT 'equal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_economics_allocation_mode_check'
  ) THEN
    ALTER TABLE public.project_economics
      ADD CONSTRAINT project_economics_allocation_mode_check
      CHECK (allocation_mode IN ('equal', 'custom'));
  END IF;
END
$$;

COMMENT ON COLUMN public.project_economics.allocation_mode IS
  'equal = every member in the split draws the same slice, derived on read. custom = per-member amounts in project_member_allocations govern.';

CREATE TABLE IF NOT EXISTS public.project_member_allocations (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- NULL = the member is in the split but has no explicit amount yet; the
  -- even-split derivation fills in.
  monthly_allocation numeric,
  currency text NOT NULL DEFAULT 'USD',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (project_id, team_id, user_id),
  -- Mirrors team_member_rates_project_team_fk (20260511000010): detaching a
  -- team from the project cascades its allocations away with it.
  CONSTRAINT project_member_allocations_project_team_fk
    FOREIGN KEY (project_id, team_id)
    REFERENCES public.project_teams (project_id, team_id) ON DELETE CASCADE,
  CONSTRAINT project_member_allocations_amount_check
    CHECK (monthly_allocation IS NULL OR monthly_allocation >= 0)
);

CREATE INDEX IF NOT EXISTS idx_project_member_allocations_project
  ON public.project_member_allocations(project_id);

DROP TRIGGER IF EXISTS trg_project_member_allocations_updated_at
  ON public.project_member_allocations;
CREATE TRIGGER trg_project_member_allocations_updated_at
BEFORE UPDATE ON public.project_member_allocations
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

ALTER TABLE public.project_member_allocations ENABLE ROW LEVEL SECURITY;

-- Same predicate as project_economics (20260724100010): the project's
-- consultant of record, or an owner/admin access row. Flat EXISTS over
-- project_access / projects with no self-reference, so no RLS recursion.
-- Unlike economics (a singleton) this one also needs DELETE, for removing a
-- member from the split.
DROP POLICY IF EXISTS "Project owners can view member allocations" ON public.project_member_allocations;
CREATE POLICY "Project owners can view member allocations" ON public.project_member_allocations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_member_allocations.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_member_allocations.project_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can insert member allocations" ON public.project_member_allocations;
CREATE POLICY "Project owners can insert member allocations" ON public.project_member_allocations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_member_allocations.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_member_allocations.project_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can update member allocations" ON public.project_member_allocations;
CREATE POLICY "Project owners can update member allocations" ON public.project_member_allocations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_member_allocations.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_member_allocations.project_id
        AND p.consultant_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_member_allocations.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_member_allocations.project_id
        AND p.consultant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Project owners can delete member allocations" ON public.project_member_allocations;
CREATE POLICY "Project owners can delete member allocations" ON public.project_member_allocations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_member_allocations.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('owner', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_member_allocations.project_id
        AND p.consultant_id = auth.uid()
    )
  );
