-- Improve resolve_node_reference task lookups after roadmap-scoped task search refactor.
-- Supports joining tasks -> features while filtering by feature roadmap_id.

CREATE INDEX IF NOT EXISTS idx_roadmap_features_roadmap_id_id
  ON public.roadmap_features (roadmap_id, id);
