-- Migration: 20260504000020_roadmap_policies_via_project_shares.sql
-- Date: May 4, 2026
-- Description:
--   Slice 3.10b finale: migrate roadmap RLS policies from the legacy helpers
--   (`get_user_roadmap_share_role`, `has_roadmap_permission`,
--   `is_project_member`) to the new `get_user_roadmap_effective_role` helper
--   that consults `project_shares` as fallback.
--
--   Background: when slice 3b dropped `project_members`, the CASCADE took
--   out `is_project_member()` and any RLS policies that referenced it,
--   including the roadmap policies. This migration restores roadmap RLS in
--   a project_shares-native form.
--
--   Net result:
--     - Roadmap RLS uses get_user_roadmap_effective_role exclusively
--     - Project members (via project_shares) inherit roadmap access through
--       the helper's project-grant fallback
--     - Legacy helpers (get_user_roadmap_share_role TEXT-returning,
--       has_roadmap_permission, is_project_member) are dropped

-- ============================================================================
-- 1. Drop the obsolete legacy helpers (idempotent — they may already be
--    gone after the project_members CASCADE drop).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_user_roadmap_share_role(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.has_roadmap_permission(uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.is_project_member(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_project_member(uuid) CASCADE;

-- Also drop can_access_roadmap / can_edit_roadmap which depended on the
-- legacy helpers. We won't need them anymore — backend code uses the new
-- ProjectAuthorizationService for project-level checks and roadmap RLS for
-- roadmap-level checks.
DROP FUNCTION IF EXISTS public.can_access_roadmap(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.can_edit_roadmap(uuid, uuid) CASCADE;

-- ============================================================================
-- 2. Recreate roadmap RLS policies using get_user_roadmap_effective_role.
--    The new helper returns a share_role; NULL means no access.
-- ============================================================================

DROP POLICY IF EXISTS roadmaps_select ON public.roadmaps;
DROP POLICY IF EXISTS roadmaps_insert ON public.roadmaps;
DROP POLICY IF EXISTS roadmaps_update ON public.roadmaps;
DROP POLICY IF EXISTS roadmaps_delete ON public.roadmaps;

-- SELECT: roadmap owner OR effective role (any) on the roadmap
CREATE POLICY roadmaps_select ON public.roadmaps
  FOR SELECT USING (
    owner_id = auth.uid()
    OR public.get_user_roadmap_effective_role(auth.uid(), id) IS NOT NULL
  );

-- INSERT: only authenticated users can create roadmaps they own.
-- Project-attached roadmaps require the creator to have admin+ on the
-- parent project (via project_shares).
CREATE POLICY roadmaps_insert ON public.roadmaps
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND (
      project_id IS NULL
      OR public.get_user_project_role(auth.uid(), project_id) IN ('owner', 'admin')
    )
  );

-- UPDATE: roadmap owner OR effective role >= editor
CREATE POLICY roadmaps_update ON public.roadmaps
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR public.get_user_roadmap_effective_role(auth.uid(), id)
        IN ('editor', 'admin', 'owner')
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.get_user_roadmap_effective_role(auth.uid(), id)
        IN ('editor', 'admin', 'owner')
  );

-- DELETE: roadmap owner only (project owners do NOT auto-delete roadmaps —
-- they can demote the owner via project_shares but the explicit delete
-- right stays with the roadmap owner_id).
CREATE POLICY roadmaps_delete ON public.roadmaps
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================================
-- 3. Recreate the comment-table policies that previously called
--    has_roadmap_permission. Both epic_comments and feature_comments need
--    commenter+ access.
-- ============================================================================

DROP POLICY IF EXISTS epic_comments_insert ON public.epic_comments;
DROP POLICY IF EXISTS feature_comments_insert ON public.feature_comments;

CREATE POLICY epic_comments_insert ON public.epic_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.roadmap_epics e
      WHERE e.id = epic_comments.epic_id
        AND public.get_user_roadmap_effective_role(auth.uid(), e.roadmap_id)
            IN ('commenter', 'editor', 'admin', 'owner')
    )
  );

CREATE POLICY feature_comments_insert ON public.feature_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.roadmap_features f
      WHERE f.id = feature_comments.feature_id
        AND public.get_user_roadmap_effective_role(auth.uid(), f.roadmap_id)
            IN ('commenter', 'editor', 'admin', 'owner')
    )
  );
