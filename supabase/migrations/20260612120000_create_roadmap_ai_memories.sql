-- Long-term roadmap AI memory: durable preferences/conventions the agent
-- saves ("remember that we name epics by quarter") and injects into every
-- turn's context. SHARED per roadmap — any collaborator's memories benefit
-- everyone (team conventions attach to the roadmap, not the person).
-- Soft delete via is_active so a later UI can offer undo cheaply.

CREATE TABLE IF NOT EXISTS public.roadmap_ai_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  source text NOT NULL DEFAULT 'user_request'
    CHECK (source IN ('user_request', 'inferred')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_ai_memories_roadmap_active
  ON public.roadmap_ai_memories (roadmap_id, created_at)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS set_roadmap_ai_memories_updated_at
  ON public.roadmap_ai_memories;
CREATE TRIGGER set_roadmap_ai_memories_updated_at
  BEFORE UPDATE ON public.roadmap_ai_memories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.roadmap_ai_memories ENABLE ROW LEVEL SECURITY;

-- Shared per roadmap: unlike roadmap_ai_sessions there is no per-user clause
-- on reads/updates — every collaborator sees and may manage the same notes.
-- Access predicate mirrors roadmaps_select (owner OR effective share role);
-- can_access_roadmap() was dropped in 20260504000020.
DROP POLICY IF EXISTS roadmap_ai_memories_select ON public.roadmap_ai_memories;
CREATE POLICY roadmap_ai_memories_select ON public.roadmap_ai_memories
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.roadmaps r
      WHERE r.id = roadmap_ai_memories.roadmap_id
        AND (
          r.owner_id = auth.uid()
          OR public.get_user_roadmap_effective_role(auth.uid(), r.id) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS roadmap_ai_memories_insert ON public.roadmap_ai_memories;
CREATE POLICY roadmap_ai_memories_insert ON public.roadmap_ai_memories
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.roadmaps r
      WHERE r.id = roadmap_ai_memories.roadmap_id
        AND (
          r.owner_id = auth.uid()
          OR public.get_user_roadmap_effective_role(auth.uid(), r.id) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS roadmap_ai_memories_update ON public.roadmap_ai_memories;
CREATE POLICY roadmap_ai_memories_update ON public.roadmap_ai_memories
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.roadmaps r
      WHERE r.id = roadmap_ai_memories.roadmap_id
        AND (
          r.owner_id = auth.uid()
          OR public.get_user_roadmap_effective_role(auth.uid(), r.id) IS NOT NULL
        )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roadmaps r
      WHERE r.id = roadmap_ai_memories.roadmap_id
        AND (
          r.owner_id = auth.uid()
          OR public.get_user_roadmap_effective_role(auth.uid(), r.id) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS roadmap_ai_memories_delete ON public.roadmap_ai_memories;
CREATE POLICY roadmap_ai_memories_delete ON public.roadmap_ai_memories
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.roadmaps r
      WHERE r.id = roadmap_ai_memories.roadmap_id
        AND (
          r.owner_id = auth.uid()
          OR public.get_user_roadmap_effective_role(auth.uid(), r.id) IS NOT NULL
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roadmap_ai_memories TO authenticated;
