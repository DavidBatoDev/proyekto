-- ============================================================================
-- Offset paging for the AI context list RPCs.
--
-- The agent's list tools gain an `offset` parameter so a long list is paged
-- instead of truncated. Two functions change:
--
-- 1. public.ai_context_list_tasks gains `p_offset` and a `total_count` column
--    (a window count over the filtered set, free because the ORDER BY already
--    materialises it). The ORDER BY gains `t.id` as a unique tiebreak so an
--    offset never skips or duplicates a row. The return type changes, so the
--    old signature is DROPPED first (CREATE OR REPLACE cannot change a return
--    type, and leaving two overloads would make PostgREST reject every call).
--    Body copied from its newest defining migration,
--    20260906090000_upsert_full_roadmap_task_assignees.sql (latest-function-body
--    rule); the only edits are the parameter, the column, the tiebreak, the
--    OFFSET clause and the cap (200 -> 500; the backend DTO caps callers).
--
-- 2. public.ai_context_search_nodes keeps its signature: the backend merges
--    these rows with in-process roadmap/project matches and pages AFTER the
--    merge, so the offset must not live in SQL. It gains unique tiebreaks
--    (`id`) in every ORDER BY, matching the backend's compareMatches order
--    (rank, updated_at desc nulls last, id asc), and its caps rise 50 -> 300
--    so a page past the first can still be served from the lanes. Body copied
--    from 20260904090000_ai_sessions_scope_and_context_rpcs.sql.
--
-- Both stay service_role only. Apply via the Supabase MCP apply_migration
-- tool (dev, then prod); never `supabase db push`.
-- ============================================================================

DROP FUNCTION IF EXISTS public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer);

CREATE FUNCTION public.ai_context_list_tasks(
  p_roadmap_ids uuid[],
  p_assignee uuid DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_due_from timestamptz DEFAULT NULL,
  p_due_to timestamptz DEFAULT NULL,
  p_overdue_at timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  status text,
  priority text,
  due_date timestamptz,
  updated_at timestamptz,
  feature_id uuid,
  feature_title text,
  epic_id uuid,
  epic_title text,
  roadmap_id uuid,
  assignee_ids uuid[],
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- Status semantics: a NULL status counts as 'todo', so it matches an 'open'
  -- filter (todo|in_progress|in_review|blocked) but never 'blocked' alone.
  -- Assignee semantics: the roadmap_task_assignees join table OR the legacy
  -- roadmap_tasks.assignee_id mirror (same set semantics as the in-roadmap
  -- getContextTasksAssignedToMe (join table or the legacy column)).
  -- total_count is the size of the whole filtered set, repeated on every row,
  -- so a page can report "showing N of M" without a second query.
  SELECT t.id,
         t.title,
         COALESCE(t.status::text, 'todo') AS status,
         t.priority::text AS priority,
         t.due_date,
         t.updated_at,
         f.id AS feature_id,
         f.title AS feature_title,
         e.id AS epic_id,
         e.title AS epic_title,
         f.roadmap_id,
         COALESCE(
           (SELECT array_agg(a.assignee_id ORDER BY (a.assignee_id = t.assignee_id) DESC, a.assigned_at, a.assignee_id)
              FROM public.roadmap_task_assignees a
             WHERE a.task_id = t.id),
           CASE
             WHEN t.assignee_id IS NULL THEN '{}'::uuid[]
             ELSE ARRAY[t.assignee_id]
           END
         ) AS assignee_ids,
         count(*) OVER () AS total_count
    FROM public.roadmap_tasks t
    JOIN public.roadmap_features f ON f.id = t.feature_id
    JOIN public.roadmap_epics e ON e.id = f.epic_id
   WHERE f.roadmap_id = ANY (p_roadmap_ids)
     AND (p_assignee IS NULL
          OR t.assignee_id = p_assignee
          OR EXISTS (
               SELECT 1
                 FROM public.roadmap_task_assignees a
                WHERE a.task_id = t.id
                  AND a.assignee_id = p_assignee))
     AND (p_statuses IS NULL OR COALESCE(t.status::text, 'todo') = ANY (p_statuses))
     AND (p_due_from IS NULL OR t.due_date >= p_due_from)
     AND (p_due_to IS NULL OR t.due_date <= p_due_to)
     AND (p_overdue_at IS NULL
          OR (t.due_date IS NOT NULL
              AND t.due_date < p_overdue_at
              AND COALESCE(t.status::text, 'todo') <> 'done'))
   ORDER BY (t.due_date IS NULL), t.due_date ASC, t.updated_at DESC NULLS LAST, t.id ASC
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
$$;

COMMENT ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer, integer) IS
  'Cross-roadmap task listing for the AI context surface with feature/epic/roadmap attribution and assignee_ids (join table OR legacy assignee_id). NULL status counts as todo. Total order (due_date nulls last, due_date, updated_at desc, id); p_offset/p_limit page it and total_count carries the filtered total on every row; cap 500. Callers pass pre-authorized roadmap ids; service_role only.';

REVOKE ALL ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ai_context_search_nodes(
  p_roadmap_ids uuid[],
  p_query text,
  p_kinds text[] DEFAULT ARRAY['epic', 'feature', 'task'],
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  kind text,
  title text,
  status text,
  roadmap_id uuid,
  epic_id uuid,
  feature_id uuid,
  parent_title text,
  rank integer,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- The caller sanitizes the needle like sanitizeLookupQuery (strips % and _,
  -- collapses whitespace, caps length) and skips the call on an empty needle;
  -- the q.needle <> '' guard makes an empty needle return nothing rather than
  -- the whole roadmap. rank: 0 exact, 1 prefix, 2 substring, 3 description-only.
  -- Every ORDER BY ends in the row id so the order is total: the backend pages
  -- the merged result by offset and asks for offset + limit + 1 rows here.
  WITH q AS (
    SELECT lower(btrim(COALESCE(p_query, ''))) AS needle
  ),
  lane_epics AS (
    SELECT e.id,
           'epic'::text AS kind,
           e.title,
           e.status::text AS status,
           e.roadmap_id,
           NULL::uuid AS epic_id,
           NULL::uuid AS feature_id,
           NULL::text AS parent_title,
           CASE
             WHEN lower(e.title) = q.needle THEN 0
             WHEN lower(e.title) LIKE q.needle || '%' THEN 1
             WHEN lower(e.title) LIKE '%' || q.needle || '%' THEN 2
             ELSE 3
           END AS rank,
           e.updated_at
      FROM public.roadmap_epics e
      CROSS JOIN q
     WHERE 'epic' = ANY (p_kinds)
       AND q.needle <> ''
       AND e.roadmap_id = ANY (p_roadmap_ids)
       AND (e.title ILIKE '%' || q.needle || '%'
            OR e.description ILIKE '%' || q.needle || '%')
     ORDER BY rank, e.updated_at DESC NULLS LAST, e.id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 300)
  ),
  lane_features AS (
    SELECT f.id,
           'feature'::text AS kind,
           f.title,
           f.status::text AS status,
           f.roadmap_id,
           f.epic_id,
           NULL::uuid AS feature_id,
           pe.title AS parent_title,
           CASE
             WHEN lower(f.title) = q.needle THEN 0
             WHEN lower(f.title) LIKE q.needle || '%' THEN 1
             WHEN lower(f.title) LIKE '%' || q.needle || '%' THEN 2
             ELSE 3
           END AS rank,
           f.updated_at
      FROM public.roadmap_features f
      JOIN public.roadmap_epics pe ON pe.id = f.epic_id
      CROSS JOIN q
     WHERE 'feature' = ANY (p_kinds)
       AND q.needle <> ''
       AND f.roadmap_id = ANY (p_roadmap_ids)
       AND (f.title ILIKE '%' || q.needle || '%'
            OR f.description ILIKE '%' || q.needle || '%')
     ORDER BY rank, f.updated_at DESC NULLS LAST, f.id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 300)
  ),
  lane_tasks AS (
    -- Tasks carry no roadmap_id; the denormalized roadmap_features.roadmap_id
    -- is the one-hop attribution. Title-only match (task descriptions are long).
    SELECT t.id,
           'task'::text AS kind,
           t.title,
           COALESCE(t.status::text, 'todo') AS status,
           pf.roadmap_id,
           pf.epic_id,
           t.feature_id,
           pf.title AS parent_title,
           CASE
             WHEN lower(t.title) = q.needle THEN 0
             WHEN lower(t.title) LIKE q.needle || '%' THEN 1
             ELSE 2
           END AS rank,
           t.updated_at
      FROM public.roadmap_tasks t
      JOIN public.roadmap_features pf ON pf.id = t.feature_id
      CROSS JOIN q
     WHERE 'task' = ANY (p_kinds)
       AND q.needle <> ''
       AND pf.roadmap_id = ANY (p_roadmap_ids)
       AND t.title ILIKE '%' || q.needle || '%'
     ORDER BY rank, t.updated_at DESC NULLS LAST, t.id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 300)
  )
  SELECT u.id,
         u.kind,
         u.title,
         u.status,
         u.roadmap_id,
         u.epic_id,
         u.feature_id,
         u.parent_title,
         u.rank,
         u.updated_at
    FROM (
      SELECT * FROM lane_epics
      UNION ALL
      SELECT * FROM lane_features
      UNION ALL
      SELECT * FROM lane_tasks
    ) AS u
   ORDER BY u.rank, u.updated_at DESC NULLS LAST, u.id ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 300);
$$;

COMMENT ON FUNCTION public.ai_context_search_nodes(uuid[], text, text[], integer) IS
  'Cross-roadmap epic/feature/task title search for the AI context surface. rank 0 exact, 1 prefix, 2 substring, 3 description-only; total order (rank, updated_at desc nulls last, id); cap 300 so the backend can page the merged result by offset. Callers pass pre-authorized roadmap ids and a sanitized needle; service_role only.';
