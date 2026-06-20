-- Migration: 20260621000000_drop_chat_rooms_system_key.sql
-- Date: June 21, 2026
-- Description:
--   Drop chat_rooms.system_key. The auto-provisioned default channels are now
--   identified by their fixed slugs in the backend (ChatService default-room
--   specs), not a DB column. Channel visibility is pure membership, so
--   system_key no longer drives anything; it was only a provisioning/lifecycle
--   marker. Provisioning idempotency relies on (project_id, type, slug) instead.
--
--   Dropping the column also removes the dependent unique index and CHECK
--   constraint; we drop them explicitly first for clarity.

ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_system_key_allowed;

DROP INDEX IF EXISTS public.chat_rooms_system_key_uniq;

ALTER TABLE public.chat_rooms
  DROP COLUMN IF EXISTS system_key;
