-- Migration: 20260513030057_global_dms.sql
-- Date: May 13, 2026
-- Description:
--   Makes direct-message chat rooms global (one per user-pair) instead of
--   per-project. Channels (e.g. #general) stay scoped to their project.
--
--   Key shape change:
--     - chat_rooms.project_id becomes NULLABLE; CHECK enforces that channels
--       MUST have a project_id and DMs MUST NOT.
--     - chat_room_messages / chat_room_participants / chat_room_message_reactions
--       keep their project_id column for now but it becomes NULLABLE — for DM
--       rows it is always NULL. Queries that previously filtered by project_id
--       on these child tables must filter via the parent room when applicable.
--     - The unique key on chat_rooms is split: channels are unique on
--       (project_id, slug); DMs are unique on slug (which is the sorted UUID
--       pair, so it's already globally unique per user-pair).
--
--   DM eligibility helper (project_chat_dm_slug_allows_actor) no longer takes a
--   project_id — it just verifies that both parties currently share OR
--   previously shared a project via project_access.
--
--   Existing DM data is dropped (pre-launch — we're still in development).

-- ── 1. Wipe legacy DM data ─────────────────────────────────────────────────
DELETE FROM public.chat_room_message_reactions
WHERE room_id IN (SELECT id FROM public.chat_rooms WHERE type = 'dm');

DELETE FROM public.chat_room_messages
WHERE room_id IN (SELECT id FROM public.chat_rooms WHERE type = 'dm');

DELETE FROM public.chat_room_participants
WHERE room_id IN (SELECT id FROM public.chat_rooms WHERE type = 'dm');

DELETE FROM public.chat_rooms WHERE type = 'dm';

-- ── 2. Relax NOT NULL on project_id ────────────────────────────────────────
ALTER TABLE public.chat_rooms
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.chat_room_messages
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.chat_room_participants
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.chat_room_message_reactions
  ALTER COLUMN project_id DROP NOT NULL;

-- ── 3. CHECK constraint: channel ⇔ project_id present ──────────────────────
ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS chat_rooms_type_project_id_consistency;

ALTER TABLE public.chat_rooms
  ADD CONSTRAINT chat_rooms_type_project_id_consistency
  CHECK (
    (type = 'channel'::public.chat_room_type AND project_id IS NOT NULL)
    OR (type = 'dm'::public.chat_room_type AND project_id IS NULL)
  );

-- ── 4. Replace the old unique constraint ───────────────────────────────────
ALTER TABLE public.chat_rooms
  DROP CONSTRAINT IF EXISTS uq_chat_rooms_project_type_slug;

CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_channel_uniq
  ON public.chat_rooms (project_id, slug)
  WHERE type = 'channel';

CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_dm_uniq
  ON public.chat_rooms (slug)
  WHERE type = 'dm';

-- ── 5. Indexes ─────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_chat_room_messages_project_created_desc;
DROP INDEX IF EXISTS public.idx_chat_room_participants_user_project;
DROP INDEX IF EXISTS public.idx_chat_message_reactions_project_created_desc;

CREATE INDEX IF NOT EXISTS idx_chat_room_participants_user_lastread
  ON public.chat_room_participants (user_id, last_read_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_type
  ON public.chat_rooms (type);

-- ── 6. DM eligibility helper — drops project_id parameter ──────────────────
-- Old signature lives on as a thin wrapper (some pre-existing RLS policies
-- reference it; we recreate them below to call the new version directly).
CREATE OR REPLACE FUNCTION public.project_chat_users_share_any_project(
  user_a uuid,
  user_b uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_access pa
    JOIN public.project_access pb ON pb.project_id = pa.project_id
    WHERE pa.user_id = user_a
      AND pb.user_id = user_b
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE (p.client_id = user_a OR p.consultant_id = user_a)
      AND (p.client_id = user_b OR p.consultant_id = user_b)
  );
$$;

CREATE OR REPLACE FUNCTION public.project_chat_dm_slug_allows_actor(
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
  IF actor_user_id IS NULL OR dm_slug IS NULL THEN
    RETURN false;
  END IF;

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

  RETURN public.project_chat_users_share_any_project(actor_user_id, recipient_user);
END;
$$;

-- The legacy 3-arg overload is dropped at the end, after the policies that
-- depended on it are recreated to call the new signature.

-- ── 7. Rewrite RLS policies on chat_rooms ─────────────────────────────────
DROP POLICY IF EXISTS "Project members can create valid chat rooms" ON public.chat_rooms;
CREATE POLICY "Project members can create valid chat rooms"
ON public.chat_rooms
FOR INSERT
WITH CHECK (
  CASE
    WHEN type = 'channel'::public.chat_room_type THEN
      project_id IS NOT NULL
      AND public.project_chat_is_member(project_id, auth.uid())
      AND slug = 'general'
    WHEN type = 'dm'::public.chat_room_type THEN
      project_id IS NULL
      AND public.project_chat_dm_slug_allows_actor(slug, auth.uid())
    ELSE false
  END
);

-- Read policy unchanged (still keyed on room participation).

-- ── 8. Rewrite RLS policies on chat_room_participants ─────────────────────
DROP POLICY IF EXISTS "Project members can self-join channels" ON public.chat_room_participants;
CREATE POLICY "Project members can self-join chat rooms"
ON public.chat_room_participants
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.chat_rooms cr
    WHERE cr.id = room_id
      AND (
        (
          cr.type = 'channel'::public.chat_room_type
          AND cr.slug = 'general'
          AND cr.project_id IS NOT NULL
          AND public.project_chat_is_member(cr.project_id, auth.uid())
        )
        OR (
          cr.type = 'dm'::public.chat_room_type
          AND public.project_chat_dm_slug_allows_actor(cr.slug, auth.uid())
        )
      )
  )
);

-- ── 9. Rewrite RLS policies on chat_room_messages ─────────────────────────
DROP POLICY IF EXISTS "Chat participants can read messages" ON public.chat_room_messages;
CREATE POLICY "Chat participants can read messages"
ON public.chat_room_messages
FOR SELECT
USING (public.project_chat_is_room_participant(room_id, auth.uid()));

DROP POLICY IF EXISTS "Chat participants can send messages" ON public.chat_room_messages;
CREATE POLICY "Chat participants can send messages"
ON public.chat_room_messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND public.project_chat_is_room_participant(room_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.chat_rooms cr
    WHERE cr.id = room_id
      AND (
        (
          cr.type = 'channel'::public.chat_room_type
          AND cr.project_id IS NOT NULL
          AND chat_room_messages.project_id = cr.project_id
          AND public.project_chat_is_member(cr.project_id, auth.uid())
        )
        OR (
          cr.type = 'dm'::public.chat_room_type
          AND chat_room_messages.project_id IS NULL
        )
      )
  )
);

-- ── 10. Rewrite RLS policies on chat_room_message_reactions ───────────────
DROP POLICY IF EXISTS "Chat participants can read reactions" ON public.chat_room_message_reactions;
CREATE POLICY "Chat participants can read reactions"
ON public.chat_room_message_reactions
FOR SELECT
USING (public.project_chat_is_room_participant(room_id, auth.uid()));

DROP POLICY IF EXISTS "Chat participants can add reactions" ON public.chat_room_message_reactions;
CREATE POLICY "Chat participants can add reactions"
ON public.chat_room_message_reactions
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND public.project_chat_is_room_participant(room_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.chat_room_messages crm
    JOIN public.chat_rooms cr ON cr.id = crm.room_id
    WHERE crm.id = message_id
      AND crm.room_id = chat_room_message_reactions.room_id
      AND (
        (cr.type = 'channel'::public.chat_room_type
         AND cr.project_id IS NOT NULL
         AND chat_room_message_reactions.project_id = cr.project_id)
        OR (cr.type = 'dm'::public.chat_room_type
            AND chat_room_message_reactions.project_id IS NULL)
      )
  )
);

DROP POLICY IF EXISTS "Users can remove own reactions" ON public.chat_room_message_reactions;
CREATE POLICY "Users can remove own reactions"
ON public.chat_room_message_reactions
FOR DELETE
USING (
  user_id = auth.uid()
  AND public.project_chat_is_room_participant(room_id, auth.uid())
);

-- ── 11. Drop the legacy 3-arg overload now that no policies reference it ──
DROP FUNCTION IF EXISTS public.project_chat_dm_slug_allows_actor(uuid, text, uuid);
