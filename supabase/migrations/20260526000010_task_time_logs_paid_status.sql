-- Migration: 20260526000010_task_time_logs_paid_status.sql
--
-- Purpose:
--   Extend task_time_logs.status to allow "paid".

ALTER TABLE public.task_time_logs
  DROP CONSTRAINT IF EXISTS task_time_logs_status_check;

ALTER TABLE public.task_time_logs
  ADD CONSTRAINT task_time_logs_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'rejected'));
