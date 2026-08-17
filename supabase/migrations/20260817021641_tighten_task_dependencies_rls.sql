-- Tighten task_dependencies RLS.
--
-- 20260528000003 created the table with:
--     CREATE POLICY "Authenticated users can view task dependencies"
--       ON task_dependencies FOR SELECT TO authenticated USING (true);
--
-- That lets ANY authenticated user read EVERY task dependency in the database,
-- across every project. Scoping was only ever enforced in backend service code.
--
-- Safe to tighten: the only readers of this table are the backend repository
-- (task-extras.repository.supabase.ts) and the integration harness, both of
-- which connect as service_role and bypass RLS. Verified there is no
-- browser-side supabase-js read of this table.
--
-- Shape follows milestone_features / feature_dependencies: EXISTS on the parent,
-- scoped by can_view_roadmap, checking BOTH endpoints of the edge.

DROP POLICY IF EXISTS "Authenticated users can view task dependencies"
  ON public.task_dependencies;

CREATE POLICY "task_dependencies_select"
  ON public.task_dependencies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_tasks t
      JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE t.id = task_dependencies.blocking_task_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
    AND EXISTS (
      SELECT 1
      FROM public.roadmap_tasks t
      JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE t.id = task_dependencies.blocked_task_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );
