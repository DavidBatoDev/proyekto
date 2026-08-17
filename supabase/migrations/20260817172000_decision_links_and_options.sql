-- Decisions gain roadmap links and structured options.
--
-- Until now a decision could point at nothing: source_chat_message_id was the
-- only relationship on the table, so "which decisions affect this feature?" had
-- no answer. That is most of what makes a decision log worth keeping.
--
-- decision_links takes the SUPERSET of targets (epic, feature, task, milestone,
-- deliverable). The three existing junctions disagree — deliverable_links has no
-- epic_id, change_request_links has no milestone_id — and those gaps look like
-- accidents rather than decisions. A decision can plausibly bear on any of the
-- five, so the choice here is deliberate.
--
-- Several nullable typed FKs with num_nonnulls(...) = 1, not a polymorphic
-- (target_type, target_id) pair: real FKs keep ON DELETE CASCADE and referential
-- integrity working. See backend/src/modules/execution/delivery/delivery-links.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS public.decision_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL
    REFERENCES public.project_decisions(id) ON DELETE CASCADE,
  epic_id uuid REFERENCES public.roadmap_epics(id) ON DELETE CASCADE,
  feature_id uuid REFERENCES public.roadmap_features(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.roadmap_milestones(id) ON DELETE CASCADE,
  deliverable_id uuid
    REFERENCES public.project_deliverables(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_links_exactly_one_target
    CHECK (
      num_nonnulls(epic_id, feature_id, task_id, milestone_id, deliverable_id) = 1
    )
);

COMMENT ON TABLE public.decision_links IS
  'Work a decision bears on. Exactly one target column is set per row.';

CREATE INDEX IF NOT EXISTS idx_decision_links_decision
  ON public.decision_links (decision_id, position);

-- One link per target per decision. Partial indexes because four of the five
-- columns are NULL on any given row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_links_epic
  ON public.decision_links (decision_id, epic_id) WHERE epic_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_links_feature
  ON public.decision_links (decision_id, feature_id) WHERE feature_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_links_task
  ON public.decision_links (decision_id, task_id) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_links_milestone
  ON public.decision_links (decision_id, milestone_id) WHERE milestone_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_links_deliverable
  ON public.decision_links (decision_id, deliverable_id) WHERE deliverable_id IS NOT NULL;

-- ─── Options considered ─────────────────────────────────────────────────────
--
-- The free-text alternatives_considered column STAYS and is not migrated:
-- dropping it would lose prose nobody would re-enter. It disappears from the
-- create form and the detail page renders it, when present, as a note under the
-- structured options.

CREATE TABLE IF NOT EXISTS public.decision_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL
    REFERENCES public.project_decisions(id) ON DELETE CASCADE,
  title text NOT NULL,
  detail text,
  is_selected boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_options_title_not_blank
    CHECK (length(btrim(title)) > 0)
);

COMMENT ON TABLE public.decision_options IS
  'What was weighed. At most one option per decision carries is_selected.';

CREATE INDEX IF NOT EXISTS idx_decision_options_decision
  ON public.decision_options (decision_id, position);

-- What makes the "SELECTED" mark trustworthy: the database, not the caller,
-- guarantees there is only ever one. Selecting a new option therefore has to
-- clear its sibling in the same write.
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_options_selected
  ON public.decision_options (decision_id)
  WHERE is_selected;

ALTER TABLE public.decision_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members can view decision links"
  ON public.decision_links;
CREATE POLICY "Project members can view decision links"
  ON public.decision_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_decisions d
      WHERE d.id = decision_links.decision_id
        AND public.project_chat_is_member(d.project_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Project members can view decision options"
  ON public.decision_options;
CREATE POLICY "Project members can view decision options"
  ON public.decision_options
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.project_decisions d
      WHERE d.id = decision_options.decision_id
        AND public.project_chat_is_member(d.project_id, auth.uid())
    )
  );

COMMIT;
