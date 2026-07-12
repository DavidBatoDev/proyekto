-- Hybrid retrieval over ai_knowledge_chunks: HNSW cosine top-k + websearch
-- tsquery top-k, merged with reciprocal-rank fusion (k=60). SECURITY INVOKER;
-- the backend calls it with the service-role client and enforces authz in the
-- service layer — chat visibility arrives as p_room_ids (the caller's rooms),
-- mirroring the chat_search_room_messages pattern.
--
-- Scale note: the per-project filter means Postgres may post-filter the HNSW
-- scan; fine at current scale. If a project grows past ~100k chunks, revisit
-- with pgvector's iterative scan options.

CREATE OR REPLACE FUNCTION public.search_knowledge_chunks(
  p_project uuid,
  p_embedding extensions.vector(1536),  -- NULL => text-only lane
  p_query text,
  p_room_ids uuid[] DEFAULT '{}'::uuid[],
  p_source_types text[] DEFAULT NULL,
  p_limit int DEFAULT 12
) RETURNS TABLE (
  id uuid,
  source_type text,
  source_id uuid,
  roadmap_id uuid,
  room_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  created_at timestamptz,
  score real
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH filtered AS (
    SELECT c.id, c.embedding, c.content_tsv
    FROM public.ai_knowledge_chunks c
    WHERE c.project_id = p_project
      AND (p_source_types IS NULL OR c.source_type = ANY (p_source_types))
      -- Chat ACL: chat chunks only from rooms the caller participates in.
      AND (c.source_type <> 'chat_message' OR c.room_id = ANY (p_room_ids))
  ),
  vec AS (
    SELECT id, row_number() OVER (ORDER BY embedding <=> p_embedding) AS rnk
    FROM filtered
    WHERE p_embedding IS NOT NULL AND embedding IS NOT NULL
    ORDER BY embedding <=> p_embedding
    LIMIT 30
  ),
  txt AS (
    SELECT f.id,
           row_number() OVER (
             ORDER BY ts_rank(f.content_tsv, websearch_to_tsquery('simple', p_query)) DESC
           ) AS rnk
    FROM filtered f
    WHERE COALESCE(btrim(p_query), '') <> ''
      AND f.content_tsv @@ websearch_to_tsquery('simple', p_query)
    ORDER BY ts_rank(f.content_tsv, websearch_to_tsquery('simple', p_query)) DESC
    LIMIT 30
  ),
  fused AS (
    SELECT COALESCE(v.id, t.id) AS id,
           (COALESCE(1.0 / (60 + v.rnk), 0) + COALESCE(1.0 / (60 + t.rnk), 0))::real AS score
    FROM vec v FULL OUTER JOIN txt t USING (id)
  )
  SELECT c.id, c.source_type, c.source_id, c.roadmap_id, c.room_id,
         c.chunk_index, c.content, c.metadata, c.created_at, f.score
  FROM fused f
  JOIN public.ai_knowledge_chunks c ON c.id = f.id
  ORDER BY f.score DESC, c.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 30)
$$;
