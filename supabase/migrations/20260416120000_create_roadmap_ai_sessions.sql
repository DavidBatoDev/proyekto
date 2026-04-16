-- Roadmap AI sessions (threads) and messages.
-- Replaces per-browser sessionStorage with durable, multi-thread persistence.
-- Redis (Upstash) remains the hot store for volatile working state (staged
-- operations, drafts, pending_edit_context, revision locks). DB is the source
-- of truth for thread index + conversation history.

CREATE TABLE IF NOT EXISTS public.roadmap_ai_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  mode text NOT NULL DEFAULT 'chat'
    CHECK (mode IN ('chat', 'edit_plan')),
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  is_pinned boolean NOT NULL DEFAULT false,
  pinned_at timestamptz,
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roadmap_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL
    REFERENCES public.roadmap_ai_sessions(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  intent_type text,
  response_mode text,
  parse_mode text,
  artifacts jsonb,
  activity_timeline jsonb,
  commit_lifecycle jsonb,
  tokens integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_ai_messages_session_seq_unique UNIQUE (session_id, seq)
);

-- Indexes tuned for the most common access patterns.
CREATE INDEX IF NOT EXISTS idx_roadmap_ai_sessions_active
  ON public.roadmap_ai_sessions (user_id, roadmap_id, last_message_at DESC NULLS LAST)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_sessions_archived
  ON public.roadmap_ai_sessions (user_id, roadmap_id, archived_at DESC NULLS LAST)
  WHERE is_archived = true;

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_sessions_roadmap
  ON public.roadmap_ai_sessions (roadmap_id);

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_messages_session_seq
  ON public.roadmap_ai_messages (session_id, seq);

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_messages_session_created
  ON public.roadmap_ai_messages (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: assign monotonic `seq` per session on message insert.
-- Using a subquery avoids tie-at-insert ordering bugs when two rows share
-- created_at (common under fast planner replies). The UNIQUE(session_id, seq)
-- constraint surfaces any race as a conflict rather than silent corruption.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.roadmap_ai_messages_assign_seq()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.seq IS NULL OR NEW.seq = 0 THEN
    SELECT COALESCE(MAX(seq), 0) + 1
      INTO NEW.seq
      FROM public.roadmap_ai_messages
      WHERE session_id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_ai_messages_assign_seq
  ON public.roadmap_ai_messages;
CREATE TRIGGER trg_roadmap_ai_messages_assign_seq
  BEFORE INSERT ON public.roadmap_ai_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.roadmap_ai_messages_assign_seq();

-- ---------------------------------------------------------------------------
-- Trigger: bump session last_message_at / message_count on message insert.
-- Intentionally does NOT touch updated_at — reserve that for metadata edits
-- so "updated" in the UI reflects rename/pin/archive, not every chat turn.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.roadmap_ai_messages_bump_session()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.roadmap_ai_sessions
     SET last_message_at = NEW.created_at,
         message_count = message_count + 1
   WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_ai_messages_bump_session
  ON public.roadmap_ai_messages;
CREATE TRIGGER trg_roadmap_ai_messages_bump_session
  AFTER INSERT ON public.roadmap_ai_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.roadmap_ai_messages_bump_session();

-- ---------------------------------------------------------------------------
-- Trigger: sync archived_at / pinned_at when their booleans flip.
-- Keeps the timestamp columns in sync without requiring the API layer to
-- remember to set them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.roadmap_ai_sessions_sync_flag_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_archived THEN
      NEW.archived_at := COALESCE(NEW.archived_at, now());
    END IF;
    IF NEW.is_pinned THEN
      NEW.pinned_at := COALESCE(NEW.pinned_at, now());
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_archived <> OLD.is_archived THEN
      NEW.archived_at := CASE WHEN NEW.is_archived THEN now() ELSE NULL END;
    END IF;
    IF NEW.is_pinned <> OLD.is_pinned THEN
      NEW.pinned_at := CASE WHEN NEW.is_pinned THEN now() ELSE NULL END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_ai_sessions_sync_flags
  ON public.roadmap_ai_sessions;
CREATE TRIGGER trg_roadmap_ai_sessions_sync_flags
  BEFORE INSERT OR UPDATE ON public.roadmap_ai_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.roadmap_ai_sessions_sync_flag_timestamps();

-- Use the shared updated_at trigger from 20260111000001.
DROP TRIGGER IF EXISTS trg_roadmap_ai_sessions_set_updated_at
  ON public.roadmap_ai_sessions;
CREATE TRIGGER trg_roadmap_ai_sessions_set_updated_at
  BEFORE UPDATE ON public.roadmap_ai_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS: threads are private per user. Predicate combines ownership with
-- roadmap access so a user can't see threads for roadmaps they've lost access
-- to (e.g. project membership revoked).
-- ---------------------------------------------------------------------------
ALTER TABLE public.roadmap_ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roadmap_ai_sessions_select ON public.roadmap_ai_sessions;
CREATE POLICY roadmap_ai_sessions_select ON public.roadmap_ai_sessions
  FOR SELECT USING (
    user_id = auth.uid()
    AND can_access_roadmap(roadmap_id, auth.uid())
  );

DROP POLICY IF EXISTS roadmap_ai_sessions_insert ON public.roadmap_ai_sessions;
CREATE POLICY roadmap_ai_sessions_insert ON public.roadmap_ai_sessions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND can_access_roadmap(roadmap_id, auth.uid())
  );

DROP POLICY IF EXISTS roadmap_ai_sessions_update ON public.roadmap_ai_sessions;
CREATE POLICY roadmap_ai_sessions_update ON public.roadmap_ai_sessions
  FOR UPDATE USING (
    user_id = auth.uid()
    AND can_access_roadmap(roadmap_id, auth.uid())
  ) WITH CHECK (
    user_id = auth.uid()
    AND can_access_roadmap(roadmap_id, auth.uid())
  );

DROP POLICY IF EXISTS roadmap_ai_sessions_delete ON public.roadmap_ai_sessions;
CREATE POLICY roadmap_ai_sessions_delete ON public.roadmap_ai_sessions
  FOR DELETE USING (
    user_id = auth.uid()
    AND can_access_roadmap(roadmap_id, auth.uid())
  );

DROP POLICY IF EXISTS roadmap_ai_messages_select ON public.roadmap_ai_messages;
CREATE POLICY roadmap_ai_messages_select ON public.roadmap_ai_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_ai_sessions s
      WHERE s.id = roadmap_ai_messages.session_id
        AND s.user_id = auth.uid()
        AND can_access_roadmap(s.roadmap_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS roadmap_ai_messages_insert ON public.roadmap_ai_messages;
CREATE POLICY roadmap_ai_messages_insert ON public.roadmap_ai_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.roadmap_ai_sessions s
      WHERE s.id = roadmap_ai_messages.session_id
        AND s.user_id = auth.uid()
        AND can_access_roadmap(s.roadmap_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS roadmap_ai_messages_delete ON public.roadmap_ai_messages;
CREATE POLICY roadmap_ai_messages_delete ON public.roadmap_ai_messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_ai_sessions s
      WHERE s.id = roadmap_ai_messages.session_id
        AND s.user_id = auth.uid()
        AND can_access_roadmap(s.roadmap_id, auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roadmap_ai_sessions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.roadmap_ai_messages TO authenticated;
