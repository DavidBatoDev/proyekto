-- Multi-project knowledge retrieval for the workspace-scope AI assistant.
--
-- search_knowledge_chunks(p_project uuid, ...) (20260713090300, its only
-- definition) is single-project. The dashboard assistant searches across every
-- project the caller can access, and running N single-project calls would
-- fuse ranks client-side; this sibling runs the same hybrid HNSW + websearch
-- retrieval with reciprocal-rank fusion ONCE over the union.
--
-- It is a separately named function, NOT an overload: PostgREST resolves
-- same-named overloads by argument names and a mismatch surfaces as PGRST203,
-- so a distinct name keeps both call sites unambiguous. The single-project
-- function is untouched. The body is the 20260713090300 body verbatim with two
-- changes only: the predicate becomes `c.project_id = ANY (p_project_ids)` and
-- `project_id` is added to RETURNS TABLE so each hit carries its attribution.
-- Same SECURITY INVOKER posture: the backend calls it with the service-role
-- client and enforces authz in the service layer (p_project_ids is the
-- caller's accessible subset, p_room_ids the caller's chat rooms).

BEGIN;

CREATE OR REPLACE FUNCTION public.search_knowledge_chunks_projects(
  p_project_ids uuid[],
  p_embedding extensions.vector(1536),  -- NULL => text-only lane
  p_query text,
  p_room_ids uuid[] DEFAULT '{}'::uuid[],
  p_source_types text[] DEFAULT NULL,
  p_limit int DEFAULT 12
) RETURNS TABLE (
  id uuid,
  project_id uuid,
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
    WHERE c.project_id = ANY (p_project_ids)
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
  SELECT c.id, c.project_id, c.source_type, c.source_id, c.roadmap_id, c.room_id,
         c.chunk_index, c.content, c.metadata, c.created_at, f.score
  FROM fused f
  JOIN public.ai_knowledge_chunks c ON c.id = f.id
  ORDER BY f.score DESC, c.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 30)
$$;

COMMENT ON FUNCTION public.search_knowledge_chunks_projects(uuid[], extensions.vector, text, uuid[], text[], int) IS
  'Multi-project twin of search_knowledge_chunks: hybrid HNSW + websearch retrieval with reciprocal-rank fusion over ai_knowledge_chunks for a set of project ids. Callers pass the accessible project subset and their chat rooms; authz is application-level.';

COMMIT;
