-- Phase 3 of the project workspace IA: Change Requests.
--
-- The contract clause template already promises clients a change-request
-- process ("any work outside the approved scope must be submitted as a change
-- request"); nothing in the software implemented it. This is that object.
--
-- Execution only: impact is measured in days and prose. There is deliberately
-- no cost column — pricing a scope change is a contract amendment, which
-- already exists as contracts.supersedes_contract_id.
--
-- Approval does NOT write to the roadmap. It unlocks an "Apply to roadmap"
-- action that runs the normal preview -> revision_token -> commit protocol,
-- and the resulting change_id lands in applied_change_id. Auto-applying would
-- be unsafe: a request approved days ago carries a stale revision token and
-- would either 409 STALE_REVISION or blind-clobber concurrent edits.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL,
  -- Human-facing sequence per project, e.g. CR-012. Assigned by the backend.
  reference integer NOT NULL,
  title text NOT NULL,
  description text,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Prose: what the scope change actually is.
  impact_scope text,
  -- Signed: negative means the change pulls the schedule in.
  impact_timeline_days integer,
  target_date_before date,
  target_date_after date,
  status text NOT NULL DEFAULT 'draft',
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  -- Set once the approved change has actually been committed to the roadmap.
  applied_change_id uuid
    REFERENCES public.roadmap_change_history(change_id) ON DELETE SET NULL,
  applied_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_change_requests_title_not_blank
    CHECK (length(btrim(title)) > 0),
  CONSTRAINT project_change_requests_status_check
    CHECK (status IN (
      'draft', 'submitted', 'approved', 'rejected',
      'changes_requested', 'withdrawn', 'applied'
    )),
  CONSTRAINT project_change_requests_decision_stamp_check
    CHECK (
      status NOT IN ('approved', 'rejected', 'changes_requested')
      OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    ),
  -- `applied` is only reachable from an approval, and only with a real commit.
  CONSTRAINT project_change_requests_applied_stamp_check
    CHECK (
      status <> 'applied'
      OR (applied_change_id IS NOT NULL AND applied_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.project_change_requests IS
  'Scope changes requested against a project. Impact is timeline (days) and prose only; cost belongs to contract amendments.';
COMMENT ON COLUMN public.project_change_requests.impact_timeline_days IS
  'Signed day delta to the schedule. Negative pulls the schedule in.';
COMMENT ON COLUMN public.project_change_requests.applied_change_id IS
  'The roadmap_change_history commit that carried this change onto the roadmap. Null until someone runs Apply to roadmap.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_change_requests_reference
  ON public.project_change_requests (project_id, reference);
CREATE INDEX IF NOT EXISTS idx_project_change_requests_project_status
  ON public.project_change_requests (project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.change_request_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL
    REFERENCES public.project_change_requests(id) ON DELETE CASCADE,
  epic_id uuid REFERENCES public.roadmap_epics(id) ON DELETE CASCADE,
  feature_id uuid REFERENCES public.roadmap_features(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  deliverable_id uuid
    REFERENCES public.project_deliverables(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT change_request_links_exactly_one_target
    CHECK (num_nonnulls(epic_id, feature_id, task_id, deliverable_id) = 1)
);

COMMENT ON TABLE public.change_request_links IS
  'What a change request affects. Exactly one target column is set per row.';

CREATE INDEX IF NOT EXISTS idx_change_request_links_request
  ON public.change_request_links (change_request_id, position);

ALTER TABLE public.project_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_request_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members can view change requests"
  ON public.project_change_requests;
CREATE POLICY "Project members can view change requests"
  ON public.project_change_requests
  FOR SELECT
  USING (public.project_chat_is_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members can view change request links"
  ON public.change_request_links;
CREATE POLICY "Project members can view change request links"
  ON public.change_request_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_change_requests cr
      WHERE cr.id = change_request_links.change_request_id
        AND public.project_chat_is_member(cr.project_id, auth.uid())
    )
  );

COMMIT;
