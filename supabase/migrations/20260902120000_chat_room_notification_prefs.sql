-- Per-room chat notification level, and the type for plain (non-mention) messages.
--
-- Until now a plain message in a project channel produced NO notification at all
-- — only @mentions did — and a DM produced at most one per read-cycle, because
-- notifyDmRecipients short-circuits on findLiveChatRoomNotification. That dedup
-- is correct for the bell and the email digest and wrong for push, so push moves
-- to a per-message path (ChatPushService) and this table is what keeps it from
-- becoming noise.
--
-- Default is ALL for every room type: an absent row means "notify me about every
-- message". Sparse on purpose — joining a project with 60 channels writes nothing
-- — so the default lives in code and SQL, never in a backfill.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_notification_level') THEN
    CREATE TYPE public.chat_notification_level AS ENUM ('all', 'mentions', 'none');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.chat_room_notification_prefs (
  -- (room_id, user_id) in that order: the hot path is "everyone's level for THIS
  -- room" on every message send, which this serves as a PK-prefix scan.
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level public.chat_notification_level NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

COMMENT ON TABLE public.chat_room_notification_prefs IS
  'Sparse per-(room,user) overrides. An absent row means level = all. Never backfilled.';

-- The reverse direction: one user's overrides, for hydrating their room list.
CREATE INDEX IF NOT EXISTS idx_chat_room_notification_prefs_user
  ON public.chat_room_notification_prefs (user_id);

CREATE OR REPLACE FUNCTION public.handle_chat_room_notification_prefs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_room_notification_prefs_updated_at
  ON public.chat_room_notification_prefs;
CREATE TRIGGER chat_room_notification_prefs_updated_at
  BEFORE UPDATE ON public.chat_room_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.handle_chat_room_notification_prefs_updated_at();

ALTER TABLE public.chat_room_notification_prefs ENABLE ROW LEVEL SECURITY;

-- Personal data, scoped to yourself on every verb.
--
-- Deliberately NO project_chat_is_room_participant() check, unlike chat_room_stars.
-- Channel membership is the project roster, not chat_room_participants — joining a
-- channel is lazy — so requiring a participant row would stop someone muting a
-- channel that is already notifying them. The row is inert on its own: the send
-- path resolves recipients independently and only then reads a level, so a row for
-- an unreachable room grants nothing. The backend writes with the service role and
-- gates on assertRoomAccess; these policies are defensive parity.
DROP POLICY IF EXISTS "Users read own chat notification prefs"
  ON public.chat_room_notification_prefs;
CREATE POLICY "Users read own chat notification prefs"
ON public.chat_room_notification_prefs
FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own chat notification prefs"
  ON public.chat_room_notification_prefs;
CREATE POLICY "Users insert own chat notification prefs"
ON public.chat_room_notification_prefs
FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own chat notification prefs"
  ON public.chat_room_notification_prefs;
CREATE POLICY "Users update own chat notification prefs"
ON public.chat_room_notification_prefs
FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own chat notification prefs"
  ON public.chat_room_notification_prefs;
CREATE POLICY "Users delete own chat notification prefs"
ON public.chat_room_notification_prefs
FOR DELETE USING (user_id = auth.uid());

-- The bell/email row for a plain chat message. Push does NOT go through this type
-- — ChatPushService sends per message — so this row is created at most once per
-- room per read-cycle, exactly like chat_dm_received. That is what keeps the
-- AFTER INSERT email-outbox trigger from mailing someone on every message.
INSERT INTO public.notification_types (name, category, priority)
VALUES ('chat_message_received', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;

-- Same 30-minute delay as chat_dm_received, so the worker's seen_in_app gate has
-- time to suppress mail for anything already read on a phone.
UPDATE public.notification_types
SET email_eligible = true,
    email_delay_seconds = 1800,
    email_default_enabled = true
WHERE name = 'chat_message_received';
