-- Kanban board column ordering for roadmap_tasks.
--
-- The existing `position` column is scoped UNIQUE(feature_id, position) - it
-- orders tasks within one feature (used by the per-feature task list /
-- SortableTaskList). The Kanban board groups tasks by status across every
-- feature in a roadmap, so that scope doesn't fit a board column's needs.
-- board_order adds a second ordering axis, scoped to (roadmap, status)
-- instead of (feature).
--
-- No DB-level uniqueness constraint: enforcing UNIQUE(roadmap_id, status,
-- board_order) cleanly would require denormalizing roadmap_id onto
-- roadmap_tasks (it currently only carries feature_id) plus a trigger to
-- keep it in sync with roadmap_features.roadmap_id. Contiguity is instead a
-- service-layer convention - every reorder write reindexes the whole
-- affected column - matching how `position` already behaves for
-- epics/features.
alter table public.roadmap_tasks
  add column if not exists board_order integer not null default 0;

-- Backfill existing rows so day-1 board order matches today's visual
-- (epic -> feature -> task) order rather than reshuffling on deploy.
-- roadmap_id isn't a column on roadmap_tasks, so it's resolved via the
-- feature -> roadmap join (mirrors findByRoadmap's join in
-- tasks.repository.supabase.ts).
with ranked as (
  select
    rt.id,
    row_number() over (
      partition by rf.roadmap_id, rt.status
      order by rt.position, rt.created_at
    ) - 1 as rn
  from public.roadmap_tasks rt
  join public.roadmap_features rf on rf.id = rt.feature_id
)
update public.roadmap_tasks as rt
set board_order = ranked.rn
from ranked
where rt.id = ranked.id;

create index if not exists idx_roadmap_tasks_board_order
  on public.roadmap_tasks (status, board_order);

comment on column public.roadmap_tasks.board_order is
  'Manual drag order within a Kanban status column, scoped to (roadmap, status) via the owning feature. Contiguity is enforced by the reorder-by-status service call, not a DB constraint.';
