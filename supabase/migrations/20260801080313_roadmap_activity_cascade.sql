-- Full activity cascade: roll task/feature/epic/milestone/comment edits made
-- directly on the execution board (not just AI-canvas commits) up into
-- roadmaps.updated_at, and roadmaps.updated_at up into projects.updated_at,
-- so "most recently active" sort (sidebar + dashboard) surfaces true
-- engagement, not just the last upsert_full_roadmap commit.
--
-- roadmap_epics / roadmap_milestones / roadmap_features all carry their own
-- roadmap_id column directly (roadmap_features.roadmap_id was denormalized in
-- 20260121000000_upgrade_roadmap_to_v2.sql) so they share one trigger
-- function. roadmap_tasks only has feature_id, so it resolves roadmap_id via
-- a single join to roadmap_features. task_comments/epic_comments/
-- feature_comments each resolve via their nearest ancestor.
--
-- All functions are SECURITY DEFINER (matching the convention in
-- 20260504000030_restore_roadmap_children_rls.sql's can_view_roadmap /
-- can_edit_roadmap) so the cascade succeeds regardless of which role
-- performed the originating write.

-- ============================================================================
-- 1. Shared function for tables with a direct roadmap_id column
--    (roadmap_epics, roadmap_milestones, roadmap_features)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_parent_roadmap_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roadmap_id uuid := COALESCE(NEW.roadmap_id, OLD.roadmap_id);
BEGIN
  IF v_roadmap_id IS NOT NULL THEN
    UPDATE public.roadmaps SET updated_at = now() WHERE id = v_roadmap_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS roadmap_epics_touch_roadmap ON public.roadmap_epics;
CREATE TRIGGER roadmap_epics_touch_roadmap
  AFTER INSERT OR UPDATE OR DELETE ON public.roadmap_epics
  FOR EACH ROW EXECUTE FUNCTION public.touch_parent_roadmap_updated_at();

DROP TRIGGER IF EXISTS roadmap_milestones_touch_roadmap ON public.roadmap_milestones;
CREATE TRIGGER roadmap_milestones_touch_roadmap
  AFTER INSERT OR UPDATE OR DELETE ON public.roadmap_milestones
  FOR EACH ROW EXECUTE FUNCTION public.touch_parent_roadmap_updated_at();

DROP TRIGGER IF EXISTS roadmap_features_touch_roadmap ON public.roadmap_features;
CREATE TRIGGER roadmap_features_touch_roadmap
  AFTER INSERT OR UPDATE OR DELETE ON public.roadmap_features
  FOR EACH ROW EXECUTE FUNCTION public.touch_parent_roadmap_updated_at();

-- ============================================================================
-- 2. roadmap_tasks: resolve via roadmap_features.roadmap_id (single join).
--    Handles a task moving between features (UpdateTaskDto.feature_id is
--    mutable) by touching both the old and new roadmap if they differ.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_roadmap_from_task_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_roadmap_id uuid;
  v_old_roadmap_id uuid;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT roadmap_id INTO v_new_roadmap_id
    FROM public.roadmap_features WHERE id = NEW.feature_id;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT roadmap_id INTO v_old_roadmap_id
    FROM public.roadmap_features WHERE id = OLD.feature_id;
  END IF;

  IF v_new_roadmap_id IS NOT NULL THEN
    UPDATE public.roadmaps SET updated_at = now() WHERE id = v_new_roadmap_id;
  END IF;

  IF v_old_roadmap_id IS NOT NULL
     AND v_old_roadmap_id IS DISTINCT FROM v_new_roadmap_id THEN
    UPDATE public.roadmaps SET updated_at = now() WHERE id = v_old_roadmap_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS roadmap_tasks_touch_roadmap ON public.roadmap_tasks;
CREATE TRIGGER roadmap_tasks_touch_roadmap
  AFTER INSERT OR UPDATE OR DELETE ON public.roadmap_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_roadmap_from_task_change();

-- ============================================================================
-- 3. task_comments: two-hop resolve (task -> feature.roadmap_id).
--    No updated_at column on this table - INSERT/UPDATE(edit)/DELETE all
--    count as activity.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_roadmap_from_task_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roadmap_id uuid;
  v_task_id uuid := COALESCE(NEW.task_id, OLD.task_id);
BEGIN
  SELECT f.roadmap_id INTO v_roadmap_id
  FROM public.roadmap_tasks t
  JOIN public.roadmap_features f ON f.id = t.feature_id
  WHERE t.id = v_task_id;

  IF v_roadmap_id IS NOT NULL THEN
    UPDATE public.roadmaps SET updated_at = now() WHERE id = v_roadmap_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS task_comments_touch_roadmap ON public.task_comments;
CREATE TRIGGER task_comments_touch_roadmap
  AFTER INSERT OR UPDATE OR DELETE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_roadmap_from_task_comment();

-- ============================================================================
-- 4. epic_comments: one-hop resolve (epic -> roadmap_epics.roadmap_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_roadmap_from_epic_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roadmap_id uuid;
BEGIN
  SELECT roadmap_id INTO v_roadmap_id
  FROM public.roadmap_epics
  WHERE id = COALESCE(NEW.epic_id, OLD.epic_id);

  IF v_roadmap_id IS NOT NULL THEN
    UPDATE public.roadmaps SET updated_at = now() WHERE id = v_roadmap_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS epic_comments_touch_roadmap ON public.epic_comments;
CREATE TRIGGER epic_comments_touch_roadmap
  AFTER INSERT OR UPDATE OR DELETE ON public.epic_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_roadmap_from_epic_comment();

-- ============================================================================
-- 5. feature_comments: one-hop resolve (feature -> roadmap_features.roadmap_id,
--    already denormalized).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_roadmap_from_feature_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roadmap_id uuid;
BEGIN
  SELECT roadmap_id INTO v_roadmap_id
  FROM public.roadmap_features
  WHERE id = COALESCE(NEW.feature_id, OLD.feature_id);

  IF v_roadmap_id IS NOT NULL THEN
    UPDATE public.roadmaps SET updated_at = now() WHERE id = v_roadmap_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS feature_comments_touch_roadmap ON public.feature_comments;
CREATE TRIGGER feature_comments_touch_roadmap
  AFTER INSERT OR UPDATE OR DELETE ON public.feature_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_roadmap_from_feature_comment();

-- ============================================================================
-- 6. roadmaps -> projects cascade. Fires after ANY roadmap update (the
--    pre-existing update_roadmaps_updated_at BEFORE trigger already bumps
--    updated_at on every UPDATE, so the WHEN clause's second condition is
--    close to always-true in practice; kept as explicit defense).
--    Guarded on project_id IS NOT NULL for guest/standalone draft roadmaps
--    (nullable since 20260210000001_make_project_id_optional.sql).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_project_from_roadmap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET updated_at = now() WHERE id = NEW.project_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS roadmaps_touch_project ON public.roadmaps;
CREATE TRIGGER roadmaps_touch_project
  AFTER UPDATE ON public.roadmaps
  FOR EACH ROW
  WHEN (NEW.project_id IS NOT NULL AND NEW.updated_at IS DISTINCT FROM OLD.updated_at)
  EXECUTE FUNCTION public.touch_project_from_roadmap();

COMMENT ON FUNCTION public.touch_parent_roadmap_updated_at IS
  'Shared AFTER trigger for roadmap_epics/roadmap_milestones/roadmap_features: bumps roadmaps.updated_at from their direct roadmap_id column. Part of the activity-cascade sort feature.';
COMMENT ON FUNCTION public.touch_roadmap_from_task_change IS
  'Bumps roadmaps.updated_at from roadmap_tasks via roadmap_features.roadmap_id; handles feature_id reassignment.';
COMMENT ON FUNCTION public.touch_roadmap_from_task_comment IS
  'Bumps roadmaps.updated_at when a task comment is added, edited, or deleted.';
COMMENT ON FUNCTION public.touch_roadmap_from_epic_comment IS
  'Bumps roadmaps.updated_at when an epic comment is added, edited, or deleted.';
COMMENT ON FUNCTION public.touch_roadmap_from_feature_comment IS
  'Bumps roadmaps.updated_at when a feature comment is added, edited, or deleted.';
COMMENT ON FUNCTION public.touch_project_from_roadmap IS
  'Cascades roadmap activity (direct edits, child-table edits via the above triggers, and upsert_full_roadmap AI commits) up to projects.updated_at for dashboard/sidebar "last activity" sort.';
