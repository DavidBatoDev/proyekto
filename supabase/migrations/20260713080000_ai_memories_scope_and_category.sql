-- Phase 2 of the roadmap AI knowledge upgrade: memory scope + categories.
-- scope='project' memories are shared across every roadmap of the project
-- (durable conventions travel with the project, not a single roadmap);
-- category lets the agent group/prioritize notes when injecting them.
-- Existing rows keep their exact prior semantics via the column defaults.

ALTER TABLE public.roadmap_ai_memories
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'roadmap'
    CHECK (scope IN ('roadmap', 'project')),
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'preference'
    CHECK (category IN ('preference', 'fact', 'decision'));

-- Backfill project linkage so project-scope queries never need the roadmaps
-- join at read time. roadmap_id stays NOT NULL: it records where the memory
-- was saved even for project-scope rows.
UPDATE public.roadmap_ai_memories m
SET project_id = r.project_id
FROM public.roadmaps r
WHERE r.id = m.roadmap_id AND m.project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_memories_project_active
  ON public.roadmap_ai_memories (project_id, created_at)
  WHERE is_active = true AND scope = 'project';

-- Project-scope rows must be readable from OTHER roadmaps of the same
-- project, where the roadmap-based select policy does not match. Backend
-- reads use the service role (bypass RLS); this policy is for web/RLS
-- readers only. Access predicate mirrors project membership.
DROP POLICY IF EXISTS roadmap_ai_memories_select_project_scope
  ON public.roadmap_ai_memories;
CREATE POLICY roadmap_ai_memories_select_project_scope
  ON public.roadmap_ai_memories
  FOR SELECT USING (
    scope = 'project'
    AND project_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = roadmap_ai_memories.project_id
        AND pa.user_id = auth.uid()
    )
  );
