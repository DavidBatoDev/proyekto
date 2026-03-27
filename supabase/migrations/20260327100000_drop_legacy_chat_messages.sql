-- Remove legacy chat table after the chat_rooms/chat_room_messages rollout.
-- This is a destructive migration and intentionally drops historical data
-- stored in public.chat_messages.

DROP TABLE IF EXISTS public.chat_messages CASCADE;

-- channel_type was only used by public.chat_messages in the legacy schema.
DROP TYPE IF EXISTS public.channel_type CASCADE;
