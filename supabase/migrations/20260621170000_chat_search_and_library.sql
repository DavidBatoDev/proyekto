-- Conversation search (word + fuzzy) and the shared media/files/links library
-- for the Messenger-style chat info panel.
--
-- All three functions are SECURITY INVOKER (default), like
-- chat_latest_messages_by_room: the backend calls them with the service-role
-- client and gates access in the service layer (assertRoomAccess). Any other
-- caller stays constrained by chat_room_messages RLS.

-- Trigram index powers both the fuzzy `%` operator and ILIKE substring search.
CREATE INDEX IF NOT EXISTS idx_chat_room_messages_content_trgm
  ON public.chat_room_messages USING gin (content extensions.gin_trgm_ops);

-- Search a single room's messages. `%` is pg_trgm fuzzy/typo-tolerant matching;
-- ILIKE catches plain word/substring hits. score ranks fuzzy similarity but a
-- literal substring hit always scores 1.
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
    AND (m.content ILIKE '%' || p_query || '%' OR m.content % p_query)
  ORDER BY score DESC, m.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50)
$$;

-- One row per attachment across a room's messages (newest first). The panel
-- splits these into Media (image/*) vs Files in the service/web layer.
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
    AND jsonb_array_length(m.attachments) > 0
  ORDER BY m.created_at DESC
$$;

-- One row per URL found in a room's message text (newest first).
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
    AND m.content ~ 'https?://'
  ORDER BY m.created_at DESC
$$;
