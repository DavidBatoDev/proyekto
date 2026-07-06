-- Revive & extend the meetings table for real scheduling + add meeting_participants.
--
-- The original `meetings` table (20251211065452_initial_schema.sql) was schema-only:
-- no backend module ever used it, and its RLS policies (20251211065553_rls_policies.sql)
-- referenced `project_members`, which was dropped in 20260504000010. Those policies are
-- therefore dead. This migration:
--   1. extends `meetings` with host / status / video-provider / timezone / guest /
--      reschedule columns and relaxes project_id + created_by to allow guest and
--      profile-level (no-project) bookings.
--   2. creates `meeting_participants` (per-attendee RSVP + notification fan-out).
--   3. drops the 4 dead project_members RLS policies and rewrites them against
--      `project_access` + host_id/created_by + meeting_participants.
--   4. seeds the meeting_* notification types.
--
-- Authorization note: every backend repo runs as the service role (bypasses RLS), so
-- primary authz is enforced in the NestJS service layer against project_access. These
-- policies are defense-in-depth for any direct-from-web / realtime reads. Guests have
-- no auth.uid() and are served only through throttled service-role endpoints.

BEGIN;

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_status') THEN
    CREATE TYPE public.meeting_status AS ENUM
      ('scheduled', 'cancelled', 'completed', 'rescheduled', 'no_show');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_video_provider') THEN
    CREATE TYPE public.meeting_video_provider AS ENUM
      ('none', 'external_link', 'jitsi', 'google_meet');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_response') THEN
    CREATE TYPE public.meeting_response AS ENUM
      ('pending', 'accepted', 'declined', 'tentative');
  END IF;
END $$;

-- ── Extend meetings ─────────────────────────────────────────────────────────
-- Profile-level / guest bookings have no project; guest bookings have no
-- authenticated creator. Relax both NOT NULLs (host_id / guest_* carry the actor).
ALTER TABLE public.meetings ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.meetings ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS host_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS status public.meeting_status NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS video_provider public.meeting_video_provider NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS guest_email text,
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS guest_session_id text,
  ADD COLUMN IF NOT EXISTS reschedule_of uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_event_id text;

CREATE INDEX IF NOT EXISTS idx_meetings_project_id ON public.meetings(project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_host_id ON public.meetings(host_id);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_at ON public.meetings(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON public.meetings(status);

-- Double-booking backstop: at most one scheduled meeting per host per exact start
-- time. Overlap logic lives in the service layer; this catches exact-time races.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_host_slot
  ON public.meetings(host_id, scheduled_at)
  WHERE status = 'scheduled' AND host_id IS NOT NULL;

-- ── meeting_participants ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_email text,
  guest_name text,
  role text NOT NULL DEFAULT 'attendee',
  response public.meeting_response NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting
  ON public.meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user
  ON public.meeting_participants(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_participants_user
  ON public.meeting_participants(meeting_id, user_id)
  WHERE user_id IS NOT NULL;

-- ── updated_at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_meetings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON public.meetings;
CREATE TRIGGER trg_meetings_updated_at
BEFORE UPDATE ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.handle_meetings_updated_at();

DROP TRIGGER IF EXISTS trg_meeting_participants_updated_at ON public.meeting_participants;
CREATE TRIGGER trg_meeting_participants_updated_at
BEFORE UPDATE ON public.meeting_participants
FOR EACH ROW
EXECUTE FUNCTION public.handle_meetings_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Drop the dead policies that referenced the dropped project_members table.
DROP POLICY IF EXISTS "Project members can view meetings" ON public.meetings;
DROP POLICY IF EXISTS "Project members can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Meeting creator can update meetings" ON public.meetings;
DROP POLICY IF EXISTS "Creator and consultant can delete meetings" ON public.meetings;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

-- Visible if: you created it, you're the host, you're a member of its project, or
-- you're a listed participant.
DROP POLICY IF EXISTS meetings_select ON public.meetings;
CREATE POLICY meetings_select ON public.meetings
  FOR SELECT USING (
    auth.uid() = created_by
    OR auth.uid() = host_id
    OR (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = meetings.project_id AND pa.user_id = auth.uid()
    ))
    OR EXISTS (
      SELECT 1 FROM public.meeting_participants mp
      WHERE mp.meeting_id = meetings.id AND mp.user_id = auth.uid()
    )
  );

-- Create if: you're the creator AND (no project, or you belong to the project).
DROP POLICY IF EXISTS meetings_insert ON public.meetings;
CREATE POLICY meetings_insert ON public.meetings
  FOR INSERT WITH CHECK (
    auth.uid() = created_by
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.project_access pa
        WHERE pa.project_id = meetings.project_id AND pa.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS meetings_update ON public.meetings;
CREATE POLICY meetings_update ON public.meetings
  FOR UPDATE USING (auth.uid() = created_by OR auth.uid() = host_id);

DROP POLICY IF EXISTS meetings_delete ON public.meetings;
CREATE POLICY meetings_delete ON public.meetings
  FOR DELETE USING (
    auth.uid() = created_by
    OR auth.uid() = host_id
    OR (project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = meetings.project_id AND p.consultant_id = auth.uid()
    ))
  );

-- Participants: readable if you're the row or you can see the parent meeting;
-- you may update only your own RSVP.
DROP POLICY IF EXISTS meeting_participants_select ON public.meeting_participants;
CREATE POLICY meeting_participants_select ON public.meeting_participants
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_participants.meeting_id
        AND (
          auth.uid() = m.created_by
          OR auth.uid() = m.host_id
          OR (m.project_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.project_access pa
            WHERE pa.project_id = m.project_id AND pa.user_id = auth.uid()
          ))
        )
    )
  );

DROP POLICY IF EXISTS meeting_participants_update ON public.meeting_participants;
CREATE POLICY meeting_participants_update ON public.meeting_participants
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Notification types ──────────────────────────────────────────────────────
INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('meeting_invited', 'specific', 'high'),
  ('meeting_response', 'specific', 'medium'),
  ('meeting_cancelled', 'specific', 'high'),
  ('meeting_rescheduled', 'specific', 'high'),
  ('meeting_reminder', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;

COMMIT;
