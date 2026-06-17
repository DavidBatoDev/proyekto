-- Fast "latest message per room" lookup for chat room hydration.
--
-- Before: hydrateRooms() pulled EVERY message for EVERY room
-- (`chat_room_messages` filtered only by room_id, no limit) and picked the
-- newest per room in application code -- an unbounded transfer + scan that
-- dominated `GET /projects/:id/chat/rooms` and `GET /chat/dm/rooms`.
--
-- After: this RPC returns exactly one row per room (the newest), using a
-- DISTINCT ON over the existing idx_chat_room_messages_room_created_desc
-- (room_id, created_at DESC) index -- O(rooms) instead of O(messages).
--
-- SECURITY INVOKER (default): the backend calls this with the service-role
-- client (RLS bypassed, same as the prior direct query); any other caller is
-- still constrained by chat_room_messages RLS. No new privilege surface.

CREATE OR REPLACE FUNCTION public.chat_latest_messages_by_room(p_room_ids uuid[])
RETURNS TABLE (
  id uuid,
  room_id uuid,
  project_id uuid,
  sender_id uuid,
  content text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.room_id)
    m.id, m.room_id, m.project_id, m.sender_id, m.content, m.created_at, m.updated_at
  FROM public.chat_room_messages m
  WHERE m.room_id = ANY (p_room_ids)
  ORDER BY m.room_id, m.created_at DESC
$$;
