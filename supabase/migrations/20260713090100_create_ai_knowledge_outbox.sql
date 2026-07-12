-- Ingest work queue for the knowledge pipeline. Writers: backend
-- fire-and-forget hooks (chat/comments/audit/memories), the backfill script,
-- and the project_briefs trigger below (briefs are written by the web via
-- RLS — there is no backend write path to hook).

CREATE TABLE IF NOT EXISTS public.ai_knowledge_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN
    ('chat_message', 'task_comment', 'activity_log', 'brief', 'memory', 'file_chunk')),
  source_id uuid NOT NULL,
  -- Advisory only; the ingest worker re-derives project linkage from the
  -- source row so a stale value can never mis-scope a chunk.
  project_id uuid,
  op text NOT NULL CHECK (op IN ('upsert', 'delete')),
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_outbox_unprocessed
  ON public.ai_knowledge_outbox (enqueued_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.ai_knowledge_outbox ENABLE ROW LEVEL SECURITY; -- no policies: service-role only

-- Atomic batch claim. attempts is stamped at claim time so a worker crash
-- mid-batch still burns an attempt; rows at >= p_max_attempts are
-- dead-lettered (stay unprocessed, excluded from claims, visible via SQL).
CREATE OR REPLACE FUNCTION public.claim_knowledge_outbox(
  p_batch int DEFAULT 25,
  p_max_attempts int DEFAULT 5
) RETURNS SETOF public.ai_knowledge_outbox
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.ai_knowledge_outbox o
  SET attempts = o.attempts + 1
  WHERE o.id IN (
    SELECT id FROM public.ai_knowledge_outbox
    WHERE processed_at IS NULL AND attempts < p_max_attempts
    ORDER BY enqueued_at
    LIMIT LEAST(GREATEST(p_batch, 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;

-- Brief freshness: the web writes project_briefs directly via RLS, so
-- enqueue via trigger. Harmless while the poller is dark — briefs change
-- rarely and the rows just accumulate until ingest is enabled.
CREATE OR REPLACE FUNCTION public.enqueue_brief_knowledge()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_knowledge_outbox (source_type, source_id, project_id, op)
  VALUES ('brief', NEW.id, NEW.project_id, 'upsert');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_briefs_knowledge ON public.project_briefs;
CREATE TRIGGER trg_project_briefs_knowledge
  AFTER INSERT OR UPDATE OF project_summary, custom_fields ON public.project_briefs
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_brief_knowledge();
