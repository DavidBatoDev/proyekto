-- Speed up bounded description search passes for roadmap AI context lookup.
-- Runtime uses ILIKE '%query%' on description for epics/features.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_roadmap_epics_description_trgm
  ON public.roadmap_epics
  USING gin (description extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_roadmap_features_description_trgm
  ON public.roadmap_features
  USING gin (description extensions.gin_trgm_ops);
