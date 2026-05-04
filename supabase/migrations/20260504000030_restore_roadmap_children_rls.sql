-- Migration: 20260504000030_restore_roadmap_children_rls.sql
-- Date: May 4, 2026
-- Description:
--   Slice 3.10c — restore RLS on roadmap-children tables that lost their
--   policies in the CASCADE drops triggered by removing the legacy
--   `can_access_roadmap`, `can_edit_roadmap`, `is_project_member`, and
--   `has_roadmap_permission` helpers in slice 3b + 3.10b.
--
--   The new policies route everything through
--   `get_user_roadmap_effective_role(uid, roadmap_id)` which consults
--   `roadmap_shares` first then falls back to `project_shares` on the
--   parent project.
--
--   Tables covered:
--     - roadmap_milestones, milestone_epics, milestone_features
--     - roadmap_epics, roadmap_features, roadmap_tasks
--     - task_comments, task_attachments
--     - epic_comments (select), feature_comments (select)
--
--   Backend code is unaffected (service_role bypasses RLS); this restores
--   the safety-net for direct frontend Supabase client queries.

-- ============================================================================
-- Helper: minimum-role check for "can the caller see this roadmap?"
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_view_roadmap(uid uuid, rmp uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.roadmaps r WHERE r.id = rmp AND r.owner_id = uid)
    OR public.get_user_roadmap_effective_role(uid, rmp) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.can_edit_roadmap(uid uuid, rmp uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.roadmaps r WHERE r.id = rmp AND r.owner_id = uid)
    OR public.get_user_roadmap_effective_role(uid, rmp)
        IN ('editor', 'admin', 'owner');
$$;

-- ============================================================================
-- roadmap_milestones
-- ============================================================================

DROP POLICY IF EXISTS roadmap_milestones_select ON public.roadmap_milestones;
DROP POLICY IF EXISTS roadmap_milestones_insert ON public.roadmap_milestones;
DROP POLICY IF EXISTS roadmap_milestones_update ON public.roadmap_milestones;
DROP POLICY IF EXISTS roadmap_milestones_delete ON public.roadmap_milestones;

CREATE POLICY roadmap_milestones_select ON public.roadmap_milestones
  FOR SELECT USING (public.can_view_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_milestones_insert ON public.roadmap_milestones
  FOR INSERT WITH CHECK (public.can_edit_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_milestones_update ON public.roadmap_milestones
  FOR UPDATE USING (public.can_edit_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_milestones_delete ON public.roadmap_milestones
  FOR DELETE USING (public.can_edit_roadmap(auth.uid(), roadmap_id));

-- ============================================================================
-- roadmap_epics
-- ============================================================================

DROP POLICY IF EXISTS roadmap_epics_select ON public.roadmap_epics;
DROP POLICY IF EXISTS roadmap_epics_insert ON public.roadmap_epics;
DROP POLICY IF EXISTS roadmap_epics_update ON public.roadmap_epics;
DROP POLICY IF EXISTS roadmap_epics_delete ON public.roadmap_epics;

CREATE POLICY roadmap_epics_select ON public.roadmap_epics
  FOR SELECT USING (public.can_view_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_epics_insert ON public.roadmap_epics
  FOR INSERT WITH CHECK (public.can_edit_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_epics_update ON public.roadmap_epics
  FOR UPDATE USING (public.can_edit_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_epics_delete ON public.roadmap_epics
  FOR DELETE USING (public.can_edit_roadmap(auth.uid(), roadmap_id));

-- ============================================================================
-- roadmap_features
-- ============================================================================

DROP POLICY IF EXISTS roadmap_features_select ON public.roadmap_features;
DROP POLICY IF EXISTS roadmap_features_insert ON public.roadmap_features;
DROP POLICY IF EXISTS roadmap_features_update ON public.roadmap_features;
DROP POLICY IF EXISTS roadmap_features_delete ON public.roadmap_features;

CREATE POLICY roadmap_features_select ON public.roadmap_features
  FOR SELECT USING (public.can_view_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_features_insert ON public.roadmap_features
  FOR INSERT WITH CHECK (public.can_edit_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_features_update ON public.roadmap_features
  FOR UPDATE USING (public.can_edit_roadmap(auth.uid(), roadmap_id));
CREATE POLICY roadmap_features_delete ON public.roadmap_features
  FOR DELETE USING (public.can_edit_roadmap(auth.uid(), roadmap_id));

-- ============================================================================
-- roadmap_tasks (no roadmap_id column — joined via feature_id → epic_id)
-- ============================================================================

DROP POLICY IF EXISTS roadmap_tasks_select ON public.roadmap_tasks;
DROP POLICY IF EXISTS roadmap_tasks_insert ON public.roadmap_tasks;
DROP POLICY IF EXISTS roadmap_tasks_update ON public.roadmap_tasks;
DROP POLICY IF EXISTS roadmap_tasks_delete ON public.roadmap_tasks;

CREATE POLICY roadmap_tasks_select ON public.roadmap_tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_features f
      WHERE f.id = roadmap_tasks.feature_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );
CREATE POLICY roadmap_tasks_insert ON public.roadmap_tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.roadmap_features f
      WHERE f.id = roadmap_tasks.feature_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
  );
CREATE POLICY roadmap_tasks_update ON public.roadmap_tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_features f
      WHERE f.id = roadmap_tasks.feature_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
  );
CREATE POLICY roadmap_tasks_delete ON public.roadmap_tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_features f
      WHERE f.id = roadmap_tasks.feature_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
  );

-- ============================================================================
-- milestone_features (junction table)
-- ============================================================================

DROP POLICY IF EXISTS milestone_features_select ON public.milestone_features;
DROP POLICY IF EXISTS milestone_features_insert ON public.milestone_features;
DROP POLICY IF EXISTS milestone_features_delete ON public.milestone_features;

CREATE POLICY milestone_features_select ON public.milestone_features
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.roadmap_milestones m
      WHERE m.id = milestone_features.milestone_id
        AND public.can_view_roadmap(auth.uid(), m.roadmap_id)
    )
  );
CREATE POLICY milestone_features_insert ON public.milestone_features
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roadmap_milestones m
      WHERE m.id = milestone_features.milestone_id
        AND public.can_edit_roadmap(auth.uid(), m.roadmap_id)
    )
  );
CREATE POLICY milestone_features_delete ON public.milestone_features
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.roadmap_milestones m
      WHERE m.id = milestone_features.milestone_id
        AND public.can_edit_roadmap(auth.uid(), m.roadmap_id)
    )
  );

-- ============================================================================
-- task_comments (joined via task_id → feature → roadmap)
-- ============================================================================

DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
DROP POLICY IF EXISTS task_comments_insert ON public.task_comments;
DROP POLICY IF EXISTS task_comments_update ON public.task_comments;
DROP POLICY IF EXISTS task_comments_delete ON public.task_comments;

CREATE POLICY task_comments_select ON public.task_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_tasks t
      JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE t.id = task_comments.task_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );
CREATE POLICY task_comments_insert ON public.task_comments
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.roadmap_tasks t
      JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE t.id = task_comments.task_id
        AND public.get_user_roadmap_effective_role(auth.uid(), f.roadmap_id)
            IN ('commenter', 'editor', 'admin', 'owner')
    )
  );
CREATE POLICY task_comments_update ON public.task_comments
  FOR UPDATE USING (author_id = auth.uid());
CREATE POLICY task_comments_delete ON public.task_comments
  FOR DELETE USING (author_id = auth.uid());

-- ============================================================================
-- task_attachments (joined via task_id → feature → roadmap)
-- ============================================================================

DROP POLICY IF EXISTS task_attachments_select ON public.task_attachments;
DROP POLICY IF EXISTS task_attachments_insert ON public.task_attachments;
DROP POLICY IF EXISTS task_attachments_delete ON public.task_attachments;

CREATE POLICY task_attachments_select ON public.task_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.roadmap_tasks t
      JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE t.id = task_attachments.task_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );
CREATE POLICY task_attachments_insert ON public.task_attachments
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.roadmap_tasks t
      JOIN public.roadmap_features f ON f.id = t.feature_id
      WHERE t.id = task_attachments.task_id
        AND public.can_edit_roadmap(auth.uid(), f.roadmap_id)
    )
  );
CREATE POLICY task_attachments_delete ON public.task_attachments
  FOR DELETE USING (uploaded_by = auth.uid());

-- ============================================================================
-- epic_comments + feature_comments — restore SELECT/UPDATE/DELETE policies.
-- (INSERT was created in 20260504000020; this completes the set.)
-- ============================================================================

DROP POLICY IF EXISTS epic_comments_select ON public.epic_comments;
DROP POLICY IF EXISTS epic_comments_update ON public.epic_comments;
DROP POLICY IF EXISTS epic_comments_delete ON public.epic_comments;

CREATE POLICY epic_comments_select ON public.epic_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.roadmap_epics e
      WHERE e.id = epic_comments.epic_id
        AND public.can_view_roadmap(auth.uid(), e.roadmap_id)
    )
  );
CREATE POLICY epic_comments_update ON public.epic_comments
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY epic_comments_delete ON public.epic_comments
  FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS feature_comments_select ON public.feature_comments;
DROP POLICY IF EXISTS feature_comments_update ON public.feature_comments;
DROP POLICY IF EXISTS feature_comments_delete ON public.feature_comments;

CREATE POLICY feature_comments_select ON public.feature_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_comments.feature_id
        AND public.can_view_roadmap(auth.uid(), f.roadmap_id)
    )
  );
CREATE POLICY feature_comments_update ON public.feature_comments
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY feature_comments_delete ON public.feature_comments
  FOR DELETE USING (user_id = auth.uid());
