-- Server-authoritative pause/break state for the work timer.
--
-- Until now "pause" lived entirely in the browser's localStorage: the widget
-- recorded a pause start locally and fire-and-forgot a whole-minute
-- break_minutes update. The API never even selected break_minutes back, so
-- the main clock kept ticking through a break and the break itself was lost
-- on a device switch. These two columns move that state onto the row.
--
--   paused_at     - non-null while the member is on break. The elapsed work
--                   clock freezes here; the break clock runs from here.
--   break_seconds - accumulated break for the log, in seconds. This is the
--                   source of truth; break_minutes stays as the rounded
--                   minute mirror because invoice composition and the
--                   manual/edit log modals read and write it.

alter table task_time_logs
  add column if not exists paused_at timestamptz,
  add column if not exists break_seconds integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'task_time_logs_break_seconds_non_negative'
  ) then
    alter table task_time_logs
      add constraint task_time_logs_break_seconds_non_negative
      check (break_seconds >= 0);
  end if;
end $$;

-- Seed from the minute mirror so historical logs keep their break totals.
update task_time_logs
set break_seconds = coalesce(break_minutes, 0) * 60
where break_seconds = 0
  and coalesce(break_minutes, 0) > 0;

comment on column task_time_logs.paused_at is
  'Non-null while the timer is on break; the work clock is frozen at this instant.';
comment on column task_time_logs.break_seconds is
  'Accumulated break time in seconds. Source of truth; break_minutes mirrors it rounded.';

-- Only one running log per member already exists as a partial unique index,
-- so no new index is needed: pause is a property of that single active row.
