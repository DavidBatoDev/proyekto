-- Migration: 20260508000010_task_time_logs_team_id.sql
--
-- Purpose:
--   Attribute each task_time_log to the team whose rate snapshot it
--   carries. The team_id is the routing key for approvals: a log can
--   only be reviewed by an owner/admin of that team. Set on insert by
--   the project-time service from project_team_members + project_teams
--   (primary first, else any contributor team the member is curated
--   onto). Nullable for personal-workspace projects, which have no
--   primary_team_id and no approval flow.
--
-- Indexes:
--   (team_id, status, started_at desc) — drives the team approval
--     queue: "pending logs across all my team's projects, newest first."
--   (member_user_id, started_at desc) — drives the member's own logs
--     list.

ALTER TABLE public.task_time_logs
  ADD COLUMN IF NOT EXISTS team_id uuid
    REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS task_time_logs_team_status_started_idx
  ON public.task_time_logs (team_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS task_time_logs_member_started_idx
  ON public.task_time_logs (member_user_id, started_at DESC);
