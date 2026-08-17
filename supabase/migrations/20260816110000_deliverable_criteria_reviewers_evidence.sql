-- Deliverables → delivery control center.
--
-- Three additions that turn a deliverable from a card with a status into
-- something a project can actually accept:
--
--   1. deliverable_criteria  — a countable definition of done, replacing the
--      free-text acceptance_criteria column as the authoritative form. The
--      text column stays for existing rows and for prose that doesn't fit a
--      checklist; it is no longer the only answer to "is this finished?".
--   2. deliverable_reviewers — named sign-off. Reviewers are ANY project
--      member: this is the execution layer, so review is capability-based,
--      never tied to a declared client/lead identity.
--   3. deliverable_attachments.category — typed evidence (a GitHub PR reads
--      differently from a Figma link or a staging deployment).
--
-- Status values are deliberately unchanged. The UI labels `approved` as
-- "Accepted"; renaming the stored value would be a data migration plus new
-- CHECK constraints for pure wording, and label≠value is already the
-- established precedent (work-items is labelled Board).
--
-- Execution only: no cost, price, or currency column appears here.

BEGIN;

-- ── Acceptance criteria ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deliverable_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL
    REFERENCES public.project_deliverables(id) ON DELETE CASCADE,
  label text NOT NULL,
  is_met boolean NOT NULL DEFAULT false,
  met_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  met_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliverable_criteria_label_not_blank
    CHECK (length(btrim(label)) > 0),
  -- A ticked criterion records who ticked it and when; an unticked one holds
  -- neither, so re-opening a criterion cannot leave a misleading attribution.
  CONSTRAINT deliverable_criteria_met_stamp_check
    CHECK (
      (is_met AND met_by IS NOT NULL AND met_at IS NOT NULL)
      OR (NOT is_met AND met_by IS NULL AND met_at IS NULL)
    )
);

COMMENT ON TABLE public.deliverable_criteria IS
  'Countable acceptance criteria for a deliverable. Drives the "N of M criteria met" summary.';

CREATE INDEX IF NOT EXISTS idx_deliverable_criteria_deliverable
  ON public.deliverable_criteria (deliverable_id, position);

-- ── Named reviewers ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deliverable_reviewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL
    REFERENCES public.project_deliverables(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  decision text NOT NULL DEFAULT 'pending',
  note text,
  decided_at timestamptz,
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliverable_reviewers_unique UNIQUE (deliverable_id, reviewer_id),
  CONSTRAINT deliverable_reviewers_decision_check
    CHECK (decision IN ('pending', 'approved', 'changes_requested')),
  -- Symmetric to the criteria stamp: a decision carries its timestamp, and
  -- resetting to pending on resubmission clears it.
  CONSTRAINT deliverable_reviewers_decided_stamp_check
    CHECK (
      (decision = 'pending' AND decided_at IS NULL)
      OR (decision <> 'pending' AND decided_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.deliverable_reviewers IS
  'Named sign-off list. Any project member may be a reviewer - review is capability-based, not role-based. A deliverable is accepted only when every reviewer has approved.';
COMMENT ON COLUMN public.deliverable_reviewers.decision IS
  'Reset to pending whenever the deliverable is resubmitted, so a resubmission never inherits stale approvals.';

CREATE INDEX IF NOT EXISTS idx_deliverable_reviewers_deliverable
  ON public.deliverable_reviewers (deliverable_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_reviewers_pending
  ON public.deliverable_reviewers (reviewer_id)
  WHERE decision = 'pending';

-- ── Typed evidence ─────────────────────────────────────────────────────────

ALTER TABLE public.deliverable_attachments
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';

ALTER TABLE public.deliverable_attachments
  DROP CONSTRAINT IF EXISTS deliverable_attachments_category_check,
  ADD CONSTRAINT deliverable_attachments_category_check
    CHECK (category IN ('github', 'figma', 'deployment', 'docs', 'demo', 'other'));

COMMENT ON COLUMN public.deliverable_attachments.category IS
  'What kind of proof this is, so evidence can be grouped: a PR reads differently from a Figma file or a staging deployment.';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Member-read as defence in depth; every write goes through the service role,
-- because the real gate is a resolved role⊕origin⊕capabilities permission that
-- cannot be expressed as an RLS predicate.
--
-- project_chat_is_member is the live membership predicate (it reads
-- project_access, SECURITY DEFINER to avoid recursion). `is_project_member`
-- does NOT exist in this database despite appearing in an older migration.

ALTER TABLE public.deliverable_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliverable_reviewers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members can view deliverable criteria"
  ON public.deliverable_criteria;
CREATE POLICY "Project members can view deliverable criteria"
  ON public.deliverable_criteria
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_deliverables d
      WHERE d.id = deliverable_criteria.deliverable_id
        AND public.project_chat_is_member(d.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Project members can view deliverable reviewers"
  ON public.deliverable_reviewers;
CREATE POLICY "Project members can view deliverable reviewers"
  ON public.deliverable_reviewers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_deliverables d
      WHERE d.id = deliverable_reviewers.deliverable_id
        AND public.project_chat_is_member(d.project_id, auth.uid())
    )
  );

COMMIT;
