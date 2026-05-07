-- Migration: 20260507000040_project_briefs_rls_via_project_access.sql
-- Date: May 7, 2026
-- Description:
--   Recreate the SELECT/INSERT/UPDATE RLS policies on `project_briefs`.
--   The original policies (from 20260228203000_create_project_briefs.sql)
--   referenced the legacy `project_members` table, which was dropped
--   CASCADE in 20260504000010_drop_project_members.sql. The cascade
--   silently removed the dependent policies, leaving `project_briefs`
--   with RLS enabled but zero permissive policies, so every write
--   returned 403 even for the project owner. This restores the same
--   semantics against the current `project_access` table (renamed from
--   `project_shares` in 20260507000020). DELETE remains owner-only.

-- Defensive drops in case partial state exists.
DROP POLICY IF EXISTS "Project members can view project briefs" ON public.project_briefs;
DROP POLICY IF EXISTS "Project members can update project briefs" ON public.project_briefs;
DROP POLICY IF EXISTS "Project members can insert project briefs" ON public.project_briefs;

-- SELECT: any user with an access row, plus the project's client/consultant of record.
CREATE POLICY "Project members can view project briefs" ON public.project_briefs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_briefs.project_id
        AND pa.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_briefs.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
  );

-- INSERT: only access roles that can edit content can create the brief
-- row. Restricting WITH CHECK to editor-or-higher (and to the project's
-- client/consultant) prevents viewers/commenters from upserting a fresh
-- row to bypass UPDATE gating on a non-existent row.
CREATE POLICY "Project members can insert project briefs" ON public.project_briefs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_briefs.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_briefs.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
  );

-- UPDATE: same edit gate as INSERT. USING controls which rows are
-- visible for update; WITH CHECK keeps the user from rewriting
-- project_id to escape their own access scope.
CREATE POLICY "Project members can update project briefs" ON public.project_briefs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_briefs.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_briefs.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_access pa
      WHERE pa.project_id = project_briefs.project_id
        AND pa.user_id = auth.uid()
        AND pa.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_briefs.project_id
        AND (p.client_id = auth.uid() OR p.consultant_id = auth.uid())
    )
  );
