-- Phase 5 of the meetings redesign: per-user Google Calendar / Meet OAuth.
--
-- Each user connects their own Google account once; the backend stores the
-- long-lived OAuth *refresh token* so it can mint access tokens on demand and
-- create Google Calendar events (with a Meet conference link) on the user's
-- behalf. One connection per user.
--
-- The backend writes via the Supabase service-role client (bypasses RLS). The
-- refresh token is additionally ENCRYPTED at rest by the application layer
-- (AES-256-GCM, GOOGLE_TOKEN_ENC_KEY) — the column holds ciphertext, never a
-- usable token. RLS below is defensive parity, and deliberately grants NO
-- SELECT policy: the token must never be readable through PostgREST; connection
-- status is served only by the backend GET /api/meetings/google/status route.

CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The connected Google account's email (from the OAuth id_token) — shown in
  -- the UI as "Connected as …". Not a secret.
  google_email text,
  -- Encrypted (iv:tag:ciphertext, base64) OAuth refresh token — service-role only.
  refresh_token text NOT NULL,
  -- Granted scope string (audit + re-consent detection).
  scope text,
  token_type text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_calendar_connections_user_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_user_id
  ON public.google_calendar_connections(user_id);

DROP TRIGGER IF EXISTS trg_google_calendar_connections_updated_at
  ON public.google_calendar_connections;
CREATE TRIGGER trg_google_calendar_connections_updated_at
BEFORE UPDATE ON public.google_calendar_connections
FOR EACH ROW
EXECUTE FUNCTION public.handle_device_tokens_updated_at();

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

-- No SELECT policy: with RLS enabled and no permissive SELECT policy, the
-- anon/authenticated PostgREST roles cannot read any row (default deny), so the
-- encrypted refresh_token is never exposed client-side. The service role
-- bypasses RLS. INSERT/UPDATE/DELETE owner-scoped policies below are defensive
-- parity only (the backend always writes as the service role).

DROP POLICY IF EXISTS "Users can insert their own google connection"
ON public.google_calendar_connections;
CREATE POLICY "Users can insert their own google connection"
ON public.google_calendar_connections
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own google connection"
ON public.google_calendar_connections;
CREATE POLICY "Users can update their own google connection"
ON public.google_calendar_connections
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own google connection"
ON public.google_calendar_connections;
CREATE POLICY "Users can delete their own google connection"
ON public.google_calendar_connections
FOR DELETE
USING (auth.uid() = user_id);

-- ── expose the shared Google event id on the series template ──────────────────
-- meetings.google_event_id already exists (base meetings migration). A recurring
-- series maps to ONE native Google recurring event, so the master event id lives
-- on the series row and is copied onto each materialized instance.
ALTER TABLE public.meeting_series
  ADD COLUMN IF NOT EXISTS google_event_id text;

COMMENT ON COLUMN public.meetings.google_event_id IS
  'Google Calendar event id backing this meeting (or, for a series instance, the shared master event id). Null unless video_provider=google_meet.';
COMMENT ON COLUMN public.meeting_series.google_event_id IS
  'Google Calendar master (recurring) event id shared by every instance of this series.';
