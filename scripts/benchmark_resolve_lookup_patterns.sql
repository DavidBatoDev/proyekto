-- Benchmark resolve/context lookup patterns used by roadmap AI.
--
-- Usage options:
-- 1) Supabase SQL editor: paste and edit the constants in params.
-- 2) psql: run this file directly, then compare EXPLAIN ANALYZE outputs.
--
-- What this script covers:
-- - Epic/feature title exact, prefix, contains, description contains.
-- - Task title exact, prefix, contains via roadmap_features join.
-- - Repeated execution timing (cold-ish first run + warm loop averages).

begin;

-- Keep benchmark predictable inside one transaction.
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local jit = off;
set local track_io_timing = on;

-- Edit these for your target roadmap/query.
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Platform Foundation'::text as q,
    20::int as warm_repeats
)
select * from params;

-- Optional: check supporting indexes currently present.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('roadmap_epics', 'roadmap_features', 'roadmap_tasks')
order by tablename, indexname;

-- Pattern 1: epic title exact
explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Platform Foundation'::text as q
)
select id, roadmap_id, title, description
from public.roadmap_epics e, params p
where e.roadmap_id = p.roadmap_id
  and e.title ilike p.q
order by e.title asc
limit 200;

-- Pattern 2: epic title prefix
explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Platform Foundation'::text as q
)
select id, roadmap_id, title, description
from public.roadmap_epics e, params p
where e.roadmap_id = p.roadmap_id
  and e.title ilike (p.q || '%')
order by e.title asc
limit 200;

-- Pattern 3: epic title contains
explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Platform Foundation'::text as q
)
select id, roadmap_id, title, description
from public.roadmap_epics e, params p
where e.roadmap_id = p.roadmap_id
  and e.title ilike ('%' || p.q || '%')
order by e.title asc
limit 200;

-- Pattern 4: epic description contains
explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Platform Foundation'::text as q
)
select id, roadmap_id, title, description
from public.roadmap_epics e, params p
where e.roadmap_id = p.roadmap_id
  and e.description ilike ('%' || p.q || '%')
order by e.title asc
limit 200;

-- Pattern 5-8: feature title/description equivalents
explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Authentication System'::text as q
)
select id, roadmap_id, epic_id, title, description
from public.roadmap_features f, params p
where f.roadmap_id = p.roadmap_id
  and f.title ilike p.q
order by f.title asc
limit 200;

explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Authentication System'::text as q
)
select id, roadmap_id, epic_id, title, description
from public.roadmap_features f, params p
where f.roadmap_id = p.roadmap_id
  and f.title ilike (p.q || '%')
order by f.title asc
limit 200;

explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Authentication System'::text as q
)
select id, roadmap_id, epic_id, title, description
from public.roadmap_features f, params p
where f.roadmap_id = p.roadmap_id
  and f.title ilike ('%' || p.q || '%')
order by f.title asc
limit 200;

explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Authentication System'::text as q
)
select id, roadmap_id, epic_id, title, description
from public.roadmap_features f, params p
where f.roadmap_id = p.roadmap_id
  and f.description ilike ('%' || p.q || '%')
order by f.title asc
limit 200;

-- Pattern 9-11: task title via feature roadmap join (current runtime path)
explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Implement login API'::text as q
)
select t.id, t.title, t.feature_id, rf.title as feature_title
from public.roadmap_tasks t
join public.roadmap_features rf on rf.id = t.feature_id
join params p on true
where rf.roadmap_id = p.roadmap_id
  and t.title ilike p.q
order by t.title asc
limit 200;

explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Implement login API'::text as q
)
select t.id, t.title, t.feature_id, rf.title as feature_title
from public.roadmap_tasks t
join public.roadmap_features rf on rf.id = t.feature_id
join params p on true
where rf.roadmap_id = p.roadmap_id
  and t.title ilike (p.q || '%')
order by t.title asc
limit 200;

explain (analyze, buffers, verbose)
with params as (
  select
    '55e431e2-e416-468c-a973-94d97280e97d'::uuid as roadmap_id,
    'Implement login API'::text as q
)
select t.id, t.title, t.feature_id, rf.title as feature_title
from public.roadmap_tasks t
join public.roadmap_features rf on rf.id = t.feature_id
join params p on true
where rf.roadmap_id = p.roadmap_id
  and t.title ilike ('%' || p.q || '%')
order by t.title asc
limit 200;

-- Warm loop timing: averages over repeated runs for quick comparison.
create temporary table if not exists benchmark_lookup_timings (
  pattern text not null,
  elapsed_ms numeric not null
) on commit drop;

truncate table benchmark_lookup_timings;

do $$
declare
  v_roadmap_id uuid := '55e431e2-e416-468c-a973-94d97280e97d'::uuid;
  v_q_epic text := 'Platform Foundation';
  v_q_feature text := 'Authentication System';
  v_q_task text := 'Implement login API';
  v_repeats int := 20;
  i int;
  started_at timestamptz;
begin
  for i in 1..v_repeats loop
    started_at := clock_timestamp();
    perform e.id
    from public.roadmap_epics e
    where e.roadmap_id = v_roadmap_id
      and e.title ilike ('%' || v_q_epic || '%')
    order by e.title asc
    limit 200;
    insert into benchmark_lookup_timings(pattern, elapsed_ms)
    values ('epic_title_contains', extract(epoch from (clock_timestamp() - started_at)) * 1000.0);

    started_at := clock_timestamp();
    perform e.id
    from public.roadmap_epics e
    where e.roadmap_id = v_roadmap_id
      and e.description ilike ('%' || v_q_epic || '%')
    order by e.title asc
    limit 200;
    insert into benchmark_lookup_timings(pattern, elapsed_ms)
    values ('epic_description_contains', extract(epoch from (clock_timestamp() - started_at)) * 1000.0);

    started_at := clock_timestamp();
    perform f.id
    from public.roadmap_features f
    where f.roadmap_id = v_roadmap_id
      and f.title ilike ('%' || v_q_feature || '%')
    order by f.title asc
    limit 200;
    insert into benchmark_lookup_timings(pattern, elapsed_ms)
    values ('feature_title_contains', extract(epoch from (clock_timestamp() - started_at)) * 1000.0);

    started_at := clock_timestamp();
    perform f.id
    from public.roadmap_features f
    where f.roadmap_id = v_roadmap_id
      and f.description ilike ('%' || v_q_feature || '%')
    order by f.title asc
    limit 200;
    insert into benchmark_lookup_timings(pattern, elapsed_ms)
    values ('feature_description_contains', extract(epoch from (clock_timestamp() - started_at)) * 1000.0);

    started_at := clock_timestamp();
    perform t.id
    from public.roadmap_tasks t
    join public.roadmap_features rf on rf.id = t.feature_id
    where rf.roadmap_id = v_roadmap_id
      and t.title ilike ('%' || v_q_task || '%')
    order by t.title asc
    limit 200;
    insert into benchmark_lookup_timings(pattern, elapsed_ms)
    values ('task_title_contains_join', extract(epoch from (clock_timestamp() - started_at)) * 1000.0);
  end loop;
end $$;

select
  pattern,
  count(*) as calls,
  round(avg(elapsed_ms)::numeric, 3) as avg_ms,
  round(percentile_cont(0.50) within group (order by elapsed_ms)::numeric, 3) as p50_ms,
  round(percentile_cont(0.95) within group (order by elapsed_ms)::numeric, 3) as p95_ms,
  round(max(elapsed_ms)::numeric, 3) as max_ms
from benchmark_lookup_timings
group by pattern
order by pattern;

rollback;
