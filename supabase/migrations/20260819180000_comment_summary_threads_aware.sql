-- Migration: 20260819180000_comment_summary_threads_aware.sql
--
-- Purpose:
--   Teach get_roadmap_comment_summary about the threads and resolve state added
--   in 20260819170000, so the canvas badge can count OPEN CONVERSATIONS instead
--   of raw messages.
--
--   A badge reading "7" when six of those are replies inside one settled thread
--   is worse than no badge: it tells you to go look at something already dealt
--   with. What a reader acts on is "how many unresolved threads", so that is
--   what the client renders, and the other two counts ride along for the panel
--   header ("3 of 5 resolved") without a second round trip.
--
-- DROP then CREATE, not CREATE OR REPLACE: the return type gains columns, and
-- Postgres refuses to replace a function whose OUT parameters changed. Rebuilt
-- in full from 20260819140000, the newest migration that defined it, per the
-- rule in supabase/CLAUDE.md -- the body below is that one plus the counts and
-- the open-thread preview filter.
--
-- Preview now means "latest message in a thread that is still open". The
-- COALESCE(root.resolved_at, c.resolved_at) test reads oddly but covers both
-- rows in one expression: for a root there is no joined root row, so it falls
-- through to the comment's own resolved_at; for a reply, resolved_at is always
-- NULL by CHECK, so it is the root's state that decides. Either way a settled
-- conversation stops previewing.
--
-- Everything else -- SECURITY INVOKER, the service-role caller contract, the
-- LEFT JOIN LATERAL so zero-comment nodes still return a row -- is unchanged
-- and its reasoning still lives in 20260819140000.

DROP FUNCTION IF EXISTS public.get_roadmap_comment_summary(uuid);

CREATE FUNCTION public.get_roadmap_comment_summary(p_roadmap_id uuid)
RETURNS TABLE (
  node_type         text,
  node_id           uuid,
  comment_count     bigint,
  thread_count      bigint,
  unresolved_count  bigint,
  last_comment_id   uuid,
  last_comment_at   timestamptz,
  last_author_id    uuid,
  last_author_name  text,
  last_content      text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- Epics.
  SELECT
    'epic'::text,
    e.id,
    COALESCE(c.total, 0),
    COALESCE(c.threads, 0),
    COALESCE(c.open_threads, 0),
    l.id, l.created_at, l.author_id, l.author_name, l.content
  FROM public.roadmap_epics e
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE ec.parent_id IS NULL) AS threads,
           count(*) FILTER (WHERE ec.parent_id IS NULL AND ec.resolved_at IS NULL) AS open_threads
      FROM public.epic_comments ec WHERE ec.epic_id = e.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT ec.id, ec.created_at, ec.user_id AS author_id,
           p.display_name AS author_name,
           left(ec.content, 2000) AS content
      FROM public.epic_comments ec
      LEFT JOIN public.epic_comments root ON root.id = ec.parent_id
      LEFT JOIN public.profiles p ON p.id = ec.user_id
     WHERE ec.epic_id = e.id
       AND COALESCE(root.resolved_at, ec.resolved_at) IS NULL
     ORDER BY ec.created_at DESC
     LIMIT 1
  ) l ON true
  WHERE e.roadmap_id = p_roadmap_id

  UNION ALL

  -- Features.
  SELECT
    'feature'::text,
    f.id,
    COALESCE(c.total, 0),
    COALESCE(c.threads, 0),
    COALESCE(c.open_threads, 0),
    l.id, l.created_at, l.author_id, l.author_name, l.content
  FROM public.roadmap_features f
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE fc.parent_id IS NULL) AS threads,
           count(*) FILTER (WHERE fc.parent_id IS NULL AND fc.resolved_at IS NULL) AS open_threads
      FROM public.feature_comments fc WHERE fc.feature_id = f.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT fc.id, fc.created_at, fc.user_id AS author_id,
           p.display_name AS author_name,
           left(fc.content, 2000) AS content
      FROM public.feature_comments fc
      LEFT JOIN public.feature_comments root ON root.id = fc.parent_id
      LEFT JOIN public.profiles p ON p.id = fc.user_id
     WHERE fc.feature_id = f.id
       AND COALESCE(root.resolved_at, fc.resolved_at) IS NULL
     ORDER BY fc.created_at DESC
     LIMIT 1
  ) l ON true
  WHERE f.roadmap_id = p_roadmap_id

  UNION ALL

  -- Tasks. Still the one branch that walks up through the parent feature.
  SELECT
    'task'::text,
    t.id,
    COALESCE(c.total, 0),
    COALESCE(c.threads, 0),
    COALESCE(c.open_threads, 0),
    l.id, l.created_at, l.author_id, l.author_name, l.content
  FROM public.roadmap_tasks t
  JOIN public.roadmap_features f ON f.id = t.feature_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE tc.parent_id IS NULL) AS threads,
           count(*) FILTER (WHERE tc.parent_id IS NULL AND tc.resolved_at IS NULL) AS open_threads
      FROM public.task_comments tc WHERE tc.task_id = t.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT tc.id, tc.created_at, tc.author_id,
           p.display_name AS author_name,
           left(tc.content, 2000) AS content
      FROM public.task_comments tc
      LEFT JOIN public.task_comments root ON root.id = tc.parent_id
      LEFT JOIN public.profiles p ON p.id = tc.author_id
     WHERE tc.task_id = t.id
       AND COALESCE(root.resolved_at, tc.resolved_at) IS NULL
     ORDER BY tc.created_at DESC
     LIMIT 1
  ) l ON true
  WHERE f.roadmap_id = p_roadmap_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_roadmap_comment_summary(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_roadmap_comment_summary(uuid) IS
  'Per-node comment counts (total / threads / unresolved threads) plus a preview of the newest message in a still-open thread, for every epic, feature and task on a roadmap. SECURITY INVOKER on purpose: the backend authorizes before calling with the service role, and a direct authenticated call is filtered by the existing *_comments_select policies.';
