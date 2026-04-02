-- Align resolve lookup indexes with runtime query strategy:
-- title exact/prefix + trigram contains.

DROP INDEX IF EXISTS public.idx_roadmap_epics_roadmap_norm_title;
DROP INDEX IF EXISTS public.idx_roadmap_features_roadmap_norm_title;
DROP INDEX IF EXISTS public.idx_roadmap_tasks_feature_norm_title;

CREATE INDEX IF NOT EXISTS idx_roadmap_epics_roadmap_title_btree
  ON public.roadmap_epics (roadmap_id, title);

CREATE INDEX IF NOT EXISTS idx_roadmap_epics_roadmap_title_prefix
  ON public.roadmap_epics (roadmap_id, title text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_roadmap_features_roadmap_title_btree
  ON public.roadmap_features (roadmap_id, title);

CREATE INDEX IF NOT EXISTS idx_roadmap_features_roadmap_title_prefix
  ON public.roadmap_features (roadmap_id, title text_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_feature_title_btree
  ON public.roadmap_tasks (feature_id, title);

CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_feature_title_prefix
  ON public.roadmap_tasks (feature_id, title text_pattern_ops);
