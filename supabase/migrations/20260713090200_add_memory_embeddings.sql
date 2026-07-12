-- Semantic memory retrieval. Memories are <=500 chars, so the embedding
-- lives on the row itself; roadmap_ai_memories rows are never written to
-- ai_knowledge_chunks ('memory' in that table's CHECK is reserved).
-- Depends on 20260713080000_ai_memories_scope_and_category.sql (scope,
-- project_id) and the vector extension from 20260713090000.

ALTER TABLE public.roadmap_ai_memories
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

-- No vector index: <=50 active rows per scope bucket, always pre-filtered —
-- a sequential scan wins at this cardinality.

CREATE OR REPLACE FUNCTION public.match_relevant_memories(
  p_roadmap uuid,
  p_project uuid,
  p_embedding extensions.vector(1536),
  p_limit int DEFAULT 8
) RETURNS TABLE (
  id uuid,
  roadmap_id uuid,
  project_id uuid,
  scope text,
  category text,
  content text,
  source text,
  created_by uuid,
  created_at timestamptz,
  similarity real
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  -- Visibility mirrors the memories list() OR-query: this roadmap's rows OR
  -- project-scope rows of its project.
  SELECT m.id, m.roadmap_id, m.project_id, m.scope, m.category, m.content,
         m.source, m.created_by, m.created_at,
         (1 - (m.embedding <=> p_embedding))::real AS similarity
  FROM public.roadmap_ai_memories m
  WHERE m.is_active = true
    AND m.embedding IS NOT NULL
    AND (
      m.roadmap_id = p_roadmap
      OR (m.scope = 'project' AND p_project IS NOT NULL AND m.project_id = p_project)
    )
  ORDER BY m.embedding <=> p_embedding
  LIMIT LEAST(GREATEST(p_limit, 1), 20)
$$;
