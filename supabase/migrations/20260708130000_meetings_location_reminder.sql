-- Phase 2 of the Google-Calendar-style meetings redesign.
-- Adds optional `location` and `reminder_minutes` to meetings. Both columns are
-- nullable and additive, so this is fully backward-compatible with existing rows
-- and the current API (the reminder delivery scheduler ships in a later phase).

alter table public.meetings
  add column if not exists location text,
  add column if not exists reminder_minutes integer;

comment on column public.meetings.location is
  'Optional free-text location (address, room, or note).';
comment on column public.meetings.reminder_minutes is
  'Minutes before start to remind participants; null = no reminder. Delivery handled by a later scheduler phase.';
