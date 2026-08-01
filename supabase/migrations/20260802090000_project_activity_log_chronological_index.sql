-- Chronological ordering for the project activity feed.
--
-- SUPERSEDES THE ORDERING RATIONALE in
-- 20260801120000_project_activity_log_roadmap_scope.sql, which argued that
-- created_at could not serve as a cursor because "now() is transaction-stable,
-- so every row of a batched multi-row INSERT shares one created_at".
--
-- Two things changed since:
--
--   1. AuditService now stamps created_at in Node at log() time
--      (BufferedActivityEntry.occurredAt), not at INSERT. created_at is
--      therefore per-event TRUE EVENT TIME, and no two rows share one.
--
--   2. The flush is bounded by ACTIVITY_FLUSH_TIMEOUT_MS so a slow INSERT can
--      never hold a response open -- which means an INSERT can land AFTER a
--      later request's. `seq` records when the DATABASE HEARD ABOUT an event,
--      not when it happened. Ordering a dispute-resolution log by seq renders
--      a task's creation after its own update; that was observed live
--      (task.updated seq 67 before task.created seq 68) and is exactly what
--      stamping occurredAt was written to prevent.
--
-- So the feed orders by (created_at DESC, seq DESC) and pages with a keyset on
-- the same pair. seq stays IN the key, not as the key: occurredAt is
-- millisecond resolution (Date#toISOString) and several events in one request
-- routinely share a millisecond. seq is UNIQUE and neither column is ever
-- UPDATEd, so the pair is a strict total order -- keyset paging can neither
-- skip nor duplicate a row.
--
-- CONCURRENTLY is deliberately omitted: it cannot run inside the transaction a
-- migration executes in, and this table holds ~79 rows.

CREATE INDEX IF NOT EXISTS idx_project_activity_log_project_occurred_desc
  ON public.project_activity_log (project_id, created_at DESC, seq DESC);

CREATE INDEX IF NOT EXISTS idx_project_activity_log_roadmap_occurred_desc
  ON public.project_activity_log (roadmap_id, created_at DESC, seq DESC)
  WHERE roadmap_id IS NOT NULL;

-- Strictly redundant: a leading prefix of the index above, same direction, so
-- every plan that could use it can use the replacement unchanged.
DROP INDEX IF EXISTS public.idx_project_activity_log_project_created_desc;

-- Superseded: the per-roadmap drill-in now orders by the same (created_at, seq)
-- pair as the project feed.
DROP INDEX IF EXISTS public.idx_project_activity_log_roadmap_seq_desc;

-- idx_project_activity_log_project_seq_desc is KEPT ON PURPOSE. It is the only
-- index that can answer "in what order did the database actually receive these
-- rows", which is the question asked when investigating a suspected flush
-- inversion -- the operational counterpart to this migration. It is not a
-- prefix of anything above, so it cannot be reconstructed from them.

COMMENT ON INDEX public.idx_project_activity_log_project_occurred_desc IS
  'Feed order + keyset positioning for GET /projects/:id/activity. A row-value cursor over consecutive all-DESC columns following a leading equality resolves to an Index Cond with no Sort node.';
