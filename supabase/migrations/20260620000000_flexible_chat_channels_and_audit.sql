-- Migration: 20260620000000_flexible_chat_channels_and_audit.sql
-- Date: June 20, 2026
-- Description:
--   Slack-style flexible chat channels + the 4 PRD persona rooms, plus a
--   project-wide audit trail.
--
--   1. chat_rooms gains: is_private, system_key (identifies the 4 auto-
--      provisioned persona rooms), is_archived/archived_at, created_by.
--   2. RLS for channel creation / self-join is loosened off the hardcoded
--      slug='general' (backend writes use the service-role client and bypass
--      RLS, so this is correctness / defense-in-depth). Channel visibility +
--      persona-scoped membership is enforced in the backend service
--      (ChatService) which resolves persona via resolveProjectRole.
--   3. New project_activity_log table for the dispute-resolution timeline.
--
--   Policy bodies are rebuilt from their latest defining migration
--   (20260513030057_global_dms.sql), NOT the stale 20260327090000 original.

-- ── 1. chat_rooms columns ──────────────────────────────────────────────────
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key text,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_system_key_allowed;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_system_key_allowed
  CHECK (
    system_key IS NULL
    OR system_key = ANY (ARRAY[
      'internal_team'::text,
      'client_room'::text,
      'consultant_client'::text,
      'consultant_pm'::text,
      'general'::text
    ])
  );

-- One row per (project, system_key). General for personal workspaces uses
-- system_key='general'; the four persona rooms use their own keys.
CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_system_key_uniq
  ON public.chat_rooms (project_id, system_key)
  WHERE system_key IS NOT NULL;

-- Listing channels for a project skips archived rooms.
CREATE INDEX IF NOT EXISTS idx_chat_rooms_project_active
  ON public.chat_rooms (project_id, type)
  WHERE is_archived = false;

-- ── 2. Loosen channel-creation + self-join RLS (off slug='general') ─────────
DROP POLICY IF EXISTS "Project members can create valid chat rooms" ON public.chat_rooms;
CREATE POLICY "Project members can create valid chat rooms"
ON public.chat_rooms
FOR INSERT
WITH CHECK (
  CASE
    WHEN type = 'channel'::public.chat_room_type THEN
      project_id IS NOT NULL
      AND public.project_chat_is_member(project_id, auth.uid())
    WHEN type = 'dm'::public.chat_room_type THEN
      project_id IS NULL
      AND public.project_chat_dm_slug_allows_actor(slug, auth.uid())
    ELSE false
  END
);

-- Members may self-join PUBLIC (non-private) channels of their projects.
-- Private channels, the persona rooms, and all lazy auto-join happen via the
-- service-role backend (RLS bypassed), so they are intentionally not covered
-- here.
DROP POLICY IF EXISTS "Project members can self-join chat rooms" ON public.chat_room_participants;
CREATE POLICY "Project members can self-join chat rooms"
ON public.chat_room_participants
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.chat_rooms cr
    WHERE cr.id = room_id
      AND (
        (
          cr.type = 'channel'::public.chat_room_type
          AND cr.is_private = false
          AND cr.project_id IS NOT NULL
          AND public.project_chat_is_member(cr.project_id, auth.uid())
        )
        OR (
          cr.type = 'dm'::public.chat_room_type
          AND public.project_chat_dm_slug_allows_actor(cr.slug, auth.uid())
        )
      )
  )
);

-- ── 3. Project-wide audit trail ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_activity_log_project_created_desc
  ON public.project_activity_log (project_id, created_at DESC);

ALTER TABLE public.project_activity_log ENABLE ROW LEVEL SECURITY;

-- Reads go through the backend (gated on logs.view); this SELECT policy is a
-- defense-in-depth allow for project members. No INSERT/UPDATE/DELETE policy:
-- only the service-role client (RLS-bypassing) writes the log.
DROP POLICY IF EXISTS "Project members can read activity log" ON public.project_activity_log;
CREATE POLICY "Project members can read activity log"
ON public.project_activity_log
FOR SELECT
USING (public.project_chat_is_member(project_id, auth.uid()));
