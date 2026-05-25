-- Add task work type + split training rates + log snapshot of work type.
--
-- 1) roadmap_tasks.work_type: identifies if a task is real client work
--    or internal training.
-- 2) team_member_rates.training_hourly_rate: explicit training rate per
--    (team, user, project) row.
-- 3) task_time_logs.work_type_snapshot: immutable work type stored on log
--    creation/update for historical billing correctness.

-- ---------------------------------------------------------------------------
-- 1) roadmap_tasks.work_type
-- ---------------------------------------------------------------------------
ALTER TABLE public.roadmap_tasks
  ADD COLUMN IF NOT EXISTS work_type text;

UPDATE public.roadmap_tasks
SET work_type = 'real_work'
WHERE work_type IS NULL;

ALTER TABLE public.roadmap_tasks
  ALTER COLUMN work_type SET DEFAULT 'real_work';

ALTER TABLE public.roadmap_tasks
  DROP CONSTRAINT IF EXISTS roadmap_tasks_work_type_check;

ALTER TABLE public.roadmap_tasks
  ADD CONSTRAINT roadmap_tasks_work_type_check
  CHECK (work_type IN ('real_work', 'training'));

ALTER TABLE public.roadmap_tasks
  ALTER COLUMN work_type SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) team_member_rates.training_hourly_rate
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_member_rates
  ADD COLUMN IF NOT EXISTS training_hourly_rate numeric(12,2);

UPDATE public.team_member_rates
SET training_hourly_rate = hourly_rate
WHERE training_hourly_rate IS NULL;

ALTER TABLE public.team_member_rates
  ALTER COLUMN training_hourly_rate SET DEFAULT 0;

ALTER TABLE public.team_member_rates
  DROP CONSTRAINT IF EXISTS team_member_rates_training_hourly_rate_non_negative;

ALTER TABLE public.team_member_rates
  ADD CONSTRAINT team_member_rates_training_hourly_rate_non_negative
  CHECK (training_hourly_rate >= 0);

ALTER TABLE public.team_member_rates
  ALTER COLUMN training_hourly_rate SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) task_time_logs.work_type_snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_time_logs
  ADD COLUMN IF NOT EXISTS work_type_snapshot text;

UPDATE public.task_time_logs AS l
SET work_type_snapshot = COALESCE(t.work_type, 'real_work')
FROM public.roadmap_tasks AS t
WHERE l.task_id = t.id
  AND l.work_type_snapshot IS NULL;

UPDATE public.task_time_logs
SET work_type_snapshot = 'real_work'
WHERE work_type_snapshot IS NULL;

ALTER TABLE public.task_time_logs
  ALTER COLUMN work_type_snapshot SET DEFAULT 'real_work';

ALTER TABLE public.task_time_logs
  DROP CONSTRAINT IF EXISTS task_time_logs_work_type_snapshot_check;

ALTER TABLE public.task_time_logs
  ADD CONSTRAINT task_time_logs_work_type_snapshot_check
  CHECK (work_type_snapshot IN ('real_work', 'training'));

ALTER TABLE public.task_time_logs
  ALTER COLUMN work_type_snapshot SET NOT NULL;
