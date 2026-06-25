-- Per-message chat actions: edit, soft-delete (tombstone), and reply/quote.
--
-- Adds three nullable columns to chat_room_messages:
--   * edited_at    — set when the sender edits the message; drives the
--                    "(edited)" label in the thread.
--   * deleted_at   — soft-delete marker. The row (and its original content)
--                    stays in the DB for the dispute/audit foundation, but the
--                    backend read projection strips content/attachments/
--                    mentions/reactions so clients only ever see a tombstone.
--   * reply_to_id  — the message this one replies to (quote). ON DELETE SET NULL
--                    so deleting/forgetting a target never orphans the reply.
--
-- RLS is unchanged: the existing "Users can update own chat messages" UPDATE
-- policy (sender_id = auth.uid()) already covers both edit and soft-delete, and
-- the backend writes with the service-role client. The content-or-attachment
-- CHECK keeps holding because we never blank a row's stored content.

ALTER TABLE public.chat_room_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_to_id uuid
    REFERENCES public.chat_room_messages(id) ON DELETE SET NULL;

-- Fast lookup of a reply target's replies is not needed, but the FK column
-- benefits from an index for the ON DELETE SET NULL fan-out on target removal.
CREATE INDEX IF NOT EXISTS idx_chat_room_messages_reply_to
  ON public.chat_room_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- ── Rebuild RPCs from their latest bodies so soft-deleted rows don't leak ─────
-- (search / library) and so the sidebar preview can render a deleted/edited
-- last message (latest-per-room).

-- Latest message per room: append edited_at, deleted_at, reply_to_id. The
-- RETURNS TABLE shape changes, so drop first (CREATE OR REPLACE can't change a
-- function's return type). Rebuilt from 20260621160000_add_chat_message_attachments.sql.
DROP FUNCTION IF EXISTS public.chat_latest_messages_by_room(uuid[]);

CREATE OR REPLACE FUNCTION public.chat_latest_messages_by_room(p_room_ids uuid[])
RETURNS TABLE (
  id uuid,
  room_id uuid,
  project_id uuid,
  sender_id uuid,
  content text,
  attachments jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  reply_to_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.room_id)
    m.id, m.room_id, m.project_id, m.sender_id, m.content, m.attachments,
    m.edited_at, m.deleted_at, m.reply_to_id,
    m.created_at, m.updated_at
  FROM public.chat_room_messages m
  WHERE m.room_id = ANY (p_room_ids)
  ORDER BY m.room_id, m.created_at DESC
$$;

-- Search: exclude soft-deleted messages (return shape unchanged → replace).
-- Rebuilt from 20260621170000_chat_search_and_library.sql.
CREATE OR REPLACE FUNCTION public.chat_search_room_messages(
  p_room_id uuid,
  p_query text,
  p_limit int DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  room_id uuid,
  project_id uuid,
  sender_id uuid,
  content text,
  attachments jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  score real
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    m.id, m.room_id, m.project_id, m.sender_id, m.content, m.attachments,
    m.created_at, m.updated_at,
    GREATEST(
      similarity(m.content, p_query),
      CASE WHEN m.content ILIKE '%' || p_query || '%' THEN 1 ELSE 0 END
    )::real AS score
  FROM public.chat_room_messages m
  WHERE m.room_id = p_room_id
    AND m.deleted_at IS NULL
    AND (m.content ILIKE '%' || p_query || '%' OR m.content % p_query)
  ORDER BY score DESC, m.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50)
$$;

-- Library (attachments): exclude soft-deleted messages.
CREATE OR REPLACE FUNCTION public.chat_room_attachments(p_room_id uuid)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  created_at timestamptz,
  url text,
  name text,
  content_type text,
  size bigint,
  width int,
  height int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.id, m.sender_id, m.created_at,
    a->>'url', a->>'name', a->>'content_type',
    NULLIF(a->>'size', '')::bigint,
    NULLIF(a->>'width', '')::int,
    NULLIF(a->>'height', '')::int
  FROM public.chat_room_messages m,
       LATERAL jsonb_array_elements(m.attachments) AS a
  WHERE m.room_id = p_room_id
    AND m.deleted_at IS NULL
    AND jsonb_array_length(m.attachments) > 0
  ORDER BY m.created_at DESC
$$;

-- Library (links): exclude soft-deleted messages.
CREATE OR REPLACE FUNCTION public.chat_room_links(p_room_id uuid)
RETURNS TABLE (
  message_id uuid,
  sender_id uuid,
  created_at timestamptz,
  url text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.id, m.sender_id, m.created_at, lnk[1]
  FROM public.chat_room_messages m,
       LATERAL regexp_matches(m.content, 'https?://[^\s]+', 'g') AS lnk
  WHERE m.room_id = p_room_id
    AND m.deleted_at IS NULL
    AND m.content ~ 'https?://'
  ORDER BY m.created_at DESC
$$;
