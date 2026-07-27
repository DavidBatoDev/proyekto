-- Durable roadmap change history.
--
-- Until now a committed roadmap change existed ONLY in Redis, under
-- `roadmap:ai:timeline:{roadmapId}:{userId}` — a sliding 30-day TTL, a 250-entry
-- cap, and best-effort writes that swallow their own errors. Three consequences:
-- the key is per-USER so nobody can answer "who changed this roadmap"; an idle
-- roadmap loses its whole history; and a commit can succeed with no history at
-- all. Meanwhile project_activity_log keeps only an operations_hash, never the
-- operations, so the durable trail can't reconstruct what a change actually did.
--
-- This table is the durable half: per-commit metadata + the operations + the
-- semantic diff, scoped per ROADMAP so the whole team sees it. It deliberately
-- does NOT store the two full roadmap snapshots the Redis entry carries — those
-- are ~320KB per commit and replaying a month-old snapshot would blind-clobber
-- everyone's later work. Revert therefore stays Redis-bounded (your own changes,
-- last 30 days) and the MCP tool description says so explicitly.
--
-- No backfill is possible: Redis timelines are per-user and ephemeral, and the
-- operations payload was never persisted anywhere. This table starts empty and
-- fills forward.

CREATE TABLE IF NOT EXISTS public.roadmap_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The RoadmapAiService change id. UNIQUE doubles as the revert lookup index.
  change_id uuid NOT NULL UNIQUE,
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  -- NULL for a personal roadmap. Those write no audit row today (both
  -- AuditService call sites are wrapped in `if (current.project_id)`), so this
  -- is the only durable record they get.
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'discarded')),
  operations jsonb NOT NULL DEFAULT '[]'::jsonb,
  operations_count integer NOT NULL DEFAULT 0 CHECK (operations_count >= 0),
  operations_hash text,
  semantic_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  semantic_change_count integer NOT NULL DEFAULT 0
    CHECK (semantic_change_count >= 0),
  temp_id_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision_token_before text,
  revision_token_after text,
  committed_at timestamptz NOT NULL DEFAULT now(),
  discarded_at timestamptz,
  discarded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_change_history_roadmap_committed_desc
  ON public.roadmap_change_history (roadmap_id, committed_at DESC);

CREATE INDEX IF NOT EXISTS idx_roadmap_change_history_project_committed_desc
  ON public.roadmap_change_history (project_id, committed_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_change_history_actor_committed_desc
  ON public.roadmap_change_history (actor_id, committed_at DESC);

ALTER TABLE public.roadmap_change_history ENABLE ROW LEVEL SECURITY;

-- Mirrors project_activity_log: a member-read SELECT policy as defense in depth,
-- and NO insert/update/delete policy — only the service-role backend writes.
--
-- The predicate is can_view_roadmap (SECURITY DEFINER, defined in
-- 20260504000030_restore_roadmap_children_rls.sql and already the canonical
-- helper for every roadmap-child SELECT policy — see roadmap_epics_select and
-- 20260720120000_scope_assignee_select_rls.sql). It is the right choice over
-- project_chat_is_member because project_id is nullable here: can_view_roadmap
-- covers BOTH the project-member case and the personal-roadmap owner via the
-- share_role ladder. Referenced only, never redefined.
--
-- NOTE: the older can_access_roadmap helper that the roadmap_ai_sessions
-- migration references no longer exists in the Singapore database — it was
-- superseded by the can_view_roadmap / can_edit_roadmap pair. Do not reintroduce it.
DROP POLICY IF EXISTS roadmap_change_history_select
  ON public.roadmap_change_history;

CREATE POLICY roadmap_change_history_select
  ON public.roadmap_change_history
  FOR SELECT
  TO authenticated
  USING (public.can_view_roadmap(auth.uid(), roadmap_id));

DROP POLICY IF EXISTS roadmap_change_history_service_role
  ON public.roadmap_change_history;

CREATE POLICY roadmap_change_history_service_role
  ON public.roadmap_change_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.roadmap_change_history TO authenticated;

COMMENT ON TABLE public.roadmap_change_history IS
  'Durable per-commit roadmap change log (operations + semantic diff, no full snapshots). Complements the ephemeral per-user Redis timeline that powers revert.';
COMMENT ON COLUMN public.roadmap_change_history.project_id IS
  'NULL for personal roadmaps, which have no project to audit against.';
COMMENT ON COLUMN public.roadmap_change_history.status IS
  'applied | discarded. Flipped by RoadmapAiService.discard (undo) and .rollback (redo).';
