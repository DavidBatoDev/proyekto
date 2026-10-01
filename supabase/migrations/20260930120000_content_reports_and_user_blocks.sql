-- Report content and block users (App Store guideline 1.2, user-generated content).
--
-- Chat, direct messages and roadmap comments are user-generated content, so the
-- app must let people report objectionable content and block abusive users.
--
--   user_blocks      one row per (blocker, blocked). Blocking stops direct messages
--                    both ways, suppresses the blocked person's notifications to the
--                    blocker, and collapses their messages and comments in the
--                    blocker's UI.
--   content_reports  one row per (reporter, target). Support is emailed on insert;
--                    content_snapshot keeps the evidence if the message is unsent.
--
-- Both tables are written only by the backend (service role, which does the access
-- checks), so client writes are revoked outright, as in
-- 20260922130000_harden_direct_table_writes.sql. SELECT-own policies stay for parity.

-- ---------------------------------------------------------------------------
-- user_blocks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

COMMENT ON TABLE public.user_blocks IS
  'Who has blocked whom. Written only by the backend safety module.';

-- The reverse direction: "who has blocked this sender", read on every chat send
-- to drop notifications.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own blocks" ON public.user_blocks;
CREATE POLICY "Users read own blocks"
ON public.user_blocks
FOR SELECT USING (blocker_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.user_blocks
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- content_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reported_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL
    CHECK (target_type IN ('chat_message', 'task_comment', 'epic_comment', 'feature_comment', 'user')),
  target_id uuid NOT NULL,
  room_id uuid,
  project_id uuid,
  reason text NOT NULL
    CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  content_snapshot text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_reports IS
  'User reports of chat messages, comments and people. Support is emailed on insert; reviewed within 24 hours.';

-- One report per person per target: a repeat tap returns the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_reports_reporter_target
  ON public.content_reports (reporter_id, target_type, target_id);

-- The moderation queue.
CREATE INDEX IF NOT EXISTS idx_content_reports_open
  ON public.content_reports (created_at DESC)
  WHERE status IN ('open', 'reviewing');

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own reports" ON public.content_reports;
CREATE POLICY "Users read own reports"
ON public.content_reports
FOR SELECT USING (reporter_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.content_reports
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Account deletion: the profile row is kept as a tombstone (see
-- 20260923090000_account_deletion_tombstone.sql), so the FK cascade never fires.
-- Clear the person's blocks, in both directions, when the tombstone is set.
-- Reports are kept: they are moderation records, not the reporter's content.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_user_blocks_on_account_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_blocks
   WHERE blocker_id = NEW.id OR blocked_id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_user_blocks_on_account_deletion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_clear_user_blocks_on_deletion ON public.profiles;
CREATE TRIGGER profiles_clear_user_blocks_on_deletion
  AFTER UPDATE OF deleted_at ON public.profiles
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.clear_user_blocks_on_account_deletion();
