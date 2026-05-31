-- Remove workflow columns feature.
-- Tasks use task.status (5 fixed buckets) directly; the custom column layer is dropped.

ALTER TABLE public.roadmap_tasks
  DROP CONSTRAINT IF EXISTS roadmap_tasks_workflow_column_id_fkey;

DROP INDEX IF EXISTS idx_roadmap_tasks_workflow_column_id;

ALTER TABLE public.roadmap_tasks
  DROP COLUMN IF EXISTS workflow_column_id;

DROP TRIGGER IF EXISTS trg_roadmap_workflow_columns_updated_at
  ON public.roadmap_workflow_columns;

DROP INDEX IF EXISTS uq_roadmap_workflow_system_bucket;
DROP INDEX IF EXISTS idx_roadmap_workflow_columns_roadmap;

DROP TABLE IF EXISTS public.roadmap_workflow_columns;
