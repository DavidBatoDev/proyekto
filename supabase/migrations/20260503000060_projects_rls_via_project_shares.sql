-- Migration: 20260503000060_projects_rls_via_project_shares.sql
-- Date: May 3, 2026
-- Description:
--   Repoint the `projects` table RLS policies from project_members membership
--   + client_id/consultant_id equality checks to project_shares lookups.
--
--   This is the central authorization swap in slice 2 — after this migration,
--   reads and updates on `projects` are governed by the role grants in
--   project_shares, not by legacy persona-based equality checks.
--
--   Backward compatibility: dependent tables (work_items, milestones, etc.)
--   keep their project_members-based policies in slice 2. They migrate to
--   project_shares in slice 3 along with the project_members table drop.
--   PersonalWorkspaceService and projects.repository.create() are updated in
--   slice 2 backend code to dual-write project_shares + project_members so
--   existing code paths don't break during the transition window.

-- ============================================================================
-- Drop old projects policies
-- ============================================================================

DROP POLICY IF EXISTS "Project members can view projects" ON public.projects;
DROP POLICY IF EXISTS "Project owners can update projects" ON public.projects;

-- ============================================================================
-- New SELECT policy: any role grant on the project lets the user read it.
-- ============================================================================

CREATE POLICY projects_select_via_shares
  ON public.projects
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_shares
      WHERE project_shares.project_id = projects.id
        AND project_shares.user_id = auth.uid()
    )
  );

-- ============================================================================
-- New UPDATE policy: must hold owner or admin role on the project.
-- ============================================================================

CREATE POLICY projects_update_via_shares
  ON public.projects
  FOR UPDATE
  USING (
    public.get_user_project_role(auth.uid(), projects.id) IN ('owner', 'admin')
  );

-- ============================================================================
-- DEFERRED to slice 3: roadmap helper extension.
--
-- The original get_user_roadmap_share_role(p_roadmap_id, p_user_id) defined
-- in 20260213000000_add_roadmap_sharing.sql returns TEXT. Postgres won't
-- allow CREATE OR REPLACE to change the return type to share_role, and a
-- DROP would CASCADE through policies that reference it. The cleanest path
-- is a follow-up migration in slice 3 that:
--   1) introduces a new helper with a distinct name (e.g.,
--      `get_user_roadmap_effective_role`) that consults project_shares as
--      fallback, and
--   2) migrates RLS policies that currently call the old function over to
--      the new one in lockstep, then drops the old function.
--
-- Until that lands, project owners/admins do not automatically inherit
-- roadmap-level access via project_shares. They still have access to the
-- project itself (covered above); roadmap-only public links continue to
-- work as before via roadmap_shares directly.
-- ============================================================================
