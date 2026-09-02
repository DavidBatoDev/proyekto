-- Workspace: the top-level organizational and billing boundary.
--
-- Teams and projects live inside a workspace; workspace_members is the seat
-- pool. This is deliberately NOT an authorization layer: project access stays
-- exclusively project_access + resolvePermissions, and workspace membership
-- never implies project membership. A consultant delivering work inside a
-- client's project is a project_access row, not a workspace seat.
--
-- Ownership is workspace_members.role = 'owner' rather than an owner_id column,
-- so a workspace can have several owners and there is only one place to look.
-- created_by is audit metadata (ON DELETE SET NULL) so an organization outlives
-- the person who registered it.

BEGIN;

-- ── workspaces ──────────────────────────────────────────────────────────────
-- No slug column: URLs are pathless today (routes carry no tenant segment), so
-- a slug would add a uniqueness and rename surface with no consumer. Add one in
-- an expand migration if routing ever needs it.

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  avatar_url text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_name_not_blank
    CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT workspaces_name_length
    CHECK (char_length(name) <= 120),
  CONSTRAINT workspaces_description_length
    CHECK (description IS NULL OR char_length(description) <= 2000)
);

COMMENT ON TABLE public.workspaces IS
  'Top-level organizational and billing boundary. Contains teams, projects, and the member seat pool. Never an authorization source for project data.';
COMMENT ON COLUMN public.workspaces.created_by IS
  'Audit only: the profile that registered the workspace. Ownership is workspace_members.role = ''owner''.';

-- ── workspace_members ───────────────────────────────────────────────────────
-- The seat pool. UNIQUE (workspace_id, user_id) is the natural seat-count key;
-- seats-used is always COUNT(*) over this table, never a stored counter.

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_workspace_user_unique
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
  ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id
  ON public.workspace_members(workspace_id);

COMMENT ON TABLE public.workspace_members IS
  'Workspace membership and the billable seat pool. Independent of team_members and project_access.';

-- ── workspace_subscriptions ─────────────────────────────────────────────────
-- Billing scaffold only: no payment-processor fields, no seat enforcement, and
-- deliberately no seat-count column (derived from workspace_members).

CREATE TABLE IF NOT EXISTS public.workspace_subscriptions (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'business', 'enterprise')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  seat_limit integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_subscriptions_seat_limit_positive
    CHECK (seat_limit IS NULL OR seat_limit > 0)
);

COMMENT ON TABLE public.workspace_subscriptions IS
  'Per-workspace plan scaffold. Seats used is always COUNT(workspace_members); seat_limit NULL means unlimited and nothing enforces it yet.';

-- ── Membership predicates ───────────────────────────────────────────────────
-- SECURITY DEFINER for the same reason is_team_member (20260901160000) is: the
-- body runs with the owner's rights and so is not subject to RLS on
-- workspace_members, which is what keeps the policies below from recursing.
-- Policies must call these helpers and never inline an EXISTS over
-- workspace_members.

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id
  );
$$;

COMMENT ON FUNCTION public.is_workspace_member(uuid, uuid) IS
  'True when the user holds any workspace_members row. SECURITY DEFINER so RLS policies can call it without recursing.';

CREATE OR REPLACE FUNCTION public.can_manage_workspace(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
      AND m.role IN ('owner', 'admin')
  );
$$;

COMMENT ON FUNCTION public.can_manage_workspace(uuid, uuid) IS
  'True for a workspace owner or admin. Mirrors WorkspacesService.assertCanManageWorkspace.';

CREATE OR REPLACE FUNCTION public.is_workspace_owner(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id
      AND m.role = 'owner'
  );
$$;

COMMENT ON FUNCTION public.is_workspace_owner(uuid, uuid) IS
  'True only for a workspace owner. Mirrors WorkspacesService.assertOwner.';

-- ── updated_at triggers ─────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER trg_workspaces_updated_at
BEFORE UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_workspace_subscriptions_updated_at ON public.workspace_subscriptions;
CREATE TRIGGER trg_workspace_subscriptions_updated_at
BEFORE UPDATE ON public.workspace_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Writes are service-role only: the API is the authorization path (the backend
-- uses the service-role client and enforces roles in WorkspacesService). These
-- policies exist so direct-from-browser Supabase reads stay scoped.

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspaces_select ON public.workspaces;
CREATE POLICY workspaces_select
ON public.workspaces
FOR SELECT
USING (public.is_workspace_member(id, auth.uid()));

DROP POLICY IF EXISTS workspaces_update ON public.workspaces;
CREATE POLICY workspaces_update
ON public.workspaces
FOR UPDATE
USING (public.can_manage_workspace(id, auth.uid()))
WITH CHECK (public.can_manage_workspace(id, auth.uid()));

DROP POLICY IF EXISTS workspaces_delete ON public.workspaces;
CREATE POLICY workspaces_delete
ON public.workspaces
FOR DELETE
USING (public.is_workspace_owner(id, auth.uid()));

-- INSERT is intentionally service-role only; POST /workspaces enforces authz.

DROP POLICY IF EXISTS workspace_members_select ON public.workspace_members;
CREATE POLICY workspace_members_select
ON public.workspace_members
FOR SELECT
USING (public.is_workspace_member(workspace_id, auth.uid()));

-- INSERT/UPDATE/DELETE are service-role only; the members API enforces the
-- owner-only role grants and the last-owner guard.

DROP POLICY IF EXISTS workspace_subscriptions_select ON public.workspace_subscriptions;
CREATE POLICY workspace_subscriptions_select
ON public.workspace_subscriptions
FOR SELECT
USING (public.can_manage_workspace(workspace_id, auth.uid()));

-- ── Grants ──────────────────────────────────────────────────────────────────

REVOKE ALL ON TABLE public.workspaces FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.workspaces TO authenticated;
GRANT ALL ON TABLE public.workspaces TO service_role;

REVOKE ALL ON TABLE public.workspace_members FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.workspace_members TO authenticated;
GRANT ALL ON TABLE public.workspace_members TO service_role;

REVOKE ALL ON TABLE public.workspace_subscriptions FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.workspace_subscriptions TO authenticated;
GRANT ALL ON TABLE public.workspace_subscriptions TO service_role;

COMMIT;
