-- Harden direct PostgREST writes on the rows that grant membership and the
-- rows that plan limits read.
--
-- Supabase's default privileges give anon and authenticated full DML on every
-- public table, so an RLS UPDATE/INSERT policy is live over PostgREST for any
-- signed-in user holding the public anon key and their own JWT. Several of
-- those policies never pin the columns that matter. 20260922120000 closed this
-- for workspaces only; these holes stayed open, and all of them are live in
-- production today (authenticated holds INSERT/UPDATE/DELETE/TRUNCATE on every
-- table below there too):
--
--   * Invite takeover (pre-existing, critical). workspace_invites_update checks
--     only (invitee_id = auth.uid() OR can_manage_workspace) on both sides, so
--     an invitee can PATCH their own pending invite to
--     {workspace_id: <any workspace>, role: 'owner'} and then accept it through
--     the API. WorkspacesService.respondInvite takes workspace_id and role from
--     the stored row, so the invitee joins a workspace nobody invited them to,
--     as owner. team_invites_update and "Invitee can update invite status" on
--     project_invites have the same shape, and TeamsService.respondInvite /
--     ProjectsService.respondInvite trust team_id / project_id the same way
--     (join any team with the stored role; editor on any project).
--
--   * Plan scope rewrites. entitlement_subject and workspace_usage_counts read
--     projects.workspace_id, teams.workspace_id, teams.is_personal,
--     roadmaps.project_id and roadmaps.owner_id. projects_update_via_shares and
--     teams_update have no WITH CHECK and roadmaps_update does not look at
--     project_id or owner_id, so a project admin or team owner could null
--     workspace_id to drop out of the Free count (repeatable: unlimited
--     projects), point it at a known Pro workspace to unlock its features, or
--     plant projects and teams in a stranger's workspace (the INSERT policies
--     check only owner_id) to fill its quota and block the victim's own
--     creates. A roadmap editor could re-link a roadmap to any project, or hand
--     it to another owner whose default workspace is paid.
--
--   * Node limit. roadmap_epics / roadmap_features / roadmap_tasks INSERT
--     policies check only can_edit_roadmap, so an editor could add node 251 and
--     beyond directly; UPDATE could re-parent nodes into another roadmap. The
--     SECURITY INVOKER upsert_full_roadmap RPC was a second bulk path under the
--     same RLS.
--
--   * Self-granted guest exemption. "Users can update own profile" has no
--     column limit, so a real account could set its own profiles.is_guest
--     (and guest_session_id, which the guest header path treats as a bearer
--     secret). entitlement_subject and WorkspacesService.isGuest trust that
--     flag.
--
-- Fixes:
--
--   1. REVOKE client writes on the invite and membership tables. SELECT stays,
--      so the existing select policies still scope reads; the update policies
--      stay as dormant documentation (the workspaces pattern).
--   2. SECURITY INVOKER guard triggers keyed on current_user, the
--      workspaces_discount_guard pattern: anon/authenticated may not insert
--      projects or teams, change their workspace_id (or teams.is_personal), or
--      change roadmaps.project_id / owner_id; they may not insert a guest
--      profile or change is_guest / guest_session_id. Every other column stays
--      writable under the existing policies.
--   3. REVOKE INSERT/UPDATE on the node tables (SELECT and DELETE unchanged),
--      and EXECUTE on upsert_full_roadmap plus two dead SECURITY DEFINER RPCs
--      that write the guarded columns as their owner (link_roadmap_to_project
--      re-links roadmaps, get_or_create_default_project inserts projects for
--      any user id; both were callable by anon).
--
-- Why this is safe: the backend writes every one of these tables with the
-- service-role client (SUPABASE_ADMIN; the anon SUPABASE_CLIENT is used only by
-- the auth guard), and web/, realtime/ and agent/ never write them through
-- PostgREST (the web only subscribes to node tables for realtime and calls no
-- RPCs). The web does write profiles (signup/callback upserts, verify.tsx,
-- profile edits), but never is_guest or guest_session_id, so profiles keeps its
-- grants and only those two columns are guarded. Guests are created by
-- create_guest_user and new users by handle_new_user, both SECURITY DEFINER, so
-- current_user inside them is the owner and the guards do not fire; the
-- profile-reconciliation triggers that touch workspace_invites are DEFINER too.
-- No SECURITY INVOKER function reachable by authenticated writes a guarded
-- column (tg_project_teams_sync_primary only sets projects.primary_team_id).
--
-- Independent of 20260922120000: nothing here reads the plan-limit objects,
-- so it applies cleanly with or without that migration.

BEGIN;

-- ── 1. Invites and membership rows ─────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.workspace_invites,
  public.workspace_members,
  public.workspace_subscriptions,
  public.team_invites,
  public.project_invites
FROM anon, authenticated;

-- ── 2. Guard triggers on plan-scope inputs ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.plan_scope_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Projects and teams are created through the Proyekto API'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Workspace placement is managed by the Proyekto API'
      USING ERRCODE = '42501';
  END IF;

  -- Nested so NEW.is_personal is only read on teams rows.
  IF TG_TABLE_NAME = 'teams' THEN
    IF NEW.is_personal IS DISTINCT FROM OLD.is_personal THEN
      RAISE EXCEPTION 'Workspace placement is managed by the Proyekto API'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.plan_scope_row_guard() IS
  'Rejects anon/authenticated inserts into projects and teams and any change to their workspace_id (or teams.is_personal): the plan-limit scope and counts read these columns. The API writes them as service_role.';

DROP TRIGGER IF EXISTS trg_projects_plan_scope_guard ON public.projects;
CREATE TRIGGER trg_projects_plan_scope_guard
BEFORE INSERT OR UPDATE OF workspace_id
ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.plan_scope_row_guard();

DROP TRIGGER IF EXISTS trg_teams_plan_scope_guard ON public.teams;
CREATE TRIGGER trg_teams_plan_scope_guard
BEFORE INSERT OR UPDATE OF workspace_id, is_personal
ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.plan_scope_row_guard();

CREATE OR REPLACE FUNCTION public.roadmaps_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.project_id IS DISTINCT FROM OLD.project_id
          OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    RAISE EXCEPTION 'Roadmap project links and ownership are managed by the Proyekto API'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.roadmaps_scope_guard() IS
  'Rejects anon/authenticated changes to roadmaps.project_id and owner_id, which decide the workspace a roadmap''s node limit comes from. roadmaps_insert already restricts project_id on insert.';

DROP TRIGGER IF EXISTS trg_roadmaps_scope_guard ON public.roadmaps;
CREATE TRIGGER trg_roadmaps_scope_guard
BEFORE UPDATE OF project_id, owner_id
ON public.roadmaps
FOR EACH ROW
EXECUTE FUNCTION public.roadmaps_scope_guard();

CREATE OR REPLACE FUNCTION public.profiles_guest_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       (TG_OP = 'INSERT' AND (COALESCE(NEW.is_guest, false) OR NEW.guest_session_id IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (NEW.is_guest, NEW.guest_session_id)
                             IS DISTINCT FROM (OLD.is_guest, OLD.guest_session_id))
  ) THEN
    RAISE EXCEPTION 'Guest status is managed by Proyekto'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guest_columns_guard() IS
  'Rejects anon/authenticated writes that set or change profiles.is_guest / guest_session_id. Guests come from the SECURITY DEFINER create_guest_user; every other profile column stays self-editable.';

DROP TRIGGER IF EXISTS trg_profiles_guest_columns_guard ON public.profiles;
CREATE TRIGGER trg_profiles_guest_columns_guard
BEFORE INSERT OR UPDATE OF is_guest, guest_session_id
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_guest_columns_guard();

-- Trigger functions need no EXECUTE for the firing role; keep them off the RPC
-- surface like workspaces_discount_guard.
REVOKE ALL ON FUNCTION public.plan_scope_row_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roadmaps_scope_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_guest_columns_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_scope_row_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.roadmaps_scope_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.profiles_guest_columns_guard() TO service_role;

-- ── 3. Roadmap nodes and the RPCs that write guarded columns ────────────────
-- SELECT (realtime subscriptions) and DELETE stay as they are. The node RLS
-- policies stay as dormant documentation.

REVOKE INSERT, UPDATE, TRUNCATE ON TABLE
  public.roadmap_epics,
  public.roadmap_features,
  public.roadmap_tasks
FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_full_roadmap(uuid, uuid, jsonb, boolean, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_roadmap_to_project(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_default_project(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_full_roadmap(uuid, uuid, jsonb, boolean, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.link_roadmap_to_project(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_default_project(uuid, text) TO service_role;

COMMIT;
