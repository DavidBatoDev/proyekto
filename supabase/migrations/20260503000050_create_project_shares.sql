-- Migration: 20260503000050_create_project_shares.sql
-- Date: May 3, 2026
-- Description:
--   Create the project_shares table — the source of truth for project
--   authorization in the IAM-style refactor (see specs/platform-foundations).
--
--   Each row grants a single user (`user_id`) a role on a single project
--   (`project_id`). Roles use the existing `share_role` enum, extended in
--   20260503000040 with 'admin' and 'owner'.
--
--   Origin metadata: `origin` records WHERE the role grant came from
--   (client posting, consultant assignment, manual invite, personal-workspace
--   provisioning) for analytics and debugging. It NEVER affects authorization
--   decisions — those go through role + capabilities.
--
--   Capabilities: small set of explicit overrides for cases where the
--   role-default is wrong (e.g., an admin who shouldn't see billing). Stored
--   as JSONB for flexibility. Add new keys only when concrete need arises.

CREATE TABLE public.project_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role share_role NOT NULL,
  origin text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by uuid REFERENCES public.profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX idx_project_shares_user ON public.project_shares (user_id);
CREATE INDEX idx_project_shares_project ON public.project_shares (project_id);

COMMENT ON TABLE public.project_shares IS 'Source of truth for project authorization. Each row grants a single user a single role on a single project. Origin metadata is for analytics only and does not affect authz.';
COMMENT ON COLUMN public.project_shares.role IS 'owner > admin > editor > commenter > viewer (hierarchy enforced by get_user_project_role and service-layer assertRole).';
COMMENT ON COLUMN public.project_shares.origin IS 'Where the grant came from: client | consultant | invited | personal_workspace. Never affects authz.';
COMMENT ON COLUMN public.project_shares.capabilities IS 'Small explicit-override flag set: { can_manage_billing, can_manage_members, can_export }. Defaults derive from role.';

-- ============================================================================
-- get_user_project_role(uid, project_id) → share_role | null
--
-- Returns the role of a user on a project, or NULL if no grant exists.
-- Used by RLS policies and the TypeScript ProjectAuthorizationService.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_project_role(
  uid uuid,
  project uuid
)
RETURNS share_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.project_shares
  WHERE user_id = uid AND project_id = project
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_user_project_role(uuid, uuid) IS 'Returns the user role on a project from project_shares, or NULL. Used by RLS policies and backend authorization.';

-- ============================================================================
-- Row Level Security on project_shares
--
-- - SELECT: a row is visible to its own user_id, or to anyone with admin+
--   on the same project.
-- - INSERT/UPDATE/DELETE: only owner+admin on the project can mutate share
--   rows (i.e., only people who can manage members can grant or revoke).
-- ============================================================================

ALTER TABLE public.project_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_shares_select ON public.project_shares
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_shares.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner', 'admin')
    )
  );

CREATE POLICY project_shares_insert ON public.project_shares
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_shares.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner', 'admin')
    )
  );

CREATE POLICY project_shares_update ON public.project_shares
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_shares.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner', 'admin')
    )
  );

CREATE POLICY project_shares_delete ON public.project_shares
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_shares ps
      WHERE ps.project_id = project_shares.project_id
        AND ps.user_id = auth.uid()
        AND ps.role IN ('owner', 'admin')
    )
  );
