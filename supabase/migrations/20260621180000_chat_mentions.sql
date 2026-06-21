-- Migration: 20260621180000_chat_mentions.sql
-- Date: June 21, 2026
-- Description:
--   Discord/Messenger-style @mentions in chat. Messages gain a `mentions` jsonb
--   array of { user_id, name, offset, length } spans (user_id is a member UUID or
--   the literal 'everyone' sentinel). Content stays human-readable ("@Name"), so
--   sidebar/inbox/search previews need no change; the array drives chip rendering
--   and the mention ping. A `chat_mention` notification type backs the bell ping
--   (mirrors the existing task_comment_mention type).

ALTER TABLE public.chat_room_messages
  ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO public.notification_types (name, category, priority)
VALUES ('chat_mention', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;
