-- Scope the SELECT RLS on the assignee join tables (G7).
--
-- 20260704000000 created roadmap_task_assignees + roadmap_feature_assignees with
-- `for select to authenticated using (true)` — any authenticated user could read
-- every assignee row across every project. Replace those with policies that reuse
-- the canonical can_view_roadmap(uid, roadmap_id) SECURITY DEFINER helper
-- (20260504000030), matching how roadmap_tasks / task_comments SELECT is already
-- scoped (task → feature → roadmap; features carry a denormalized roadmap_id).
--
-- Defense-in-depth: the backend uses the service role (bypasses RLS), so this
-- only hardens direct client reads and any future PostgREST/MCP path. The
-- service_role "manages ..." policies are intentionally left unchanged.

-- ── roadmap_task_assignees ────────────────────────────────────────────────────
drop policy if exists "Authenticated users can view task assignees"
  on public.roadmap_task_assignees;

create policy "Members can view task assignees"
  on public.roadmap_task_assignees for select
  to authenticated
  using (
    exists (
      select 1
      from public.roadmap_tasks t
      join public.roadmap_features f on f.id = t.feature_id
      where t.id = roadmap_task_assignees.task_id
        and public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );

-- ── roadmap_feature_assignees ─────────────────────────────────────────────────
drop policy if exists "Authenticated users can view feature assignees"
  on public.roadmap_feature_assignees;

create policy "Members can view feature assignees"
  on public.roadmap_feature_assignees for select
  to authenticated
  using (
    exists (
      select 1
      from public.roadmap_features f
      where f.id = roadmap_feature_assignees.feature_id
        and public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );
