-- Roadmap-scoped, keyset-paginable, sensitivity-aware project activity log.
--
-- Phase 1 of the activity-log work. Purely additive and dark: nothing writes
-- the new columns until the Phase 2 recorder lands behind
-- ROADMAP_ACTIVITY_LOG_ENABLED, and nothing reads them until the Phase 3
-- read API. Existing rows and the existing endpoint keep working unchanged.
--
-- Three gaps this closes:
--
--   1. No roadmap_id. The Logs page must be able to answer "activity on THIS
--      roadmap", and today every roadmap event is only locatable by digging
--      through metadata.
--
--   2. OFFSET pagination. AuditService.list pages with .range(), which
--      degrades linearly with depth and silently skips or repeats rows when
--      new entries land mid-scroll — the normal case for a live feed.
--
--   3. logs.view_sensitive has existed in the permission catalog since it
--      landed (project-permissions.ts:145) but nothing has ever filtered on
--      it, because there was no column to filter by.
--
-- WHY A SEQUENCE AND NOT created_at FOR THE CURSOR: now() is transaction-
-- stable, so every row of a batched multi-row INSERT shares one created_at.
-- The Phase 2 recorder flushes a whole request's events as ONE insert, so a
-- `created_at < :cursor` keyset would skip or duplicate rows at every batch
-- boundary (a bulk reorder, an AI commit). A monotonic bigint is the only
-- correct cursor here.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
-- ADD COLUMN with no default (roadmap_id, seq) and with a CONSTANT default
-- (is_sensitive) are both metadata-only in PG11+ — no table rewrite. Attaching
-- bigserial directly WOULD rewrite under ACCESS EXCLUSIVE, so the sequence is
-- created and attached separately below.
--
-- roadmap_id is ON DELETE SET NULL, deliberately: deleting a roadmap must not
-- erase the record that it was deleted. project_id keeps its existing
-- ON DELETE CASCADE — deleting the project is a legitimate end of the trail.
ALTER TABLE public.project_activity_log
  ADD COLUMN IF NOT EXISTS roadmap_id   uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_sensitive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seq          bigint;

-- ── 2. Cursor sequence + ordered backfill ───────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.project_activity_log_seq_seq
  OWNED BY public.project_activity_log.seq;

-- Backfill in chronological order so seq ordering matches created_at ordering
-- for pre-existing rows. A bare `SET seq = nextval(...)` would assign in
-- arbitrary heap order, which would make the very first page of history read
-- out of sequence. (56 rows at time of writing — no batching needed.)
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.project_activity_log
  WHERE seq IS NULL
)
UPDATE public.project_activity_log AS l
   SET seq = ordered.rn
  FROM ordered
 WHERE l.id = ordered.id;

-- Park the sequence past the backfilled values.
SELECT setval(
  'public.project_activity_log_seq_seq',
  GREATEST((SELECT COALESCE(max(seq), 0) FROM public.project_activity_log), 1),
  true
);

ALTER TABLE public.project_activity_log
  ALTER COLUMN seq SET DEFAULT nextval('public.project_activity_log_seq_seq'),
  ALTER COLUMN seq SET NOT NULL;

-- ── 3. Read indexes ─────────────────────────────────────────────────────────
-- Deliberately only two, plus the uniqueness invariant.
--
-- The Phase 3 read API also filters by actor and entity_type, but those are
-- ALWAYS combined with project_id, and (project_id, seq DESC) already narrows
-- to a few thousand rows per project before filtering. Adding speculative
-- composite indexes for filters that do not exist yet is write amplification
-- with no measured benefit — revisit with EXPLAIN once the filters ship.
--
-- idx_project_activity_log_project_created_desc is KEPT: the date-range
-- filter still ranges on created_at.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_activity_log_seq
  ON public.project_activity_log (seq);

CREATE INDEX IF NOT EXISTS idx_project_activity_log_project_seq_desc
  ON public.project_activity_log (project_id, seq DESC);

CREATE INDEX IF NOT EXISTS idx_project_activity_log_roadmap_seq_desc
  ON public.project_activity_log (roadmap_id, seq DESC)
  WHERE roadmap_id IS NOT NULL;

-- ── 4. Sensitivity, defence-in-depth ────────────────────────────────────────
-- The backend reads this table with the service-role client (RLS-bypassing)
-- and gates on logs.view / logs.view_sensitive in code, because a resolved
-- capability (role baseline + origin delta + per-row overrides) is not
-- expressible as an RLS predicate.
--
-- This tightened policy therefore only affects a DIRECT client-side Supabase
-- read, of which there are currently zero (no web caller touches this table).
-- It fails closed: a client reading directly sees non-sensitive rows only.
-- Preserves the existing role grant (public) and command (SELECT).
DROP POLICY IF EXISTS "Project members can read activity log"
  ON public.project_activity_log;

CREATE POLICY "Project members can read activity log"
ON public.project_activity_log
FOR SELECT
USING (
  is_sensitive = false
  AND public.project_chat_is_member(project_id, auth.uid())
);

-- ── 5. Documentation ────────────────────────────────────────────────────────
COMMENT ON COLUMN public.project_activity_log.roadmap_id IS
  'Owning roadmap for roadmap-domain events; NULL for chat/access/member events. ON DELETE SET NULL so the audit row outlives the roadmap it describes.';

COMMENT ON COLUMN public.project_activity_log.seq IS
  'Monotonic keyset cursor. Required because the request-batched recorder writes many rows in one INSERT, and now() is transaction-stable, so created_at cannot disambiguate them.';

COMMENT ON COLUMN public.project_activity_log.is_sensitive IS
  'Derived at write time from SENSITIVE_ACTIONS (access grants, share links, member role changes). Hidden from readers lacking logs.view_sensitive.';
