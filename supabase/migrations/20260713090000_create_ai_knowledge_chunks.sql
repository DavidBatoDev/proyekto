-- RAG chunk store for the roadmap AI knowledge pipeline. Service-role only:
-- RLS is enabled with NO policies — reads are authorized in the backend
-- service layer (per-caller chat-room ACL), writes come from the ingest
-- worker. The web never queries this table.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.ai_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN
    ('chat_message', 'task_comment', 'activity_log', 'brief', 'memory', 'file_chunk')),
  source_id uuid NOT NULL,
  -- Chat ACL scope; only set for chat_message rows. Retrieval filters chat
  -- chunks to the caller's chat_room_participants rooms.
  room_id uuid,
  chunk_index int NOT NULL DEFAULT 0,
  content text NOT NULL CHECK (char_length(btrim(content)) > 0),
  -- 'simple' config: content is mixed English/Tagalog; a stemming-free
  -- configuration avoids wrong-language stems.
  content_tsv tsvector GENERATED ALWAYS AS
    (to_tsvector('simple', left(content, 20000))) STORED,
  -- text-embedding-3-small; nullable so text-only rows stay searchable when
  -- embeddings are unavailable.
  embedding extensions.vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_knowledge_chunks_source UNIQUE (source_type, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_embedding_hnsw
  ON public.ai_knowledge_chunks USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_tsv
  ON public.ai_knowledge_chunks USING gin (content_tsv);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_project_source
  ON public.ai_knowledge_chunks (project_id, source_type);

-- Intentionally NO policies: anon/authenticated get nothing; the service-role
-- backend bypasses RLS. Expect the "RLS enabled, no policy" advisor INFO.
ALTER TABLE public.ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;
