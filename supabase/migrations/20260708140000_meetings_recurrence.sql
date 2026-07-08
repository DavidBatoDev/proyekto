-- Phase 3 of the meetings redesign: recurring meetings (RRULE series).
--
-- Model: a `meeting_series` template row + child `meetings` instance rows
-- materialized within a rolling horizon (CalDAV-style). Instance rows carry the
-- series linkage; a cancelled instance doubles as an EXDATE and an is_exception
-- instance is a detached override. This reuses all existing per-row machinery
-- (list, participants, RSVP, notifications, overlap guard) unchanged.

-- ── meeting_series template ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meeting_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  host_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  type public.meeting_type NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  timezone text NOT NULL,
  video_provider public.meeting_video_provider NOT NULL DEFAULT 'none',
  meeting_url text,
  location text,
  reminder_minutes integer,
  -- RFC-5545 rule body (e.g. 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU') without DTSTART.
  rrule text NOT NULL,
  -- Naive wall-clock start ('YYYY-MM-DDTHH:MM:SS'), evaluated in `timezone`.
  dtstart_wall text NOT NULL,
  -- UTC instant of the first occurrence.
  dtstart timestamptz NOT NULL,
  until timestamptz,
  "count" integer,
  status text NOT NULL DEFAULT 'active', -- active | cancelled
  -- Horizon watermark: occurrences up to here are materialized.
  materialized_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_series_project ON public.meeting_series(project_id);
CREATE INDEX IF NOT EXISTS idx_meeting_series_host ON public.meeting_series(host_id);

-- ── instance linkage on meetings ────────────────────────────────────────────
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.meeting_series(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recurrence_id timestamptz,
  ADD COLUMN IF NOT EXISTS original_start timestamptz,
  ADD COLUMN IF NOT EXISTS is_exception boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_meetings_series_id ON public.meetings(series_id);
-- One materialized instance per nominal slot; makes the horizon job idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_series_slot
  ON public.meetings(series_id, recurrence_id)
  WHERE series_id IS NOT NULL;

COMMENT ON COLUMN public.meetings.series_id IS 'Owning recurring series, or null for a standalone meeting.';
COMMENT ON COLUMN public.meetings.recurrence_id IS 'Nominal (pre-override) UTC slot start — the stable identity within a series.';
COMMENT ON COLUMN public.meetings.original_start IS 'Original nominal start when a single occurrence was moved.';
COMMENT ON COLUMN public.meetings.is_exception IS 'True when this instance diverges from the series template (detached override).';

-- ── updated_at trigger (reuses the meetings function) ───────────────────────
DROP TRIGGER IF EXISTS trg_meeting_series_updated_at ON public.meeting_series;
CREATE TRIGGER trg_meeting_series_updated_at
BEFORE UPDATE ON public.meeting_series
FOR EACH ROW
EXECUTE FUNCTION public.handle_meetings_updated_at();

-- ── RLS (mirrors meetings; the backend uses the service role and bypasses it) ─
ALTER TABLE public.meeting_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_series_select ON public.meeting_series;
CREATE POLICY meeting_series_select ON public.meeting_series
  FOR SELECT USING (
    auth.uid() = created_by
    OR auth.uid() = host_id
    OR (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = meeting_series.project_id AND pa.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS meeting_series_insert ON public.meeting_series;
CREATE POLICY meeting_series_insert ON public.meeting_series
  FOR INSERT WITH CHECK (
    auth.uid() = created_by
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.project_access pa
        WHERE pa.project_id = meeting_series.project_id AND pa.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS meeting_series_update ON public.meeting_series;
CREATE POLICY meeting_series_update ON public.meeting_series
  FOR UPDATE USING (auth.uid() = created_by OR auth.uid() = host_id);

DROP POLICY IF EXISTS meeting_series_delete ON public.meeting_series;
CREATE POLICY meeting_series_delete ON public.meeting_series
  FOR DELETE USING (
    auth.uid() = created_by
    OR auth.uid() = host_id
    OR (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meeting_series.project_id AND p.consultant_id = auth.uid()
    ))
  );
