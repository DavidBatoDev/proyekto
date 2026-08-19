-- Roadmap sticky notes: freeform annotations that live ON the canvas.
--
-- One table, optional target. A note either FLOATS at its own canvas
-- coordinates (position_x/position_y set, no target) or is PINNED to exactly
-- one epic/feature/task (target set, no coordinates) and renders as a badge on
-- that card. The two placements are mutually exclusive by CHECK, so unpinning
-- must clear the target and supply coordinates in the SAME update.
--
-- Typed nullable FKs with num_nonnulls(), not a polymorphic (target_type,
-- target_id) pair -- the same call decision_links made (20260817172000): real
-- FKs keep ON DELETE CASCADE and referential integrity working, so deleting a
-- feature takes its notes with it instead of orphaning them. The difference
-- from decision_links is "<= 1" rather than "= 1": zero targets is the
-- free-floating case, which is the whole point of the feature.
--
-- roadmap_id is denormalised, for the reason feature_dependencies gives
-- (20260817022000): the canvas reads every note for a roadmap at once, and RLS
-- collapses to one indexed column check instead of a per-row EXISTS walking up
-- through three parent tables.
--
-- position_x/position_y are the FIRST persisted canvas coordinates in this
-- schema -- epics, features and tasks all use a 1-D integer "position" ordinal
-- and have their x/y computed by the client layout pass. Note coordinates live
-- in the space that layout emits, and that space is NOT stable: epic heights
-- come from measured card sizes, so a note parked beside an epic drifts if an
-- epic above it grows. That is accepted -- a sticky note is anchored to the
-- board, not to the work. Pin the note if it must follow a card.

CREATE TABLE IF NOT EXISTS public.roadmap_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,

  epic_id    uuid REFERENCES public.roadmap_epics(id)    ON DELETE CASCADE,
  feature_id uuid REFERENCES public.roadmap_features(id) ON DELETE CASCADE,
  task_id    uuid REFERENCES public.roadmap_tasks(id)    ON DELETE CASCADE,

  -- Plain text, not HTML. Notes render on a canvas that keeps every node
  -- mounted (there is no culling -- see web/src/lib/flow/flow.css), so a rich
  -- text editor per note is a cost the canvas has no defence against; and
  -- plain text means the client never needs dangerouslySetInnerHTML here.
  body text NOT NULL,
  color text NOT NULL DEFAULT 'yellow'
    CHECK (color IN ('yellow', 'blue', 'green', 'pink', 'purple', 'gray')),

  position_x double precision,
  position_y double precision,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT roadmap_notes_body_not_blank
    CHECK (length(btrim(body)) > 0 AND length(body) <= 2000),

  -- At most one target. Zero targets = free-floating.
  CONSTRAINT roadmap_notes_at_most_one_target
    CHECK (num_nonnulls(epic_id, feature_id, task_id) <= 1),

  -- Placement shape, the user_tour_progress "(A) = (B)" idiom: a free note
  -- MUST carry coordinates, a pinned note MUST NOT. Letting a pinned note keep
  -- stale coordinates would leave data that is already wrong by the time the
  -- layout next reflows.
  CONSTRAINT roadmap_notes_placement_shape
    CHECK (
      (num_nonnulls(epic_id, feature_id, task_id) = 0)
      = (position_x IS NOT NULL AND position_y IS NOT NULL)
    ),

  -- Bound the plane. The client derives its pan extent from node positions, so
  -- a single mistyped coordinate would permanently expand the pannable area
  -- for every viewer of this roadmap.
  CONSTRAINT roadmap_notes_position_bounds
    CHECK (
      (position_x IS NULL OR position_x BETWEEN -20000 AND 20000)
      AND (position_y IS NULL OR position_y BETWEEN -20000 AND 20000)
    )
);

CREATE INDEX IF NOT EXISTS idx_roadmap_notes_roadmap
  ON public.roadmap_notes (roadmap_id, created_at);

-- Partial, and deliberately NOT unique (unlike the decision_links target
-- indexes): several people pinning several notes to one card is expected here.
CREATE INDEX IF NOT EXISTS idx_roadmap_notes_epic
  ON public.roadmap_notes (epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roadmap_notes_feature
  ON public.roadmap_notes (feature_id) WHERE feature_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roadmap_notes_task
  ON public.roadmap_notes (task_id) WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_roadmap_notes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_notes_updated_at ON public.roadmap_notes;
CREATE TRIGGER trg_roadmap_notes_updated_at
BEFORE UPDATE ON public.roadmap_notes
FOR EACH ROW
EXECUTE FUNCTION public.handle_roadmap_notes_updated_at();

ALTER TABLE public.roadmap_notes ENABLE ROW LEVEL SECURITY;

-- auth.uid() is wrapped in a scalar subquery throughout so Postgres hoists it
-- out of the per-row loop; a bare call trips the auth_rls_initplan lint.

-- SELECT: everyone who can view the roadmap sees every note. Same visibility
-- model as comments, which is what a shared annotation needs.
DROP POLICY IF EXISTS roadmap_notes_select ON public.roadmap_notes;
CREATE POLICY roadmap_notes_select
  ON public.roadmap_notes FOR SELECT
  TO authenticated
  USING (public.can_view_roadmap((SELECT auth.uid()), roadmap_id));

-- INSERT: the COMMENT tier, not the edit tier. A note is an annotation, and
-- commenter is the rung the share_role ladder already defines for "can say
-- something without changing the plan" -- much of the value of a sticky note is
-- that a client can mark up a roadmap they cannot edit. Mirrors
-- task_comments_insert (20260504000030).
DROP POLICY IF EXISTS roadmap_notes_insert ON public.roadmap_notes;
CREATE POLICY roadmap_notes_insert
  ON public.roadmap_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.get_user_roadmap_effective_role((SELECT auth.uid()), roadmap_id)
        IN ('commenter', 'editor', 'admin', 'owner')
  );

-- UPDATE / DELETE: author OR anyone who can edit the roadmap.
--
-- This deliberately diverges from comments, which are author-only with no
-- override. A comment sits inside a panel and inconveniences nobody; a note
-- occupies canvas space every viewer has to look at, so the people who own what
-- the canvas looks like must be able to move or clear one. The narrower rule --
-- that only the author may rewrite the TEXT -- is enforced in the service; this
-- is the coarse defence-in-depth boundary.
DROP POLICY IF EXISTS roadmap_notes_update ON public.roadmap_notes;
CREATE POLICY roadmap_notes_update
  ON public.roadmap_notes FOR UPDATE
  TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR public.can_edit_roadmap((SELECT auth.uid()), roadmap_id)
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    OR public.can_edit_roadmap((SELECT auth.uid()), roadmap_id)
  );

DROP POLICY IF EXISTS roadmap_notes_delete ON public.roadmap_notes;
CREATE POLICY roadmap_notes_delete
  ON public.roadmap_notes FOR DELETE
  TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR public.can_edit_roadmap((SELECT auth.uid()), roadmap_id)
  );

DROP POLICY IF EXISTS "Service role manages roadmap notes" ON public.roadmap_notes;
CREATE POLICY "Service role manages roadmap notes"
  ON public.roadmap_notes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.roadmap_notes IS
  'Sticky notes on the roadmap canvas. Free-floating (position_x/y) or pinned to exactly one epic/feature/task. Visible to every roadmap viewer; creatable at the commenter tier.';
COMMENT ON COLUMN public.roadmap_notes.roadmap_id IS
  'Denormalised so RLS is a single indexed check rather than a walk up through the epic/feature/task parents.';
COMMENT ON COLUMN public.roadmap_notes.position_x IS
  'Canvas x for a free-floating note. NULL for a pinned note (enforced by roadmap_notes_placement_shape).';
