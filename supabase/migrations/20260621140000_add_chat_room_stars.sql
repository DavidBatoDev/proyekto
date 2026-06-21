-- Personal "starred" (favorite) channels/rooms. Per-user bookmark on a whole
-- room (channel or DM) so it pins to the top of the sidebar. Mirrors
-- chat_room_message_stars but keyed on the room instead of a message.
CREATE TABLE IF NOT EXISTS public.chat_room_stars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_chat_room_stars UNIQUE (room_id, user_id)
);

-- A single user's starred rooms (enrich the room list / sidebar).
CREATE INDEX IF NOT EXISTS idx_chat_room_stars_user
  ON public.chat_room_stars (user_id);

ALTER TABLE public.chat_room_stars ENABLE ROW LEVEL SECURITY;

-- Personal data: a user only ever reads/removes their own room stars.
DROP POLICY IF EXISTS "Users can read own room stars"
  ON public.chat_room_stars;
CREATE POLICY "Users can read own room stars"
ON public.chat_room_stars
FOR SELECT
USING (user_id = auth.uid());

-- Can only star a room you participate in.
DROP POLICY IF EXISTS "Users can add own room stars"
  ON public.chat_room_stars;
CREATE POLICY "Users can add own room stars"
ON public.chat_room_stars
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND public.project_chat_is_room_participant(room_id, auth.uid())
);

DROP POLICY IF EXISTS "Users can remove own room stars"
  ON public.chat_room_stars;
CREATE POLICY "Users can remove own room stars"
ON public.chat_room_stars
FOR DELETE
USING (user_id = auth.uid());
