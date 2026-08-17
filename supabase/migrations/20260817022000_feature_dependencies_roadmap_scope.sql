-- Denormalise roadmap_id onto feature_dependencies, and harden the trigger.
--
-- Same call as roadmap_features.roadmap_id, for the same reasons:
--   * the Gantt reads every edge for a roadmap at once — one indexed scan
--     instead of an EXISTS subquery against roadmap_features per row;
--   * RLS collapses from a two-endpoint EXISTS pair to a single column check;
--   * cross-roadmap edges become enforceable at the database.
--
-- Safe as a plain NOT NULL add: the table was created empty in
-- 20260817021640 and nothing writes to it yet.

ALTER TABLE public.feature_dependencies
  ADD COLUMN roadmap_id UUID NOT NULL
    REFERENCES public.roadmaps(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_feature_deps_roadmap
  ON public.feature_dependencies(roadmap_id);

-- Bound the lag so a typo cannot shift a schedule by centuries.
ALTER TABLE public.feature_dependencies
  ADD CONSTRAINT feature_dependencies_lag_bounds
    CHECK (lag_days BETWEEN -365 AND 365);

-- Policies rewritten against roadmap_id.
--
-- auth.uid() is wrapped in a scalar subquery so Postgres hoists it out of the
-- per-row loop; a bare call trips Supabase's auth_rls_initplan advisor lint.
DROP POLICY IF EXISTS "feature_dependencies_select" ON public.feature_dependencies;
DROP POLICY IF EXISTS "feature_dependencies_insert" ON public.feature_dependencies;
DROP POLICY IF EXISTS "feature_dependencies_delete" ON public.feature_dependencies;

CREATE POLICY "feature_dependencies_select"
  ON public.feature_dependencies FOR SELECT
  TO authenticated
  USING (public.can_view_roadmap((SELECT auth.uid()), roadmap_id));

CREATE POLICY "feature_dependencies_insert"
  ON public.feature_dependencies FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_roadmap((SELECT auth.uid()), roadmap_id));

CREATE POLICY "feature_dependencies_update"
  ON public.feature_dependencies FOR UPDATE
  TO authenticated
  USING (public.can_edit_roadmap((SELECT auth.uid()), roadmap_id));

CREATE POLICY "feature_dependencies_delete"
  ON public.feature_dependencies FOR DELETE
  TO authenticated
  USING (public.can_edit_roadmap((SELECT auth.uid()), roadmap_id));

-- The trigger now guards two invariants, not one. The cross-roadmap check has
-- to live here rather than in the service: the backend connects as service_role
-- and bypasses RLS, and the AI patch path and MCP tools write through different
-- services that would each need their own copy of the rule.
CREATE OR REPLACE FUNCTION public.prevent_feature_dependency_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Both endpoints must live in the roadmap this row claims.
  IF NOT EXISTS (
    SELECT 1
    FROM public.roadmap_features p
    JOIN public.roadmap_features s ON s.roadmap_id = p.roadmap_id
    WHERE p.id = NEW.blocking_feature_id
      AND s.id = NEW.blocked_feature_id
      AND p.roadmap_id = NEW.roadmap_id
  ) THEN
    RAISE EXCEPTION 'feature_dependency_cross_roadmap'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Walk forward from the proposed successor; reaching the proposed
  -- predecessor means this edge closes a loop. UNION (not UNION ALL) is
  -- load-bearing: it terminates even if bad data already contains a cycle.
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
    RAISE EXCEPTION 'feature_dependency_cycle'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.feature_dependencies.roadmap_id IS
  'Denormalised from roadmap_features. Both endpoints must belong to it — enforced by prevent_feature_dependency_cycle().';
