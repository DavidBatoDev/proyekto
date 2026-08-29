-- Buyers can save a service they like, and the page shows how many have.
--
-- Two pieces on purpose: the join table is the truth (one row per person per
-- service, so "did I like this" is a keyed lookup), and a denormalised
-- counter on the offering keeps the public page a single row read. The
-- counter is maintained by trigger, never by application code — a count
-- written from two places drifts the first time a request dies mid-flight.

create table if not exists public.service_offering_likes (
  offering_id uuid not null
    references public.service_offerings(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (offering_id, user_id)
);

-- "How many likes has this service" is the count query; the PK already
-- covers (offering_id, user_id) lookups.
create index if not exists service_offering_likes_user_idx
  on public.service_offering_likes(user_id);

alter table public.service_offerings
  add column if not exists like_count integer not null default 0;

alter table public.service_offerings
  drop constraint if exists service_offerings_like_count_non_negative;

alter table public.service_offerings
  add constraint service_offerings_like_count_non_negative
  check (like_count >= 0);

create or replace function public.sync_service_offering_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.service_offerings
    set like_count = like_count + 1
    where id = new.offering_id;
    return new;
  end if;

  update public.service_offerings
  set like_count = greatest(like_count - 1, 0)
  where id = old.offering_id;
  return old;
end;
$$;

drop trigger if exists service_offering_likes_count on public.service_offering_likes;

create trigger service_offering_likes_count
after insert or delete on public.service_offering_likes
for each row execute function public.sync_service_offering_like_count();

alter table public.service_offering_likes enable row level security;

-- A like is private to the person who left it: you can read and manage your
-- own rows, and nobody enumerates who liked what. The public number comes
-- from the counter column, which needs no access to this table.
drop policy if exists service_offering_likes_own_read on public.service_offering_likes;
create policy service_offering_likes_own_read
  on public.service_offering_likes for select
  using (auth.uid() = user_id);

drop policy if exists service_offering_likes_own_write on public.service_offering_likes;
create policy service_offering_likes_own_write
  on public.service_offering_likes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.service_offerings s
      where s.id = offering_id and s.status = 'published'
    )
  );

drop policy if exists service_offering_likes_own_delete on public.service_offering_likes;
create policy service_offering_likes_own_delete
  on public.service_offering_likes for delete
  using (auth.uid() = user_id);

-- Backfill is a no-op on a new table, but keeps the counter authoritative if
-- this migration is ever re-run against a database that already has rows.
update public.service_offerings s
set like_count = coalesce(counted.total, 0)
from (
  select offering_id, count(*)::int as total
  from public.service_offering_likes
  group by offering_id
) as counted
where counted.offering_id = s.id
  and s.like_count is distinct from counted.total;

comment on column public.service_offerings.like_count is
  'Denormalised count of service_offering_likes rows, maintained by the service_offering_likes_count trigger. Never write this directly.';
