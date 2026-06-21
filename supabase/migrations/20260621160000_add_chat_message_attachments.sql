-- Chat message attachments (images + files, Discord/Slack-style).
--
-- Messages gain an `attachments` jsonb array. Each element looks like:
--   { "url": "https://cdn.proyekto.tech/chat_attachments/<uid>/<ts>.png",
--     "name": "image.png", "content_type": "image/png", "size": 81234,
--     "width": 1170, "height": 240 }   -- width/height optional, images only
-- The bytes live in Cloudflare R2 (uploaded via the realtime Worker's
-- POST /uploads), so the row only stores metadata + the public CDN URL.
--
-- A message must now have non-empty content OR at least one attachment — the
-- old "content required" CHECK is replaced so attachment-only messages are
-- allowed. Existing rows are unaffected (attachments defaults to '[]').

ALTER TABLE public.chat_room_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Allow attachment-only messages: content may be empty as long as there's a file.
ALTER TABLE public.chat_room_messages
  ALTER COLUMN content SET DEFAULT '';

ALTER TABLE public.chat_room_messages
  DROP CONSTRAINT IF EXISTS chat_room_messages_content_check;

ALTER TABLE public.chat_room_messages
  DROP CONSTRAINT IF EXISTS chat_room_messages_content_or_attachment;

ALTER TABLE public.chat_room_messages
  ADD CONSTRAINT chat_room_messages_content_or_attachment
  CHECK (
    char_length(btrim(content)) > 0
    OR jsonb_array_length(attachments) > 0
  );

-- Rebuild the latest-message-per-room RPC to also return `attachments`, so the
-- sidebar/DM preview can show "📷 Photo" / "📎 <name>" for attachment-only
-- last messages. Rebuilt from 20260617140000_chat_latest_messages_rpc.sql
-- (newest definition) with the new column appended. The RETURNS TABLE shape
-- changes, so the old function must be dropped first (CREATE OR REPLACE can't
-- change a function's return type). Adding a column is backward-compatible:
-- the previously-deployed backend selects named fields and ignores the extra.
DROP FUNCTION IF EXISTS public.chat_latest_messages_by_room(uuid[]);

CREATE OR REPLACE FUNCTION public.chat_latest_messages_by_room(p_room_ids uuid[])
RETURNS TABLE (
  id uuid,
  room_id uuid,
  project_id uuid,
  sender_id uuid,
  content text,
  attachments jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.room_id)
    m.id, m.room_id, m.project_id, m.sender_id, m.content, m.attachments,
    m.created_at, m.updated_at
  FROM public.chat_room_messages m
  WHERE m.room_id = ANY (p_room_ids)
  ORDER BY m.room_id, m.created_at DESC
$$;
