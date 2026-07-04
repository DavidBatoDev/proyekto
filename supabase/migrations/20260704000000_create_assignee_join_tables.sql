-- Multiple assignees support for tasks and features.
--
-- Tasks and features move from a single assignee to a many-to-many model via
-- join tables. The legacy roadmap_tasks.assignee_id column is kept in place as
-- the "primary" assignee for backward-compatibility (it mirrors the first row
-- in roadmap_task_assignees) so existing reads keep working during rollout.

-- ── Task assignees ────────────────────────────────────────────────────────────
create table if not exists public.roadmap_task_assignees (
  task_id uuid not null references public.roadmap_tasks(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key (task_id, assignee_id)
);

create index if not exists idx_roadmap_task_assignees_task_id
  on public.roadmap_task_assignees (task_id);
create index if not exists idx_roadmap_task_assignees_assignee_id
  on public.roadmap_task_assignees (assignee_id);

-- ── Feature assignees (the explicit "feature team") ───────────────────────────
create table if not exists public.roadmap_feature_assignees (
  feature_id uuid not null references public.roadmap_features(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key (feature_id, assignee_id)
);

create index if not exists idx_roadmap_feature_assignees_feature_id
  on public.roadmap_feature_assignees (feature_id);
create index if not exists idx_roadmap_feature_assignees_assignee_id
  on public.roadmap_feature_assignees (assignee_id);

-- ── Backfill task assignees from the existing single-assignee column ───────────
insert into public.roadmap_task_assignees (task_id, assignee_id)
select id, assignee_id
from public.roadmap_tasks
where assignee_id is not null
on conflict (task_id, assignee_id) do nothing;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Writes go through the backend (service role, which bypasses RLS). Clients that
-- read the tables directly get read-only visibility, mirroring task_activity_log.
alter table public.roadmap_task_assignees enable row level security;
alter table public.roadmap_feature_assignees enable row level security;

create policy "Authenticated users can view task assignees"
  on public.roadmap_task_assignees for select
  to authenticated
  using (true);

create policy "Service role manages task assignees"
  on public.roadmap_task_assignees for all
  to service_role
  using (true)
  with check (true);

create policy "Authenticated users can view feature assignees"
  on public.roadmap_feature_assignees for select
  to authenticated
  using (true);

create policy "Service role manages feature assignees"
  on public.roadmap_feature_assignees for all
  to service_role
  using (true)
  with check (true);
