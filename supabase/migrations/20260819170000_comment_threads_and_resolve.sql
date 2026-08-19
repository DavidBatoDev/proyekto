-- Migration: 20260819170000_comment_threads_and_resolve.sql
--
-- Purpose:
--   Give epic/feature/task comments the two things a Google-Docs-style comment
--   panel needs and the flat tables cannot express: REPLIES and RESOLVE.
--
-- Shape: one level, not a tree.
--   A comment with parent_id IS NULL is a THREAD ROOT; a comment with parent_id
--   set is a REPLY to that root. Replies to replies are rejected by trigger, not
--   merely discouraged. Docs-style comments are strictly two levels, and a tree
--   would force the client into recursive rendering and the summary RPC into a
--   recursive CTE for no product gain. Making it a hard constraint now is much
--   cheaper than discovering depth-3 rows later.
--
-- Resolve lives on the ROOT only.
--   `resolved_at IS NULL` = open thread. Resolving is a property of the
--   conversation, not of an individual message, so the CHECK forbids a resolved
--   reply outright rather than leaving two places to ask "is this settled?".
--
-- Why nullable resolved_by with ON DELETE SET NULL, and why the CHECK is
-- one-directional: a resolver whose profile is later deleted must not
-- un-resolve the thread, so (resolved_at IS NOT NULL AND resolved_by IS NULL)
-- has to stay legal. Only the reverse -- a resolver on an unresolved thread --
-- is nonsense, and that is what the CHECK forbids.
--
-- Column drift, deliberately NOT fixed here: task_comments uses author_id +
-- edited_at while epic/feature_comments use user_id + updated_at. Renaming is a
-- breaking change to three repositories, the AI task-comment DTOs and the
-- summary RPC, and it does not need to happen in the same migration that adds
-- threading. The new columns are spelled identically on all three tables so
-- nothing added here widens that gap.
--
-- RLS is deliberately untouched. Every writer is the backend's service-role
-- client (SUPABASE_ADMIN), which bypasses RLS; the "who may resolve" rule is
-- enforced in the service, the same split the roadmap_notes migration
-- documents. Widening the author-only UPDATE policies would let any commenter
-- rewrite another person's text -- a real regression -- to enable a direct
-- client call that nothing makes.

-- ---------------------------------------------------------------- columns ---

ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS parent_id   uuid REFERENCES public.task_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.epic_comments
  ADD COLUMN IF NOT EXISTS parent_id   uuid REFERENCES public.epic_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.feature_comments
  ADD COLUMN IF NOT EXISTS parent_id   uuid REFERENCES public.feature_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ------------------------------------------------------------ constraints ---
-- Guarded in DO blocks: ADD CONSTRAINT has no IF NOT EXISTS, and this migration
-- must stay re-runnable like the ADD COLUMN IF NOT EXISTS above it.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_comments', 'epic_comments', 'feature_comments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = format('public.%I', t)::regclass
         AND conname = t || '_replies_not_resolvable'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (parent_id IS NULL OR resolved_at IS NULL)',
        t, t || '_replies_not_resolvable');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = format('public.%I', t)::regclass
         AND conname = t || '_resolver_needs_resolution'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (resolved_at IS NOT NULL OR resolved_by IS NULL)',
        t, t || '_resolver_needs_resolution');
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- indexes ---
-- Replies are always fetched by root, and the open-thread count the canvas
-- badge shows is a partial scan of roots -- both get their own partial index so
-- neither pays for the other's rows.

CREATE INDEX IF NOT EXISTS idx_task_comments_parent
  ON public.task_comments (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_epic_comments_parent
  ON public.epic_comments (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feature_comments_parent
  ON public.feature_comments (parent_id, created_at) WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_comments_open_threads
  ON public.task_comments (task_id) WHERE parent_id IS NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_epic_comments_open_threads
  ON public.epic_comments (epic_id) WHERE parent_id IS NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_feature_comments_open_threads
  ON public.feature_comments (feature_id) WHERE parent_id IS NULL AND resolved_at IS NULL;

-- ---------------------------------------------------------------- trigger ---
-- Depth and cross-node integrity cannot be expressed as a CHECK (both need to
-- read the parent row), so they are a BEFORE trigger. One generic function
-- serves all three tables; TG_ARGV[0] names that table's node column, and NEW
-- is read through to_jsonb so the function never hardcodes it.

CREATE OR REPLACE FUNCTION public.assert_comment_reply_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_parent uuid;
  v_parent_node   uuid;
  v_node          uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'a comment cannot reply to itself';
  END IF;

  EXECUTE format(
    'SELECT parent_id, %I FROM public.%I WHERE id = $1',
    TG_ARGV[0], TG_TABLE_NAME
  ) INTO v_parent_parent, v_parent_node USING NEW.parent_id;

  IF v_parent_node IS NULL THEN
    RAISE EXCEPTION 'parent comment % does not exist', NEW.parent_id;
  END IF;

  IF v_parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'comment threads are one level deep: % is already a reply', NEW.parent_id;
  END IF;

  v_node := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF v_parent_node IS DISTINCT FROM v_node THEN
    RAISE EXCEPTION 'a reply must sit on the same % as its parent thread', TG_ARGV[0];
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_comments_reply_shape ON public.task_comments;
CREATE TRIGGER trg_task_comments_reply_shape
BEFORE INSERT OR UPDATE OF parent_id ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.assert_comment_reply_shape('task_id');

DROP TRIGGER IF EXISTS trg_epic_comments_reply_shape ON public.epic_comments;
CREATE TRIGGER trg_epic_comments_reply_shape
BEFORE INSERT OR UPDATE OF parent_id ON public.epic_comments
FOR EACH ROW EXECUTE FUNCTION public.assert_comment_reply_shape('epic_id');

DROP TRIGGER IF EXISTS trg_feature_comments_reply_shape ON public.feature_comments;
CREATE TRIGGER trg_feature_comments_reply_shape
BEFORE INSERT OR UPDATE OF parent_id ON public.feature_comments
FOR EACH ROW EXECUTE FUNCTION public.assert_comment_reply_shape('feature_id');

COMMENT ON COLUMN public.task_comments.parent_id IS
  'Thread root this comment replies to. NULL = the comment IS a thread root. One level only, enforced by trg_task_comments_reply_shape.';
COMMENT ON COLUMN public.task_comments.resolved_at IS
  'When the thread was resolved. Roots only -- a reply may never carry it (task_comments_replies_not_resolvable).';
