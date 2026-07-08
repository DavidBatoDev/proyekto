-- Phase 4 — reminder delivery. A marker so the reminder scan is idempotent
-- (a meeting's reminder is emitted at most once, even if the cron overlaps).
alter table public.meetings
  add column if not exists reminder_sent_at timestamptz;

-- Narrow partial index for the due-reminder scan: only upcoming, not-yet-sent
-- meetings that actually have a reminder configured.
create index if not exists idx_meetings_reminder_due
  on public.meetings (scheduled_at)
  where status = 'scheduled'
    and reminder_minutes is not null
    and reminder_sent_at is null;
