-- Per-segment pause/resume history for the work timer.
--
-- task_time_logs collapses an entire timer session (however many times the
-- member paused and resumed) into one row: a single started_at/ended_at pair
-- plus one accumulated break_seconds total. That's enough to bill correctly,
-- but it means the member can't see WHEN each break happened, only the sum.
--
-- This table adds that detail as an append-only log of alternating work/break
-- intervals, written by the same start/pause/resume/stop calls that already
-- maintain task_time_logs. It is display-only — duration and billing keep
-- reading from task_time_logs.break_seconds/duration_seconds, which remain
-- the source of truth.
--
--   kind        - 'work' or 'break'.
--   started_at  - when this interval began.
--   ended_at    - when it ended; null while it's the currently running interval.

CREATE TABLE IF NOT EXISTS public.task_time_log_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES public.task_time_logs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('work', 'break')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_time_log_segments_end_after_start
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_task_time_log_segments_log_started
  ON public.task_time_log_segments (log_id, started_at ASC);

-- Mirrors the one-running-timer invariant on task_time_logs: a given log can
-- have at most one open (still-running) segment at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_time_log_segments_one_open_per_log
  ON public.task_time_log_segments (log_id)
  WHERE ended_at IS NULL;

ALTER TABLE public.task_time_log_segments ENABLE ROW LEVEL SECURITY;

-- Read-only from the client's perspective: segments are only ever written by
-- the backend's service-role connection (which bypasses RLS), mirroring
-- time_log_comments' viewer set but with no matching INSERT policy.
DROP POLICY IF EXISTS "Users can read allowed time log segments"
ON public.task_time_log_segments;
CREATE POLICY "Users can read allowed time log segments"
ON public.task_time_log_segments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.task_time_logs l
    LEFT JOIN public.teams t
      ON t.id = l.team_id
    LEFT JOIN public.team_members tm
      ON tm.team_id = l.team_id
     AND tm.user_id = auth.uid()
    WHERE l.id = task_time_log_segments.log_id
      AND (
        l.member_user_id = auth.uid()
        OR t.owner_id = auth.uid()
        OR tm.role IN ('owner', 'admin')
      )
  )
);

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual)
-- Run the block below manually if you need to revert this migration.
-- NOTE: this drops task_time_log_segments and all data in it.
-- ---------------------------------------------------------------------------
-- BEGIN;
-- DROP POLICY IF EXISTS "Users can read allowed time log segments" ON public.task_time_log_segments;
-- DROP INDEX IF EXISTS uq_task_time_log_segments_one_open_per_log;
-- DROP INDEX IF EXISTS idx_task_time_log_segments_log_started;
-- DROP TABLE IF EXISTS public.task_time_log_segments;
-- COMMIT;
