-- Comment counts and last-comment previews for every node on a roadmap.
--
-- Why this exists: the canvas already renders a comment-count pill beside each
-- task row (FeatureWidget's comment gutter), but `comment_count` was never
-- hydrated from the server -- the only writer was a client store setter called
-- after the user opened that task's Comments tab. The badge therefore appeared
-- only once you had already read the thread, which is exactly when you no
-- longer need it. Epics and features had no indicator at all.
--
-- Why a sidecar function and not a column on the /full payload:
--   * /full is the hottest read in the app and its select string is already
--     four levels of nested embeds deep (the code comments there note the
--     embeds exceed PostgREST's literal-type parser). Adding an aggregate
--     embed inside it is the highest-risk change available, and aggregates
--     over embeds depend on a Supabase server setting no migration here owns.
--   * A counter column would fire a full-row UPDATE on roadmap_tasks for every
--     comment insert. That table is in the supabase_realtime publication with
--     REPLICA IDENTITY FULL, so each comment would broadcast to every canvas
--     subscriber -- WAL and fan-out amplification to save one query.
--   * Counters also cannot carry a preview, so previews would need a second
--     fetch anyway. This returns counts AND previews in one call.
-- If this is ever measured slow on a very large roadmap, denormalised counters
-- can be added BEHIND this function with no client change.
--
-- SECURITY INVOKER (the default, stated explicitly because it is a decision):
-- the backend calls this with the service role, which bypasses RLS, and the
-- service asserts view permission on the roadmap first -- the same shape as
-- FeatureDependenciesService.list. If it is ever called by an `authenticated`
-- client instead, the existing task/epic/feature _comments_select policies
-- filter the rows correctly for free. A SECURITY DEFINER wrapper around
-- can_view_roadmap(auth.uid(), ...) would be WRONG here: auth.uid() is NULL
-- under the service role, so it would fail closed for the only caller there is.

-- Composite indexes are the point of the exercise: the laterals below order by
-- created_at per parent, which seq-scans without them. The existing
-- single-column idx_*_comments_*_id indexes stay -- the RLS EXISTS walks use
-- those.
CREATE INDEX IF NOT EXISTS idx_task_comments_task_created
  ON public.task_comments (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_epic_comments_epic_created
  ON public.epic_comments (epic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_comments_feature_created
  ON public.feature_comments (feature_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_roadmap_comment_summary(p_roadmap_id uuid)
RETURNS TABLE (
  node_type         text,
  node_id           uuid,
  comment_count     bigint,
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
  -- Epics. LEFT JOIN LATERAL so a node with zero comments still returns a row
  -- (count 0, null preview); the client needs to know "no comments" as much as
  -- it needs a count, and an inner join would silently omit them.
  SELECT
    'epic'::text,
    e.id,
    COALESCE(c.cnt, 0),
    l.id, l.created_at, l.author_id, l.author_name, l.content
  FROM public.roadmap_epics e
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt FROM public.epic_comments ec WHERE ec.epic_id = e.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT ec.id, ec.created_at, ec.user_id AS author_id,
           p.display_name AS author_name,
           -- Bounded here rather than in the client: the backend strips HTML
           -- and truncates to an excerpt, and shipping whole threads over the
           -- wire to throw them away is waste.
           left(ec.content, 2000) AS content
      FROM public.epic_comments ec
      LEFT JOIN public.profiles p ON p.id = ec.user_id
     WHERE ec.epic_id = e.id
     ORDER BY ec.created_at DESC
     LIMIT 1
  ) l ON true
  WHERE e.roadmap_id = p_roadmap_id

  UNION ALL

  -- Features. roadmap_id is denormalised on this table, so no join upward.
  SELECT
    'feature'::text,
    f.id,
    COALESCE(c.cnt, 0),
    l.id, l.created_at, l.author_id, l.author_name, l.content
  FROM public.roadmap_features f
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt FROM public.feature_comments fc WHERE fc.feature_id = f.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT fc.id, fc.created_at, fc.user_id AS author_id,
           p.display_name AS author_name,
           left(fc.content, 2000) AS content
      FROM public.feature_comments fc
      LEFT JOIN public.profiles p ON p.id = fc.user_id
     WHERE fc.feature_id = f.id
     ORDER BY fc.created_at DESC
     LIMIT 1
  ) l ON true
  WHERE f.roadmap_id = p_roadmap_id

  UNION ALL

  -- Tasks. roadmap_tasks has no roadmap_id, so this is the one branch that
  -- walks up through its parent feature. NOTE the column drift: the author is
  -- `author_id` here but `user_id` on the other two tables, and task_comments
  -- has no updated_at (only a nullable edited_at) -- which is why all three
  -- branches order by created_at, so the three tables cannot sort differently.
  SELECT
    'task'::text,
    t.id,
    COALESCE(c.cnt, 0),
    l.id, l.created_at, l.author_id, l.author_name, l.content
  FROM public.roadmap_tasks t
  JOIN public.roadmap_features f ON f.id = t.feature_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt FROM public.task_comments tc WHERE tc.task_id = t.id
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT tc.id, tc.created_at, tc.author_id,
           p.display_name AS author_name,
           left(tc.content, 2000) AS content
      FROM public.task_comments tc
      LEFT JOIN public.profiles p ON p.id = tc.author_id
     WHERE tc.task_id = t.id
     ORDER BY tc.created_at DESC
     LIMIT 1
  ) l ON true
  WHERE f.roadmap_id = p_roadmap_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_roadmap_comment_summary(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_roadmap_comment_summary(uuid) IS
  'Comment counts + last-comment previews for every epic, feature and task on a roadmap, in one call. SECURITY INVOKER on purpose: the backend authorizes before calling with the service role, and a direct authenticated call is filtered by the existing *_comments_select policies.';
