DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'chat_room_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.chat_room_type AS ENUM ('channel', 'dm');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type public.chat_room_type NOT NULL,
  slug text NOT NULL CHECK (char_length(btrim(slug)) > 0),
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_chat_rooms_project_type_slug UNIQUE (project_id, type, slug)
);

CREATE TABLE IF NOT EXISTS public.chat_room_participants (
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  CONSTRAINT chat_room_participants_pkey PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_project_type
  ON public.chat_rooms (project_id, type);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_project_slug
  ON public.chat_rooms (project_id, slug);

CREATE INDEX IF NOT EXISTS idx_chat_room_participants_user_project
  ON public.chat_room_participants (user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_chat_room_participants_room
  ON public.chat_room_participants (room_id);

CREATE INDEX IF NOT EXISTS idx_chat_room_messages_room_created_desc
  ON public.chat_room_messages (room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_room_messages_project_created_desc
  ON public.chat_room_messages (project_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.project_chat_is_member(
  target_project_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = target_project_id
      AND (p.client_id = target_user_id OR p.consultant_id = target_user_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = target_project_id
      AND pm.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.project_chat_dm_slug(user_a uuid, user_b uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(user_a::text, user_b::text) || '_' || GREATEST(user_a::text, user_b::text);
$$;

CREATE OR REPLACE FUNCTION public.project_chat_role(
  target_project_id uuid,
  target_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  project_row record;
  member_role text;
BEGIN
  SELECT p.client_id, p.consultant_id
  INTO project_row
  FROM public.projects p
  WHERE p.id = target_project_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF target_user_id = project_row.consultant_id THEN
    RETURN 'consultant';
  END IF;

  IF target_user_id = project_row.client_id THEN
    RETURN 'client';
  END IF;

  SELECT pm.role
  INTO member_role
  FROM public.project_members pm
  WHERE pm.project_id = target_project_id
    AND pm.user_id = target_user_id
  LIMIT 1;

  IF member_role IS NULL THEN
    RETURN NULL;
  END IF;

  IF lower(member_role) = 'consultant' THEN
    RETURN 'consultant';
  END IF;

  IF lower(member_role) = 'client' THEN
    RETURN 'client';
  END IF;

  RETURN 'freelancer';
END;
$$;

CREATE OR REPLACE FUNCTION public.project_chat_can_dm(
  target_project_id uuid,
  actor_user_id uuid,
  recipient_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  actor_role text;
  recipient_role text;
BEGIN
  IF actor_user_id IS NULL OR recipient_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF actor_user_id = recipient_user_id THEN
    RETURN false;
  END IF;

  IF NOT public.project_chat_is_member(target_project_id, actor_user_id) THEN
    RETURN false;
  END IF;

  IF NOT public.project_chat_is_member(target_project_id, recipient_user_id) THEN
    RETURN false;
  END IF;

  actor_role := public.project_chat_role(target_project_id, actor_user_id);
  recipient_role := public.project_chat_role(target_project_id, recipient_user_id);

  IF actor_role IS NULL OR recipient_role IS NULL THEN
    RETURN false;
  END IF;

  IF actor_role = 'consultant' THEN
    RETURN true;
  END IF;

  IF actor_role = 'client' THEN
    RETURN recipient_role = 'consultant';
  END IF;

  RETURN recipient_role IN ('consultant', 'freelancer');
END;
$$;

CREATE OR REPLACE FUNCTION public.project_chat_is_room_participant(
  target_room_id uuid,
  target_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_room_participants crp
    WHERE crp.room_id = target_room_id
      AND crp.user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.project_chat_dm_slug_allows_actor(
  target_project_id uuid,
  dm_slug text,
  actor_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  slug_parts text[];
  left_user uuid;
  right_user uuid;
  recipient_user uuid;
BEGIN
  slug_parts := string_to_array(dm_slug, '_');
  IF array_length(slug_parts, 1) <> 2 THEN
    RETURN false;
  END IF;

  BEGIN
    left_user := slug_parts[1]::uuid;
    right_user := slug_parts[2]::uuid;
  EXCEPTION
    WHEN others THEN
      RETURN false;
  END;

  IF left_user = right_user THEN
    RETURN false;
  END IF;

  IF actor_user_id <> left_user AND actor_user_id <> right_user THEN
    RETURN false;
  END IF;

  recipient_user := CASE
    WHEN actor_user_id = left_user THEN right_user
    ELSE left_user
  END;

  RETURN public.project_chat_can_dm(target_project_id, actor_user_id, recipient_user);
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_rooms_set_updated_at ON public.chat_rooms;
CREATE TRIGGER trg_chat_rooms_set_updated_at
BEFORE UPDATE ON public.chat_rooms
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_chat_room_messages_set_updated_at ON public.chat_room_messages;
CREATE TRIGGER trg_chat_room_messages_set_updated_at
BEFORE UPDATE ON public.chat_room_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat participants can read rooms" ON public.chat_rooms;
CREATE POLICY "Chat participants can read rooms"
ON public.chat_rooms
FOR SELECT
USING (public.project_chat_is_room_participant(id, auth.uid()));

DROP POLICY IF EXISTS "Project members can create valid chat rooms" ON public.chat_rooms;
CREATE POLICY "Project members can create valid chat rooms"
ON public.chat_rooms
FOR INSERT
WITH CHECK (
  public.project_chat_is_member(project_id, auth.uid())
  AND (
    (type = 'channel'::public.chat_room_type AND slug = 'general')
    OR (
      type = 'dm'::public.chat_room_type
      AND public.project_chat_dm_slug_allows_actor(project_id, slug, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Chat participants can read participants" ON public.chat_room_participants;
CREATE POLICY "Chat participants can read participants"
ON public.chat_room_participants
FOR SELECT
USING (public.project_chat_is_room_participant(room_id, auth.uid()));

DROP POLICY IF EXISTS "Project members can self-join channels" ON public.chat_room_participants;
CREATE POLICY "Project members can self-join channels"
ON public.chat_room_participants
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND public.project_chat_is_member(project_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.chat_rooms cr
    WHERE cr.id = room_id
      AND cr.project_id = chat_room_participants.project_id
      AND (
        (cr.type = 'channel'::public.chat_room_type AND cr.slug = 'general')
        OR (
          cr.type = 'dm'::public.chat_room_type
          AND public.project_chat_dm_slug_allows_actor(project_id, cr.slug, auth.uid())
        )
      )
  )
);

DROP POLICY IF EXISTS "Users can update own participant row" ON public.chat_room_participants;
CREATE POLICY "Users can update own participant row"
ON public.chat_room_participants
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Chat participants can read messages" ON public.chat_room_messages;
CREATE POLICY "Chat participants can read messages"
ON public.chat_room_messages
FOR SELECT
USING (
  public.project_chat_is_room_participant(room_id, auth.uid())
  AND public.project_chat_is_member(project_id, auth.uid())
);

DROP POLICY IF EXISTS "Chat participants can send messages" ON public.chat_room_messages;
CREATE POLICY "Chat participants can send messages"
ON public.chat_room_messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND public.project_chat_is_room_participant(room_id, auth.uid())
  AND public.project_chat_is_member(project_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.chat_rooms cr
    WHERE cr.id = room_id
      AND cr.project_id = chat_room_messages.project_id
  )
);

DROP POLICY IF EXISTS "Users can update own chat messages" ON public.chat_room_messages;
CREATE POLICY "Users can update own chat messages"
ON public.chat_room_messages
FOR UPDATE
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own chat messages" ON public.chat_room_messages;
CREATE POLICY "Users can delete own chat messages"
ON public.chat_room_messages
FOR DELETE
USING (sender_id = auth.uid());
