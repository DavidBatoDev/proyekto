-- Contract phase: all consumers now use roadmap_public_templates.
DROP INDEX IF EXISTS public.idx_roadmaps_templates_public;
ALTER TABLE public.roadmaps
  DROP COLUMN IF EXISTS is_public,
  DROP COLUMN IF EXISTS is_templatable;
