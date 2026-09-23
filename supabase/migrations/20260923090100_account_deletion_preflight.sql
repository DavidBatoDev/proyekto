-- Account deletion, part 2 of 3: the preflight read.
--
-- Answers "what happens if I delete my account?" for the confirmation screen,
-- and defines the vocabulary that 20260923090200_delete_account.sql then
-- enforces. The two MUST agree, which is why the three predicates below are
-- functions rather than copy-pasted EXISTS clauses.
--
-- Deliberately has no "blockers" concept. Google Play requires account deletion
-- to work in the app, and the app hides billing and the marketplace entirely
-- (web/src/lib/platformSurfaces.ts), so an error of the form "cancel your
-- subscription first" would leave a phone user permanently unable to delete
-- their account. Every obstacle is therefore either a choice the user makes
-- (decisions[]) or something the flow does for them.
--
-- STABLE, so the client may re-read it freely - it is also the only status
-- oracle the web has if the connection drops mid-delete.

BEGIN;

-- == Shared predicates =======================================================

-- Mirrors LIVE_SUBSCRIPTION_STATUSES in workspaces.service.ts: money is still
-- moving. A free workspace has no provider subscription at all and is never
-- paid, which keeps this invisible to everyone who has not paid.
CREATE OR REPLACE FUNCTION public.account_deletion_workspace_is_paid(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_subscriptions s
    WHERE s.workspace_id = p_workspace_id
      AND s.provider_subscription_id IS NOT NULL
      AND s.status IN ('active','trialing','past_due','unpaid','incomplete','paused')
  );
$$;

-- payouts.team_id is ON DELETE CASCADE, so deleting a team destroys its payout
-- history - even though payouts.member_user_id and payouts.created_by are
-- RESTRICT against profiles precisely to keep those records. Deleting a
-- container is therefore refused whenever it carries payouts; the user
-- transfers it instead, or (when there is nobody to transfer to) it is archived
-- under the tombstone.
CREATE OR REPLACE FUNCTION public.account_deletion_team_has_payouts(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.payouts p WHERE p.team_id = p_team_id);
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_workspace_has_payouts(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.payouts p
    JOIN public.teams t ON t.id = p.team_id
    WHERE t.workspace_id = p_workspace_id
  );
$$;

REVOKE ALL ON FUNCTION public.account_deletion_workspace_is_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_team_has_payouts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_workspace_has_payouts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_workspace_is_paid(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_team_has_payouts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_workspace_has_payouts(uuid) TO service_role;

-- == Preflight ===============================================================

CREATE OR REPLACE FUNCTION public.account_deletion_preflight(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile   public.profiles%ROWTYPE;
  v_decisions jsonb;
  v_deleted   jsonb;
  v_transfer  jsonb;
  v_kept      jsonb;
  v_auth      jsonb;
  v_admin_warn boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;
  IF COALESCE(v_profile.is_guest, false) THEN
    -- Guest sessions expire on their own; there is no account to close.
    RAISE EXCEPTION 'ACCOUNT_IS_GUEST';
  END IF;
  IF v_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_ALREADY_DELETED';
  END IF;

  -- ---- Containers needing a decision --------------------------------------
  -- "Sole-owned with other members": the user is an owner, they are the ONLY
  -- owner, and somebody else is still in it. workspaces has no owner column -
  -- workspace_members.role is the only source, the same rule assertNotLastOwner
  -- uses.
  WITH sole AS (
    SELECT w.id, w.name, w.slug,
           (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) AS member_count
    FROM public.workspaces w
    JOIN public.workspace_members me
      ON me.workspace_id = w.id AND me.user_id = p_user_id AND me.role = 'owner'
    WHERE (SELECT count(*) FROM public.workspace_members o
             WHERE o.workspace_id = w.id AND o.role = 'owner') = 1
  ),
  ws AS (
    SELECT s.*,
           NOT (public.account_deletion_workspace_is_paid(s.id)
                OR public.account_deletion_workspace_has_payouts(s.id)) AS can_delete,
           public.account_deletion_workspace_is_paid(s.id) AS is_paid
    FROM sole s WHERE s.member_count > 1
  ),
  tm AS (
    SELECT t.id, t.name, t.workspace_id,
           (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) AS member_count,
           NOT public.account_deletion_team_has_payouts(t.id) AS can_delete
    FROM public.teams t
    WHERE t.owner_id = p_user_id
      AND COALESCE(t.is_personal, false) = false
      AND (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) > 1
  )
  SELECT COALESCE(jsonb_agg(d ORDER BY d->>'kind', d->>'name'), '[]'::jsonb) INTO v_decisions
  FROM (
    SELECT jsonb_build_object(
      'kind','workspace','id',ws.id,'name',ws.name,'slug',ws.slug,
      'member_count',ws.member_count,'can_delete',ws.can_delete,'is_paid',ws.is_paid,
      'project_count',(SELECT count(*) FROM public.projects p WHERE p.workspace_id = ws.id),
      'team_count',(SELECT count(*) FROM public.teams t WHERE t.workspace_id = ws.id),
      'candidates',(
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'user_id',pr.id,'display_name',pr.display_name,'email',pr.email,
          'avatar_url',pr.avatar_url,'role',m.role,'joined_at',m.joined_at)
          ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END, m.joined_at), '[]'::jsonb)
        FROM public.workspace_members m
        JOIN public.profiles pr ON pr.id = m.user_id
        WHERE m.workspace_id = ws.id AND m.user_id <> p_user_id AND pr.deleted_at IS NULL)
    ) AS d FROM ws
    UNION ALL
    SELECT jsonb_build_object(
      'kind','team','id',tm.id,'name',tm.name,'workspace_id',tm.workspace_id,
      'member_count',tm.member_count,'can_delete',tm.can_delete,'is_paid',false,
      'candidates',(
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'user_id',pr.id,'display_name',pr.display_name,'email',pr.email,
          'avatar_url',pr.avatar_url,'role',m.role,'joined_at',m.joined_at)
          ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END, m.joined_at), '[]'::jsonb)
        FROM public.team_members m
        JOIN public.profiles pr ON pr.id = m.user_id
        WHERE m.team_id = tm.id AND m.user_id <> p_user_id AND pr.deleted_at IS NULL)
    ) AS d FROM tm
  ) d_rows;

  -- ---- Deleted outright ----------------------------------------------------
  -- Containers only this person is in, and projects nobody else can open. A
  -- project with no other project_access row is private by definition, which is
  -- why it goes rather than being handed to a stranger.
  SELECT jsonb_build_object(
    'workspaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug))
      FROM public.workspaces w
      JOIN public.workspace_members me ON me.workspace_id = w.id AND me.user_id = p_user_id AND me.role='owner'
      WHERE (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) = 1), '[]'::jsonb),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name))
      FROM public.teams t
      WHERE t.owner_id = p_user_id
        AND NOT public.account_deletion_team_has_payouts(t.id)
        -- A personal team goes whatever its membership looks like; a shared one
        -- only when nobody else is in it (otherwise it is a decision above).
        AND (COALESCE(t.is_personal, false)
             OR (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) <= 1)), '[]'::jsonb),
    'projects', (
      SELECT count(*) FROM public.projects p
      WHERE p.owner_id = p_user_id
        AND NOT EXISTS (SELECT 1 FROM public.project_access a
                        WHERE a.project_id = p.id AND a.user_id <> p_user_id)),
    'standalone_roadmaps', (
      SELECT count(*) FROM public.roadmaps r
      WHERE r.owner_id = p_user_id AND r.project_id IS NULL),
    'devices', (SELECT count(*) FROM public.device_tokens d WHERE d.user_id = p_user_id),
    'api_tokens', (SELECT count(*) FROM public.mcp_personal_access_tokens t WHERE t.user_id = p_user_id),
    'identity_documents', (SELECT count(*) FROM public.user_identity_documents u WHERE u.user_id = p_user_id)
  ) INTO v_deleted;

  -- ---- Handed to someone else ---------------------------------------------
  -- A project with other members goes to one of ITS OWN members, never to the
  -- workspace owner: every permission helper and RLS policy reads project_access
  -- and never projects.owner_id (see 20260901154357), so granting a
  -- non-member owner access would hand a stranger a private project.
  SELECT jsonb_build_object(
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',p.id,'title',p.title))
      FROM public.projects p
      WHERE p.owner_id = p_user_id
        AND EXISTS (SELECT 1 FROM public.project_access a
                    WHERE a.project_id = p.id AND a.user_id <> p_user_id)), '[]'::jsonb),
    'workspaces_left', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug))
      FROM public.workspaces w
      JOIN public.workspace_members me ON me.workspace_id = w.id AND me.user_id = p_user_id
      WHERE me.role <> 'owner'
         OR (SELECT count(*) FROM public.workspace_members o
             WHERE o.workspace_id = w.id AND o.role='owner') > 1), '[]'::jsonb),
    'teams_left', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name))
      FROM public.teams t
      JOIN public.team_members m ON m.team_id = t.id AND m.user_id = p_user_id
      WHERE t.owner_id <> p_user_id), '[]'::jsonb)
  ) INTO v_transfer;

  -- ---- Kept, as "Deleted user" --------------------------------------------
  SELECT jsonb_build_object(
    'attribution', 'Deleted user',
    -- Teams carrying payout history with nobody left to hand them to. They are
    -- archived under the tombstone rather than deleted, because deleting a team
    -- CASCADEs its payouts away (see account_deletion_team_has_payouts).
    'archived_teams', (
      SELECT count(*) FROM public.teams t
      WHERE t.owner_id = p_user_id
        AND public.account_deletion_team_has_payouts(t.id)
        AND (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) <= 1),
    'chat_messages', (SELECT count(*) FROM public.chat_room_messages m WHERE m.sender_id = p_user_id AND m.deleted_at IS NULL),
    'comments', (SELECT (SELECT count(*) FROM public.task_comments c WHERE c.author_id = p_user_id)
                      + (SELECT count(*) FROM public.epic_comments c WHERE c.user_id = p_user_id)
                      + (SELECT count(*) FROM public.feature_comments c WHERE c.user_id = p_user_id)),
    'decisions', (SELECT count(*) FROM public.project_decisions d WHERE d.created_by = p_user_id),
    'deliverables', (SELECT count(*) FROM public.project_deliverables d WHERE d.created_by = p_user_id),
    'change_requests', (SELECT count(*) FROM public.project_change_requests r WHERE r.requested_by = p_user_id),
    'risks', (SELECT count(*) FROM public.project_risk_register r WHERE r.created_by = p_user_id),
    'activity_entries', (SELECT count(*) FROM public.project_activity_log l WHERE l.actor_id = p_user_id),
    'contracts', (SELECT count(*) FROM public.contracts c WHERE c.client_user_id = p_user_id OR c.consultant_user_id = p_user_id),
    'invoices', (SELECT count(*) FROM public.invoices i WHERE i.issuer_user_id = p_user_id OR i.recipient_user_id = p_user_id),
    'payouts', (SELECT count(*) FROM public.payouts p WHERE p.member_user_id = p_user_id OR p.created_by = p_user_id)
  ) INTO v_kept;

  -- ---- Which re-auth control the client should render ----------------------
  -- Told by the server, not sniffed client-side: a Google-only account has an
  -- empty encrypted_password and no password to check.
  SELECT jsonb_build_object(
    'has_password', COALESCE((SELECT u.encrypted_password IS NOT NULL AND u.encrypted_password <> ''
                              FROM auth.users u WHERE u.id = p_user_id), false),
    'providers', COALESCE((SELECT jsonb_agg(DISTINCT i.provider)
                           FROM auth.identities i WHERE i.user_id = p_user_id), '[]'::jsonb)
  ) INTO v_auth;

  -- A warning, never a refusal: locking yourself out of your own admin console
  -- is your call to make, and refusing would breach the Play requirement.
  SELECT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id = p_user_id AND a.is_active)
     AND (SELECT count(*) FROM public.admin_profiles a WHERE a.is_active) = 1
    INTO v_admin_warn;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'generated_at', now(),
    'decisions', v_decisions,
    'will_be_deleted', v_deleted,
    'will_transfer', v_transfer,
    'will_be_kept', v_kept,
    'auth', v_auth,
    'warnings', CASE WHEN v_admin_warn THEN '["LAST_PLATFORM_ADMIN"]'::jsonb ELSE '[]'::jsonb END,
    -- Lets the writer detect "your plan is stale" as distinct from "something
    -- broke". Covers only the decision set, because that is the only part the
    -- user acts on.
    'preflight_token', md5(v_decisions::text)
  );
END;
$$;

COMMENT ON FUNCTION public.account_deletion_preflight(uuid) IS
  'What deleting this account would do: containers needing a decision, what is deleted, what is handed on, what is kept as "Deleted user", and which re-auth control to show. Read-only; also the status oracle the web polls if the connection drops mid-delete.';

REVOKE ALL ON FUNCTION public.account_deletion_preflight(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_preflight(uuid) TO service_role;

COMMIT;
