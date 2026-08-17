-- Phase 2 of the project workspace IA: Deliverables.
--
-- A deliverable is the client-facing handover artifact: the thing the client
-- accepts. It is deliberately NOT `roadmap_features.is_deliverable`, which
-- means "counts toward milestone progress" and is derived-status territory —
-- `roadmap_features.status` is recomputed from child task statuses by
-- backend/src/modules/execution/roadmaps/services/derive-feature-status.ts, so
-- a client's approval stored there would be silently overwritten the next time
-- someone ticked a task. A deliverable also spans several features, which a
-- boolean on one feature cannot express.
--
-- Execution only: no cost, price, or currency column appears here. Money lives
-- in contracts/invoices under the consultant-only finance surface.
--
-- Backend-dark on landing: the web pages ship behind VITE_DELIVERY_ENABLED.
-- New tables are member-readable under RLS as defence in depth; every write
-- goes through the service role, because the real gate is a resolved
-- role⊕origin⊕capabilities permission that is not expressible as an RLS
-- predicate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Convenience scope for filtering; a deliverable outlives a roadmap swap.
  roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  -- Markdown. A structured checklist table is a deliberate v2 cut.
  acceptance_criteria text,
  status text NOT NULL DEFAULT 'not_started',
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date date,
  position integer NOT NULL DEFAULT 0,
  -- Submit/review block, mirroring engagement_time_approvals so the two
  -- approval surfaces in the product read the same way.
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_deliverables_title_not_blank
    CHECK (length(btrim(title)) > 0),
  -- `changes_requested` is what gives a reviewer somewhere to land other than
  -- silently flipping the row back to in_progress and dropping review_note.
  CONSTRAINT project_deliverables_status_check
    CHECK (status IN (
      'not_started', 'in_progress', 'in_review', 'approved', 'changes_requested'
    )),
  CONSTRAINT project_deliverables_submitted_stamp_check
    CHECK (
      status <> 'in_review'
      OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
    ),
  CONSTRAINT project_deliverables_reviewed_stamp_check
    CHECK (
      status NOT IN ('approved', 'changes_requested')
      OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.project_deliverables IS
  'Client-facing handover artifacts with an acceptance state machine. Distinct from roadmap_features.is_deliverable, which is a milestone-progress hint.';
COMMENT ON COLUMN public.project_deliverables.acceptance_criteria IS
  'Markdown. What the client is agreeing to when they approve.';
COMMENT ON COLUMN public.project_deliverables.status IS
  'not_started -> in_progress -> in_review -> approved | changes_requested. changes_requested returns it to the provider with review_note intact.';

CREATE INDEX IF NOT EXISTS idx_project_deliverables_project_status
  ON public.project_deliverables (project_id, status, position);
CREATE INDEX IF NOT EXISTS idx_project_deliverables_owner
  ON public.project_deliverables (owner_id)
  WHERE owner_id IS NOT NULL;

-- Link a deliverable to the roadmap work that produces it. Three real FKs with
-- exactly one populated, rather than a polymorphic (target_type, target_id)
-- pair: this keeps ON DELETE CASCADE and referential integrity working.
CREATE TABLE IF NOT EXISTS public.deliverable_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL
    REFERENCES public.project_deliverables(id) ON DELETE CASCADE,
  feature_id uuid REFERENCES public.roadmap_features(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.roadmap_milestones(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliverable_links_exactly_one_target
    CHECK (num_nonnulls(feature_id, task_id, milestone_id) = 1)
);

COMMENT ON TABLE public.deliverable_links IS
  'Roadmap work a deliverable covers. Exactly one of feature_id/task_id/milestone_id is set.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliverable_links_unique_feature
  ON public.deliverable_links (deliverable_id, feature_id)
  WHERE feature_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliverable_links_unique_task
  ON public.deliverable_links (deliverable_id, task_id)
  WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliverable_links_unique_milestone
  ON public.deliverable_links (deliverable_id, milestone_id)
  WHERE milestone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deliverable_links_deliverable
  ON public.deliverable_links (deliverable_id, position);

CREATE TABLE IF NOT EXISTS public.deliverable_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL
    REFERENCES public.project_deliverables(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text,
  -- For kind='link' this is the destination; for kind='file' it is the
  -- resolved public/CDN URL of the stored object.
  url text NOT NULL,
  storage_key text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliverable_attachments_kind_check
    CHECK (kind IN ('file', 'link')),
  CONSTRAINT deliverable_attachments_file_has_key
    CHECK (kind <> 'file' OR storage_key IS NOT NULL)
);

COMMENT ON TABLE public.deliverable_attachments IS
  'Files and hyperlinks evidencing a deliverable. Files reuse the uploads bucket allowlist.';

CREATE INDEX IF NOT EXISTS idx_deliverable_attachments_deliverable
  ON public.deliverable_attachments (deliverable_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- project_chat_is_member is the live project-membership predicate (it reads
-- project_access and is SECURITY DEFINER to avoid RLS recursion). Note that
-- `is_project_member` does NOT exist in this database despite appearing in an
-- older migration — do not reach for it.

ALTER TABLE public.project_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliverable_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliverable_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members can view deliverables"
  ON public.project_deliverables;
CREATE POLICY "Project members can view deliverables"
  ON public.project_deliverables
  FOR SELECT
  USING (public.project_chat_is_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Project members can view deliverable links"
  ON public.deliverable_links;
CREATE POLICY "Project members can view deliverable links"
  ON public.deliverable_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_deliverables d
      WHERE d.id = deliverable_links.deliverable_id
        AND public.project_chat_is_member(d.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Project members can view deliverable attachments"
  ON public.deliverable_attachments;
CREATE POLICY "Project members can view deliverable attachments"
  ON public.deliverable_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_deliverables d
      WHERE d.id = deliverable_attachments.deliverable_id
        AND public.project_chat_is_member(d.project_id, auth.uid())
    )
  );

COMMIT;
