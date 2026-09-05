-- AI sessions: workspace scope, own-row RLS, run attribution, cross-roadmap read RPCs.
--
-- Why (PR1 of the agent re-architecture, additive; the old backend keeps working):
--   * The dashboard assistant needs AI threads that belong to a WORKSPACE rather
--     than to one roadmap. roadmap_ai_sessions gains a nullable workspace_id, a
--     scope discriminator, and a one-of CHECK. DEFAULT 'roadmap' keeps the
--     pre-deploy backend's inserts valid and backfills every existing row.
--   * workspace_id is ON DELETE CASCADE (not SET NULL) on purpose: SET NULL would
--     violate the one-of CHECK, and threads are private per-user scratch exactly
--     like the existing roadmap_id ... ON DELETE CASCADE. Durable history lives in
--     roadmap_change_history, which gets session_id ... ON DELETE SET NULL below.
--   * The inline mode CHECK still allows only chat|edit_plan while the DTO ships
--     plan_proposal (live 500). Re-added with the third value.
--   * RLS: the policies from 20260416120000 died with can_access_roadmap in the
--     CASCADE drop of 20260504000020, so today authenticated sees NO rows while
--     anon + authenticated still hold full DML grants. This RESTORES own-row
--     SELECT (owner AND still able to see the roadmap / still a member of the
--     workspace) over the live SECURITY DEFINER helpers can_view_roadmap and
--     is_workspace_member, withdraws DML from anon/authenticated (only the
--     service-role backend writes), and adds the house service_role policy.
--   * roadmap_change_history gains session_id + run_id so a run that commits to
--     N roadmaps can be listed back (GET /api/ai/context/changes).
--   * Three SECURITY INVOKER read RPCs take a uuid[] of roadmap ids that the
--     backend has ALREADY authorized (RoadmapAuthorizationService
--     .filterViewableRoadmapIds). EXECUTE is withheld from anon/authenticated so
--     they cannot become a lateral read path; only service_role may call them.
--
-- Sources (latest-body rule): sessions 20260416120000, change history
-- 20260727090000, can_view_roadmap(uid, rmp) 20260504000030,
-- is_workspace_member(p_workspace_id, p_user_id) 20260902090000.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. roadmap_ai_sessions: scope generalization
-- ---------------------------------------------------------------------------
ALTER TABLE public.roadmap_ai_sessions
  ALTER COLUMN roadmap_id DROP NOT NULL;

ALTER TABLE public.roadmap_ai_sessions
  ADD COLUMN IF NOT EXISTS workspace_id uuid
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'roadmap';

ALTER TABLE public.roadmap_ai_sessions
  DROP CONSTRAINT IF EXISTS roadmap_ai_sessions_scope_check;
ALTER TABLE public.roadmap_ai_sessions
  ADD CONSTRAINT roadmap_ai_sessions_scope_check
    CHECK (scope IN ('roadmap', 'workspace'));

ALTER TABLE public.roadmap_ai_sessions
  DROP CONSTRAINT IF EXISTS roadmap_ai_sessions_scope_target_check;
ALTER TABLE public.roadmap_ai_sessions
  ADD CONSTRAINT roadmap_ai_sessions_scope_target_check CHECK (
    (scope = 'roadmap' AND roadmap_id IS NOT NULL AND workspace_id IS NULL)
    OR (scope = 'workspace' AND workspace_id IS NOT NULL AND roadmap_id IS NULL)
  );

-- The inline `mode ... CHECK (mode IN ('chat', 'edit_plan'))` from 20260416120000
-- was auto-named {table}_{column}_check by Postgres. AI_SESSION_MODES already ships
-- 'plan_proposal' (backend dto/roadmap-ai-sessions.dto.ts), so re-add with it.
ALTER TABLE public.roadmap_ai_sessions
  DROP CONSTRAINT IF EXISTS roadmap_ai_sessions_mode_check;
ALTER TABLE public.roadmap_ai_sessions
  ADD CONSTRAINT roadmap_ai_sessions_mode_check
    CHECK (mode IN ('chat', 'edit_plan', 'plan_proposal'));

COMMENT ON COLUMN public.roadmap_ai_sessions.workspace_id IS
  'Workspace-scope threads (scope = workspace). ON DELETE CASCADE: SET NULL would violate the one-of scope CHECK, and threads are private per-user scratch; durable history lives in roadmap_change_history.';
COMMENT ON COLUMN public.roadmap_ai_sessions.scope IS
  'roadmap | workspace. Exactly one of roadmap_id / workspace_id is set, enforced by roadmap_ai_sessions_scope_target_check.';

-- Workspace-scope twins of idx_roadmap_ai_sessions_active / _archived / _roadmap.
-- The existing (user_id, roadmap_id, ...) partials stay valid for roadmap scope.
CREATE INDEX IF NOT EXISTS idx_roadmap_ai_sessions_workspace_active
  ON public.roadmap_ai_sessions (user_id, workspace_id, last_message_at DESC NULLS LAST)
  WHERE is_archived = false AND workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_sessions_workspace_archived
  ON public.roadmap_ai_sessions (user_id, workspace_id, archived_at DESC NULLS LAST)
  WHERE is_archived = true AND workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_sessions_workspace
  ON public.roadmap_ai_sessions (workspace_id)
  WHERE workspace_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. RLS on roadmap_ai_sessions + roadmap_ai_messages (restores own-row SELECT)
-- ---------------------------------------------------------------------------
-- Writes stay service-role only (nothing in web/src touches these tables
-- directly), mirroring roadmap_change_history in 20260727090000. SELECT stays
-- granted to authenticated from 20260416120000; the row filter below is what
-- actually gates visibility. Note: roadmap_ai_messages.metadata will carry the
-- agent's refs/run payloads, readable by the owner's JWT under this policy.
ALTER TABLE public.roadmap_ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadmap_ai_messages ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.roadmap_ai_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.roadmap_ai_messages FROM anon, authenticated;

-- Historical names from 20260416120000 (already gone in prod via CASCADE, but
-- dropped by name so a fresh replay of the whole tree is clean too).
DROP POLICY IF EXISTS roadmap_ai_sessions_select ON public.roadmap_ai_sessions;
DROP POLICY IF EXISTS roadmap_ai_sessions_insert ON public.roadmap_ai_sessions;
DROP POLICY IF EXISTS roadmap_ai_sessions_update ON public.roadmap_ai_sessions;
DROP POLICY IF EXISTS roadmap_ai_sessions_delete ON public.roadmap_ai_sessions;
DROP POLICY IF EXISTS roadmap_ai_sessions_service_role ON public.roadmap_ai_sessions;

DROP POLICY IF EXISTS roadmap_ai_messages_select ON public.roadmap_ai_messages;
DROP POLICY IF EXISTS roadmap_ai_messages_insert ON public.roadmap_ai_messages;
DROP POLICY IF EXISTS roadmap_ai_messages_delete ON public.roadmap_ai_messages;
DROP POLICY IF EXISTS roadmap_ai_messages_service_role ON public.roadmap_ai_messages;

-- Owner AND still allowed to see the thread's target. Both helpers are
-- SECURITY DEFINER (no RLS recursion). Argument orders differ on purpose:
-- can_view_roadmap(uid, roadmap) vs is_workspace_member(workspace, uid).
CREATE POLICY roadmap_ai_sessions_select ON public.roadmap_ai_sessions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (roadmap_id IS NULL OR public.can_view_roadmap(auth.uid(), roadmap_id))
    AND (workspace_id IS NULL OR public.is_workspace_member(workspace_id, auth.uid()))
  );

CREATE POLICY roadmap_ai_sessions_service_role ON public.roadmap_ai_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY roadmap_ai_messages_select ON public.roadmap_ai_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_ai_sessions s
      WHERE s.id = roadmap_ai_messages.session_id
        AND s.user_id = auth.uid()
        AND (s.roadmap_id IS NULL OR public.can_view_roadmap(auth.uid(), s.roadmap_id))
        AND (s.workspace_id IS NULL OR public.is_workspace_member(s.workspace_id, auth.uid()))
    )
  );

CREATE POLICY roadmap_ai_messages_service_role ON public.roadmap_ai_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. roadmap_change_history: run / session attribution
-- ---------------------------------------------------------------------------
ALTER TABLE public.roadmap_change_history
  ADD COLUMN IF NOT EXISTS session_id uuid
    REFERENCES public.roadmap_ai_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE INDEX IF NOT EXISTS idx_roadmap_change_history_run_committed
  ON public.roadmap_change_history (run_id, committed_at)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_change_history_session_committed_desc
  ON public.roadmap_change_history (session_id, committed_at DESC)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.roadmap_change_history.session_id IS
  'AI thread that produced this commit. SET NULL on thread deletion so the durable history outlives the private thread. NULL for web/MCP commits.';
COMMENT ON COLUMN public.roadmap_change_history.run_id IS
  'Agent run that produced this commit (one run may commit N roadmaps). Runs live in Redis, so no FK. NULL for web/MCP commits.';

-- ---------------------------------------------------------------------------
-- 4. Read RPCs over pre-authorized roadmap id sets
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, called with the service-role client. Authorization is
-- application-level: callers pass only ids that passed
-- RoadmapAuthorizationService.filterViewableRoadmapIds. EXECUTE is withheld from
-- PUBLIC/anon/authenticated so the functions cannot widen what a JWT can read.
--
-- Nullability facts these bodies rely on (prod catalog): roadmap_tasks.status is
-- nullable (a NULL counts as 'todo' everywhere below), roadmap_epics/features/
-- tasks.updated_at are nullable (NULLS LAST), roadmap_features.roadmap_id is the
-- denormalized NOT NULL column (tasks reach their roadmap through it), and
-- roadmap_tasks.assignee_id is the legacy mirror of the first
-- roadmap_task_assignees row (20260704000000).

CREATE OR REPLACE FUNCTION public.ai_context_roadmap_counts(
  p_roadmap_ids uuid[],
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  roadmap_id uuid,
  epics integer,
  features integer,
  tasks integer,
  open_tasks integer,
  overdue_tasks integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id AS roadmap_id,
    (SELECT count(*)
       FROM public.roadmap_epics e
      WHERE e.roadmap_id = r.id)::integer AS epics,
    (SELECT count(*)
       FROM public.roadmap_features f
      WHERE f.roadmap_id = r.id)::integer AS features,
    (SELECT count(*)
       FROM public.roadmap_tasks t
       JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE f.roadmap_id = r.id)::integer AS tasks,
    (SELECT count(*)
       FROM public.roadmap_tasks t
       JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE f.roadmap_id = r.id
        AND COALESCE(t.status::text, 'todo') <> 'done')::integer AS open_tasks,
    (SELECT count(*)
       FROM public.roadmap_tasks t
       JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE f.roadmap_id = r.id
        AND COALESCE(t.status::text, 'todo') <> 'done'
        AND t.due_date IS NOT NULL
        AND t.due_date < p_now)::integer AS overdue_tasks
  FROM unnest(p_roadmap_ids) AS ids(id)
  JOIN public.roadmaps r ON r.id = ids.id;
$$;

COMMENT ON FUNCTION public.ai_context_roadmap_counts(uuid[], timestamptz) IS
  'Per-roadmap epic/feature/task counts for the AI context overview. open = COALESCE(status, todo) <> done; overdue = open AND due_date < p_now. Callers pass pre-authorized roadmap ids; service_role only.';

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
     ORDER BY rank, e.updated_at DESC NULLS LAST
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
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
     ORDER BY rank, f.updated_at DESC NULLS LAST
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
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
     ORDER BY rank, t.updated_at DESC NULLS LAST
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
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
   ORDER BY u.rank, u.updated_at DESC NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;

COMMENT ON FUNCTION public.ai_context_search_nodes(uuid[], text, text[], integer) IS
  'Cross-roadmap epic/feature/task title search for the AI context surface. rank 0 exact, 1 prefix, 2 substring, 3 description-only; cap 50. Callers pass pre-authorized roadmap ids and a sanitized needle; service_role only.';

CREATE OR REPLACE FUNCTION public.ai_context_list_tasks(
  p_roadmap_ids uuid[],
  p_assignee uuid DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_due_from timestamptz DEFAULT NULL,
  p_due_to timestamptz DEFAULT NULL,
  p_overdue_at timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
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
  assignee_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- Status semantics: a NULL status counts as 'todo', so it matches an 'open'
  -- filter (todo|in_progress|in_review|blocked) but never 'blocked' alone.
  -- Assignee semantics: the roadmap_task_assignees join table OR the legacy
  -- roadmap_tasks.assignee_id mirror (deliberately wider than the in-roadmap
  -- getContextTasksAssignedToMe, which reads only the legacy column).
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
           (SELECT array_agg(a.assignee_id ORDER BY a.assigned_at, a.assignee_id)
              FROM public.roadmap_task_assignees a
             WHERE a.task_id = t.id),
           CASE
             WHEN t.assignee_id IS NULL THEN '{}'::uuid[]
             ELSE ARRAY[t.assignee_id]
           END
         ) AS assignee_ids
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
   ORDER BY (t.due_date IS NULL), t.due_date ASC, t.updated_at DESC NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

COMMENT ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer) IS
  'Cross-roadmap task listing for the AI context surface with feature/epic/roadmap attribution and assignee_ids (join table OR legacy assignee_id). NULL status counts as todo; cap 200. Callers pass pre-authorized roadmap ids; service_role only.';

REVOKE ALL ON FUNCTION public.ai_context_roadmap_counts(uuid[], timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_context_search_nodes(uuid[], text, text[], integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_context_roadmap_counts(uuid[], timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_context_search_nodes(uuid[], text, text[], integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer)
  TO service_role;

COMMIT;
