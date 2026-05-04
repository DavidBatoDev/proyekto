-- Migration: 20260504000040_fix_project_shares_rls_recursion.sql
-- Date: May 4, 2026
-- Description:
--   Fixes PostgreSQL error 42P17 ("infinite recursion detected in policy")
--   when reading from `projects` or `project_shares`. Root cause: the
--   project_shares RLS policies (introduced in 20260503000050) used inline
--   EXISTS subqueries on `project_shares` itself for the admin-bypass
--   check. PG re-applies RLS to those inner queries, triggering another
--   EXISTS, recursing.
--
--   Fix: route admin/owner checks through `get_user_project_role`, which is
--   `SECURITY DEFINER` and bypasses RLS internally — same pattern the
--   `is_project_member` helper used before slice 3b removed it.

-- ============================================================================
-- Rewrite project_shares policies to use get_user_project_role
-- ============================================================================

DROP POLICY IF EXISTS project_shares_select ON public.project_shares;
DROP POLICY IF EXISTS project_shares_insert ON public.project_shares;
DROP POLICY IF EXISTS project_shares_update ON public.project_shares;
DROP POLICY IF EXISTS project_shares_delete ON public.project_shares;

-- A user can see a share row when:
--   - it grants them access (own row), OR
--   - they hold owner/admin on the same project (delegated via the
--     SECURITY DEFINER helper to avoid recursion)
CREATE POLICY project_shares_select ON public.project_shares
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.get_user_project_role(auth.uid(), project_id)
        IN ('owner', 'admin')
  );

-- Owner/admin on the project can grant new share rows.
CREATE POLICY project_shares_insert ON public.project_shares
  FOR INSERT
  WITH CHECK (
    public.get_user_project_role(auth.uid(), project_id)
      IN ('owner', 'admin')
  );

-- Owner/admin on the project can update share rows.
CREATE POLICY project_shares_update ON public.project_shares
  FOR UPDATE
  USING (
    public.get_user_project_role(auth.uid(), project_id)
      IN ('owner', 'admin')
  );

-- Owner/admin on the project can revoke share rows.
CREATE POLICY project_shares_delete ON public.project_shares
  FOR DELETE
  USING (
    public.get_user_project_role(auth.uid(), project_id)
      IN ('owner', 'admin')
  );
