-- Migration: Add break_minutes to task_time_logs
ALTER TABLE public.task_time_logs
ADD COLUMN IF NOT EXISTS break_minutes integer NOT NULL DEFAULT 0
CHECK (break_minutes >= 0);

COMMENT ON COLUMN public.task_time_logs.break_minutes IS 'Total break time in minutes logged for this session, deducted from net duration.';
