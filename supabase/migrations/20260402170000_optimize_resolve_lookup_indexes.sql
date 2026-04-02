-- Fast label lookup support for roadmap AI resolve_node_reference
-- DB-first optimization: normalized title lookups + trigram fallback indexes.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_roadmap_epics_title_trgm
  ON public.roadmap_epics
  USING gin (title extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_roadmap_features_title_trgm
  ON public.roadmap_features
  USING gin (title extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_title_trgm
  ON public.roadmap_tasks
  USING gin (title extensions.gin_trgm_ops);
