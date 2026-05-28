-- Wave 2 foundation:
-- - roadmap workflow columns (hybrid with task.status compatibility)
-- - team-time limits/overtime controls
-- - dedicated invoices domain
-- - team retroactive policy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS public.roadmap_workflow_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text,
  bucket_status public.task_status NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_workflow_columns_roadmap
  ON public.roadmap_workflow_columns(roadmap_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadmap_workflow_system_bucket
  ON public.roadmap_workflow_columns(roadmap_id, bucket_status)
  WHERE is_system = true;

ALTER TABLE public.roadmap_tasks
  ADD COLUMN IF NOT EXISTS workflow_column_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roadmap_tasks_workflow_column_id_fkey'
  ) THEN
    ALTER TABLE public.roadmap_tasks
      ADD CONSTRAINT roadmap_tasks_workflow_column_id_fkey
      FOREIGN KEY (workflow_column_id)
      REFERENCES public.roadmap_workflow_columns(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_workflow_column_id
  ON public.roadmap_tasks(workflow_column_id);

WITH roadmap_ids AS (
  SELECT id AS roadmap_id
  FROM public.roadmaps
),
seed_columns AS (
  SELECT *
  FROM (VALUES
    (0, 'To do', 'todo'::public.task_status, '#94a3b8'),
    (1, 'In progress', 'in_progress'::public.task_status, '#3b82f6'),
    (2, 'In review', 'in_review'::public.task_status, '#f59e0b'),
    (3, 'Done', 'done'::public.task_status, '#10b981'),
    (4, 'Blocked', 'blocked'::public.task_status, '#ef4444')
  ) AS s(position, name, bucket_status, color)
)
INSERT INTO public.roadmap_workflow_columns (
  roadmap_id,
  name,
  position,
  color,
  bucket_status,
  is_system
)
SELECT
  r.roadmap_id,
  s.name,
  s.position,
  s.color,
  s.bucket_status,
  true
FROM roadmap_ids r
CROSS JOIN seed_columns s
ON CONFLICT DO NOTHING;

WITH task_roadmap AS (
  SELECT
    t.id AS task_id,
    t.status,
    e.roadmap_id
  FROM public.roadmap_tasks t
  JOIN public.roadmap_features f
    ON f.id = t.feature_id
  JOIN public.roadmap_epics e
    ON e.id = f.epic_id
),
task_target_column AS (
  SELECT
    tr.task_id,
    (
      SELECT c.id
      FROM public.roadmap_workflow_columns c
      WHERE c.roadmap_id = tr.roadmap_id
        AND c.bucket_status = tr.status
      ORDER BY c.is_system DESC, c.position ASC, c.created_at ASC
      LIMIT 1
    ) AS workflow_column_id
  FROM task_roadmap tr
)
UPDATE public.roadmap_tasks t
SET workflow_column_id = target.workflow_column_id
FROM task_target_column target
WHERE t.id = target.task_id
  AND target.workflow_column_id IS NOT NULL
  AND t.workflow_column_id IS NULL;

ALTER TABLE public.team_member_rates
  ADD COLUMN IF NOT EXISTS weekly_limit_hours numeric,
  ADD COLUMN IF NOT EXISTS monthly_limit_hours numeric,
  ADD COLUMN IF NOT EXISTS overtime_requires_approval boolean NOT NULL DEFAULT false;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS retroactive_log_days integer;

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  issuer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  recipient_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'USD',
  issue_date date,
  due_date date,
  notes text,
  attach_hours boolean NOT NULL DEFAULT false,
  subtotal numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  issued_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  pdf_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'void')),
  CONSTRAINT invoices_number_unique_per_project
    UNIQUE (project_id, number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_project_id
  ON public.invoices(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_issuer_user_id
  ON public.invoices(issuer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'manual',
  source_log_id uuid REFERENCES public.task_time_logs(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_line_items_source_type_check
    CHECK (source_type IN ('manual', 'time_log'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id
  ON public.invoice_line_items(invoice_id, position);

CREATE TABLE IF NOT EXISTS public.invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'pdf',
  storage_path text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_documents_kind_check
    CHECK (kind IN ('pdf'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice_id
  ON public.invoice_documents(invoice_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_roadmap_workflow_columns_updated_at ON public.roadmap_workflow_columns;
CREATE TRIGGER trg_roadmap_workflow_columns_updated_at
BEFORE UPDATE ON public.roadmap_workflow_columns
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

DROP TRIGGER IF EXISTS trg_invoice_line_items_updated_at ON public.invoice_line_items;
CREATE TRIGGER trg_invoice_line_items_updated_at
BEFORE UPDATE ON public.invoice_line_items
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('invoice_issued', 'specific', 'medium'),
  ('invoice_paid', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;

