-- Feature dependencies: Finish->Start (and later SS/FF) edges between roadmap
-- features, visualised as arrows in the Timeline (Gantt).
--
-- Why features and not tasks: roadmap_tasks has due_date but no start_date, so a
-- task cannot render a Gantt bar. Features carry start_date/end_date and are the
-- documented deliverable unit that "carries the timeline". task_dependencies
-- (20260528000003) stays as-is for the task level.
--
-- Two things task_dependencies lacks and this table has from day one:
--   * dependency_type — so SS/FF need no future migration. SF is deliberately
--     excluded; it is vanishingly rare and confusing to expose.
--   * cycle prevention — see the trigger at the bottom.

CREATE TABLE IF NOT EXISTS public.feature_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocking_feature_id UUID NOT NULL
    REFERENCES public.roadmap_features(id) ON DELETE CASCADE,
  blocked_feature_id UUID NOT NULL
    REFERENCES public.roadmap_features(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'FS'
    CHECK (dependency_type IN ('FS', 'SS', 'FF')),
  lag_days INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocking_feature_id, blocked_feature_id),
  CHECK (blocking_feature_id <> blocked_feature_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_deps_blocking
  ON public.feature_dependencies(blocking_feature_id);
CREATE INDEX IF NOT EXISTS idx_feature_deps_blocked
  ON public.feature_dependencies(blocked_feature_id);

ALTER TABLE public.feature_dependencies ENABLE ROW LEVEL SECURITY;

-- RLS follows the milestone_features pattern (EXISTS on the parent, scoped by
-- can_view_roadmap / can_edit_roadmap) rather than task_dependencies' policy,
-- which is USING (true) and leaks every row to every authenticated user.
--
-- BOTH endpoints are checked on every policy: an edge must never be readable or
-- writable unless the caller can see (or edit) both of the roadmaps involved.
CREATE POLICY "feature_dependencies_select"
  ON public.feature_dependencies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_dependencies.blocking_feature_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_dependencies.blocked_feature_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );

CREATE POLICY "feature_dependencies_insert"
  ON public.feature_dependencies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_dependencies.blocking_feature_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_dependencies.blocked_feature_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
  );

CREATE POLICY "feature_dependencies_delete"
  ON public.feature_dependencies FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_dependencies.blocking_feature_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_dependencies.blocked_feature_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
  );

CREATE POLICY "Service role manages feature dependencies"
  ON public.feature_dependencies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Cycle prevention.
--
-- This lives in the database on purpose. The backend connects as service_role
-- and bypasses RLS entirely, and the Supabase MCP can write directly, so an
-- application-layer check alone cannot protect the data. The backend ALSO
-- pre-checks so users get a readable 409 instead of this exception surfacing
-- as a 500 — that check is for UX, this one is for integrity.
CREATE OR REPLACE FUNCTION public.prevent_feature_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Walk forward from the proposed successor. If we can reach the proposed
  -- predecessor, this edge closes a loop.
  IF EXISTS (
    WITH RECURSIVE reachable(feature_id) AS (
      SELECT NEW.blocked_feature_id
      UNION
      SELECT d.blocked_feature_id
      FROM public.feature_dependencies d
      JOIN reachable r ON d.blocking_feature_id = r.feature_id
    )
    SELECT 1 FROM reachable WHERE feature_id = NEW.blocking_feature_id
  ) THEN
    RAISE EXCEPTION
      'feature dependency % -> % would create a cycle',
      NEW.blocking_feature_id, NEW.blocked_feature_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER feature_dependencies_no_cycles
  BEFORE INSERT OR UPDATE ON public.feature_dependencies
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_feature_dependency_cycle();

COMMENT ON TABLE public.feature_dependencies IS
  'Finish->Start (and later SS/FF) edges between roadmap features, drawn as arrows in the Timeline. Task-level edges live in task_dependencies.';
