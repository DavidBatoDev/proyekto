-- Preserve durable financial and work-history records when their project,
-- task, or member profile is deleted.
--
-- finance_project_settings and finance_member_allocations deliberately retain
-- ON DELETE CASCADE: they are forward-looking project configuration, not
-- ledger facts. Durable invoice facts are snapshotted when an invoice is
-- composed, so keeping detached configuration would create unusable orphans.

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS project_title_snapshot text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS project_title_snapshot text;

ALTER TABLE public.task_time_logs
  ADD COLUMN IF NOT EXISTS member_display_name_snapshot text;

UPDATE public.contracts c
SET project_title_snapshot = p.title
FROM public.projects p
WHERE p.id = c.project_id
  AND c.project_title_snapshot IS NULL;

UPDATE public.invoices i
SET project_title_snapshot = p.title
FROM public.projects p
WHERE p.id = i.project_id
  AND i.project_title_snapshot IS NULL;

UPDATE public.task_time_logs ttl
SET member_display_name_snapshot = COALESCE(
  NULLIF(trim(p.display_name), ''),
  NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
  NULLIF(trim(p.email), '')
)
FROM public.profiles p
WHERE p.id = ttl.member_user_id
  AND ttl.member_display_name_snapshot IS NULL;

ALTER TABLE public.contracts
  ALTER COLUMN project_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS contracts_project_id_fkey,
  ADD CONSTRAINT contracts_project_id_fkey
    FOREIGN KEY (project_id)
    REFERENCES public.projects(id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT contracts_project_id_fkey ON public.contracts IS
  'Preserves signed and terminal contract history when its project is deleted by setting project_id to NULL.';

ALTER TABLE public.invoices
  ALTER COLUMN project_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS invoices_project_id_fkey,
  ADD CONSTRAINT invoices_project_id_fkey
    FOREIGN KEY (project_id)
    REFERENCES public.projects(id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT invoices_project_id_fkey ON public.invoices IS
  'Preserves issued and terminal invoice history when its project is deleted by setting project_id to NULL.';

ALTER TABLE public.task_time_logs
  ALTER COLUMN project_id DROP NOT NULL,
  ALTER COLUMN member_user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS task_time_logs_project_id_fkey,
  DROP CONSTRAINT IF EXISTS task_time_logs_task_id_fkey,
  DROP CONSTRAINT IF EXISTS task_time_logs_member_user_id_fkey,
  ADD CONSTRAINT task_time_logs_project_id_fkey
    FOREIGN KEY (project_id)
    REFERENCES public.projects(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT task_time_logs_task_id_fkey
    FOREIGN KEY (task_id)
    REFERENCES public.roadmap_tasks(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT task_time_logs_member_user_id_fkey
    FOREIGN KEY (member_user_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT task_time_logs_project_id_fkey ON public.task_time_logs IS
  'Preserves billed work history when its project is deleted by setting project_id to NULL.';

COMMENT ON CONSTRAINT task_time_logs_task_id_fkey ON public.task_time_logs IS
  'Preserves billed work history when its task is deleted by setting task_id to NULL.';

COMMENT ON CONSTRAINT task_time_logs_member_user_id_fkey ON public.task_time_logs IS
  'Preserves billed work history when its member profile is deleted by setting member_user_id to NULL.';

COMMENT ON COLUMN public.contracts.project_title_snapshot IS
  'Project title frozen when the contract is created. Historical contracts keep this attribution after project deletion; later project title changes do not rewrite it.';

COMMENT ON COLUMN public.invoices.project_title_snapshot IS
  'Project title frozen when the invoice is created. Historical invoices keep this attribution after project deletion; later project title changes do not rewrite it.';

COMMENT ON COLUMN public.task_time_logs.member_display_name_snapshot IS
  'Member display label frozen when the log is created. Historical billed work stays attributable after profile deletion; later profile changes do not rewrite it.';

COMMIT;
