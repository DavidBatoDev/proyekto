-- Phase 4 of the project workspace IA: Risks & Issues.
--
-- One table, discriminated by `kind`, because a risk that materialises becomes
-- an issue and splitting them would mean moving rows between tables.
--
-- Honest overlap: roadmap_tasks.status='blocked', roadmap_features.status=
-- 'blocked' and roadmap_milestones.status IN ('at_risk','missed') already flag
-- trouble. They carry no owner, severity, mitigation, due date, or history,
-- and they evaporate when the flag flips. This register does not replace them
-- — `source_kind` records that a row was promoted from one of those signals,
-- so the UI can list unregistered blocked work as one-click candidates rather
-- than making anyone re-key it.
--
-- A prior attempt at this lived as project_briefs.risk_register JSONB and was
-- dropped 2026-05-07. What failed there was an unowned blob inside another
-- table's row, not the concept.
--
-- NOTE for anything that logs activity about these rows: `visibility` is
-- per-row, but SENSITIVE_ACTIONS in the audit vocabulary is per-action. Never
-- put the title of an `internal` row into project_activity_log.metadata, or
-- the feed re-leaks precisely what risks.view_internal is protecting.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_risk_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'medium',
  -- Only meaningful for a risk: an issue has already happened.
  likelihood text,
  status text NOT NULL DEFAULT 'open',
  impact text,
  mitigation text,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date date,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'internal',
  source_kind text NOT NULL DEFAULT 'manual',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_risk_register_title_not_blank
    CHECK (length(btrim(title)) > 0),
  CONSTRAINT project_risk_register_kind_check
    CHECK (kind IN ('risk', 'issue')),
  CONSTRAINT project_risk_register_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT project_risk_register_likelihood_check
    CHECK (likelihood IS NULL OR likelihood IN ('low', 'medium', 'high')),
  CONSTRAINT project_risk_register_risk_has_likelihood
    CHECK (kind <> 'risk' OR likelihood IS NOT NULL),
  CONSTRAINT project_risk_register_status_check
    CHECK (status IN (
      'open', 'mitigating', 'monitoring', 'resolved', 'accepted', 'closed'
    )),
  CONSTRAINT project_risk_register_resolved_stamp_check
    CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
  CONSTRAINT project_risk_register_visibility_check
    CHECK (visibility IN ('internal', 'shared')),
  CONSTRAINT project_risk_register_source_kind_check
    CHECK (source_kind IN ('manual', 'blocked_task', 'at_risk_milestone'))
);

COMMENT ON TABLE public.project_risk_register IS
  'Combined risk and issue register. `internal` rows are withheld from the client origin via risks.view_internal.';
COMMENT ON COLUMN public.project_risk_register.likelihood IS
  'Required for kind=risk, null for kind=issue — an issue has already occurred.';
COMMENT ON COLUMN public.project_risk_register.source_kind IS
  'manual, or the derived signal this row was promoted from (a blocked task, an at-risk milestone).';
COMMENT ON COLUMN public.project_risk_register.visibility IS
  'internal keeps the row off client-facing surfaces; shared exposes it. Per-row, unlike the action-level audit sensitivity flag.';

CREATE INDEX IF NOT EXISTS idx_project_risk_register_project_status
  ON public.project_risk_register (project_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_project_risk_register_owner_due
  ON public.project_risk_register (owner_id, due_date)
  WHERE status NOT IN ('resolved', 'closed');

CREATE TABLE IF NOT EXISTS public.risk_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_id uuid NOT NULL
    REFERENCES public.project_risk_register(id) ON DELETE CASCADE,
  epic_id uuid REFERENCES public.roadmap_epics(id) ON DELETE CASCADE,
  feature_id uuid REFERENCES public.roadmap_features(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.roadmap_milestones(id) ON DELETE CASCADE,
  deliverable_id uuid
    REFERENCES public.project_deliverables(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_links_exactly_one_target
    CHECK (
      num_nonnulls(epic_id, feature_id, task_id, milestone_id, deliverable_id) = 1
    )
);

COMMENT ON TABLE public.risk_links IS
  'Work a risk or issue attaches to. Exactly one target column is set per row.';

CREATE INDEX IF NOT EXISTS idx_risk_links_risk
  ON public.risk_links (risk_id);

ALTER TABLE public.project_risk_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_links ENABLE ROW LEVEL SECURITY;

-- Membership only at this layer; the internal/shared split is a resolved
-- permission and is enforced in the service, like every other capability.
DROP POLICY IF EXISTS "Project members can view the risk register"
  ON public.project_risk_register;
CREATE POLICY "Project members can view the risk register"
  ON public.project_risk_register
  FOR SELECT
  USING (public.project_chat_is_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members can view risk links"
  ON public.risk_links;
CREATE POLICY "Project members can view risk links"
  ON public.risk_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_risk_register r
      WHERE r.id = risk_links.risk_id
        AND public.project_chat_is_member(r.project_id, auth.uid())
    )
  );

COMMIT;
