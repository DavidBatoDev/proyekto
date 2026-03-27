CREATE TABLE IF NOT EXISTS public.chat_room_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_room_messages(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (char_length(btrim(emoji)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_chat_message_reactions UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message
  ON public.chat_room_message_reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_project_created_desc
  ON public.chat_room_message_reactions (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_user_created_desc
  ON public.chat_room_message_reactions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_chat_room_message_reactions_set_updated_at
  ON public.chat_room_message_reactions;
CREATE TRIGGER trg_chat_room_message_reactions_set_updated_at
BEFORE UPDATE ON public.chat_room_message_reactions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.chat_room_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat participants can read reactions"
  ON public.chat_room_message_reactions;
CREATE POLICY "Chat participants can read reactions"
ON public.chat_room_message_reactions
FOR SELECT
USING (
  public.project_chat_is_member(project_id, auth.uid())
  AND public.project_chat_is_room_participant(room_id, auth.uid())
);

DROP POLICY IF EXISTS "Chat participants can add reactions"
  ON public.chat_room_message_reactions;
CREATE POLICY "Chat participants can add reactions"
ON public.chat_room_message_reactions
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND public.project_chat_is_member(project_id, auth.uid())
  AND public.project_chat_is_room_participant(room_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.chat_room_messages crm
    WHERE crm.id = message_id
      AND crm.room_id = chat_room_message_reactions.room_id
      AND crm.project_id = chat_room_message_reactions.project_id
  )
);

DROP POLICY IF EXISTS "Users can remove own reactions"
  ON public.chat_room_message_reactions;
CREATE POLICY "Users can remove own reactions"
ON public.chat_room_message_reactions
FOR DELETE
USING (
  user_id = auth.uid()
  AND public.project_chat_is_member(project_id, auth.uid())
  AND public.project_chat_is_room_participant(room_id, auth.uid())
);
