-- Account deletion, part 3 of 3: the deletion itself.
--
-- ONE call, ONE transaction. delete_account() is the only entry point the
-- backend touches; the helpers exist so no single body is 600 unreviewable
-- lines, not as an API. Splitting this across several backend calls would make
-- "half-deleted account" a reachable state for an operation the product has
-- declared irreversible, and there is no compensating action.
--
-- The profile row is NEVER deleted - see the header of
-- 20260923090000_account_deletion_tombstone.sql for why. Everything below is
-- therefore explicit: the FK graph is inert and nothing happens by cascade from
-- profiles.
--
-- ORDER, and why it is this order:
--
--   workspaces -> teams -> projects
--
-- Purging a workspace takes its teams and projects with it, so teams and
-- projects are re-queried from live rows afterwards; anything inside a purged
-- workspace has already gone and is silently skipped rather than double-handled.
--
-- Two orderings inside that are load-bearing:
--
--   * teams.owner_id moves to the successor BEFORE the leaver's team_members
--     row is deleted. tg_team_members_block_owner_delete (20260603000003) only
--     stands down when the profile row is gone or the team is gone - under a
--     tombstone BOTH escapes evaluate false, so deleting an owner's membership
--     would raise and kill the transaction. Moving ownership first is the fix;
--     the trigger is left exactly as it is.
--   * the profile and auth scrubs run LAST, because every earlier step reads
--     profiles/auth for names and providers.
--
-- PROJECTS GO TO ONE OF THEIR OWN MEMBERS, NEVER TO THE WORKSPACE OWNER.
-- 20260901154357 says it outright: "every permission helper and RLS policy
-- reads project_access only (never projects.owner_id)". Writing owner_id alone
-- would leave the new owner unable to open the project, and minting
-- project_access for a workspace owner who was never a member would hand a
-- stranger a private project's chat, files, contracts and invoices. A project
-- with no other member is private by definition and is deleted instead.

BEGIN;

-- == Successor selection =====================================================

-- Highest share_role, then longest-standing. The share_role enum sorts
-- viewer < commenter < editor < admin < owner, so DESC is the ladder.
CREATE OR REPLACE FUNCTION public.account_deletion_project_successor(
  p_project_id uuid,
  p_exclude_user_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.user_id
  FROM public.project_access a
  JOIN public.profiles pr ON pr.id = a.user_id
  WHERE a.project_id = p_project_id
    AND a.user_id <> p_exclude_user_id
    AND pr.deleted_at IS NULL
    AND COALESCE(pr.is_guest, false) = false
  ORDER BY a.role DESC, a.granted_at NULLS LAST
  LIMIT 1;
$$;

-- == Team helpers ============================================================

CREATE OR REPLACE FUNCTION public.account_deletion_purge_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- payouts.team_id is CASCADE, so deleting a team would destroy payout
  -- history that payouts.member_user_id (RESTRICT) exists to preserve.
  IF public.account_deletion_team_has_payouts(p_team_id) THEN
    RAISE EXCEPTION 'TEAM_HAS_PAYOUTS';
  END IF;

  -- qa_fixtures.primary_team_id / secondary_team_id are RESTRICT and would
  -- fail as a bare FK error; name it instead.
  IF EXISTS (SELECT 1 FROM public.qa_fixtures q
             WHERE q.primary_team_id = p_team_id OR q.secondary_team_id = p_team_id) THEN
    RAISE EXCEPTION 'TEAM_HAS_QA_FIXTURE';
  END IF;

  -- projects.primary_team_id is NO ACTION; project_teams.team_id is RESTRICT
  -- (a team here may be attached to a project in ANOTHER workspace).
  UPDATE public.projects SET primary_team_id = NULL WHERE primary_team_id = p_team_id;
  DELETE FROM public.project_teams WHERE team_id = p_team_id;

  -- team_members cascades; tg_team_members_block_owner_delete stands down
  -- because the team row is gone by the time it fires.
  DELETE FROM public.teams WHERE id = p_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_transfer_team(
  p_user_id uuid,
  p_team_id uuid,
  p_new_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_new_owner_id IS NULL OR p_new_owner_id = p_user_id
     OR NOT EXISTS (SELECT 1 FROM public.team_members m
                    WHERE m.team_id = p_team_id AND m.user_id = p_new_owner_id) THEN
    RAISE EXCEPTION 'RESOLUTION_INVALID_NOMINEE';
  END IF;

  -- Ownership first: see the header note on tg_team_members_block_owner_delete.
  UPDATE public.teams SET owner_id = p_new_owner_id WHERE id = p_team_id;
  UPDATE public.team_members SET role = 'owner'
    WHERE team_id = p_team_id AND user_id = p_new_owner_id;
  DELETE FROM public.team_members WHERE team_id = p_team_id AND user_id = p_user_id;
END;
$$;

-- == Workspace helpers =======================================================

CREATE OR REPLACE FUNCTION public.account_deletion_purge_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team record;
BEGIN
  IF public.account_deletion_workspace_is_paid(p_workspace_id) THEN
    RAISE EXCEPTION 'WORKSPACE_HAS_ACTIVE_SUBSCRIPTION';
  END IF;
  IF public.account_deletion_workspace_has_payouts(p_workspace_id) THEN
    RAISE EXCEPTION 'WORKSPACE_HAS_PAYOUTS';
  END IF;

  -- "Delete the workspace with everything in it" is NOT what DELETE FROM
  -- workspaces does: projects.workspace_id and teams.workspace_id are SET NULL,
  -- so the plain delete orphans the work instead of destroying it. Contents go
  -- explicitly, projects first (that clears primary_team_id and project_teams
  -- by cascade, which teams then need).
  PERFORM public.account_deletion_close_running_logs_for_workspace(p_workspace_id);
  DELETE FROM public.projects WHERE workspace_id = p_workspace_id;

  FOR v_team IN SELECT id FROM public.teams WHERE workspace_id = p_workspace_id LOOP
    PERFORM public.account_deletion_purge_team(v_team.id);
  END LOOP;

  -- Cascades workspace_members, workspace_invites, workspace_subscriptions,
  -- workspace_slug_history and roadmap_ai_sessions.
  DELETE FROM public.workspaces WHERE id = p_workspace_id;
END;
$$;

-- task_time_logs.project_id is SET NULL, so a log OUTLIVES its project. A timer
-- still running when its project is destroyed would otherwise keep accruing
-- against nothing, forever.
CREATE OR REPLACE FUNCTION public.account_deletion_close_running_logs_for_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.task_time_logs l
  SET ended_at = GREATEST(now(), l.started_at + interval '1 second'),
      duration_seconds = GREATEST(0,
        EXTRACT(EPOCH FROM (GREATEST(now(), l.started_at + interval '1 second') - l.started_at))::int
        - COALESCE(l.break_seconds, 0))
  WHERE l.ended_at IS NULL
    AND l.project_id IN (SELECT id FROM public.projects WHERE workspace_id = p_workspace_id);
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_transfer_workspace(
  p_user_id uuid,
  p_workspace_id uuid,
  p_new_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_new_owner_id IS NULL OR p_new_owner_id = p_user_id
     OR NOT EXISTS (SELECT 1 FROM public.workspace_members m
                    WHERE m.workspace_id = p_workspace_id AND m.user_id = p_new_owner_id) THEN
    RAISE EXCEPTION 'RESOLUTION_INVALID_NOMINEE';
  END IF;

  -- workspaces has no owner column; workspace_members.role is the only source.
  UPDATE public.workspace_members SET role = 'owner'
    WHERE workspace_id = p_workspace_id AND user_id = p_new_owner_id;

  -- Teams and projects are settled by their own passes in delete_account, so
  -- nothing else moves here. Leaving is the last step, after the promotion, or
  -- assertNotLastOwner's invariant (never zero owners) would briefly break.
  DELETE FROM public.workspace_members
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
END;
$$;

-- == The entry point =========================================================

CREATE OR REPLACE FUNCTION public.delete_account(
  p_user_id uuid,
  p_resolution jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile      public.profiles%ROWTYPE;
  v_decisions    jsonb;
  v_decision     jsonb;
  v_choice       jsonb;
  v_id           uuid;
  v_action       text;
  v_nominee      uuid;
  v_rec          record;
  v_successor    uuid;
  v_new_email    text;
  v_rows         integer;
  v_transferred_projects int := 0;
  v_deleted_projects     int := 0;
  v_purged_workspaces    int := 0;
  v_purged_teams         int := 0;
  v_archived_teams       int := 0;
  v_storage_keys jsonb;
BEGIN
  -- ---- 1. Serialise -------------------------------------------------------
  -- Seed 2. Seed 0 is provision_personal_project AND the consultant_subcategories
  -- trigger; seed 1 is provision_default_workspace AND the marketplace_topics
  -- trigger. This also serialises against a workspace being provisioned by
  -- completeOnboarding in another request.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 2));

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF COALESCE(v_profile.is_guest, false) THEN RAISE EXCEPTION 'ACCOUNT_IS_GUEST'; END IF;
  -- Idempotent: a retry after a dropped connection must not look like a failure.
  IF v_profile.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_ALREADY_DELETED'; END IF;

  -- ---- 2. Recompute the decision set INSIDE the lock ----------------------
  -- Never trust the preflight the client saw. "The last other member left
  -- between preflight and commit" is a real race a preflight check cannot
  -- survive.
  v_decisions := public.account_deletion_preflight(p_user_id) -> 'decisions';

  FOR v_decision IN SELECT * FROM jsonb_array_elements(v_decisions) LOOP
    v_id := (v_decision ->> 'id')::uuid;
    SELECT c.value INTO v_choice
      FROM jsonb_array_elements(COALESCE(p_resolution -> 'containers', '[]'::jsonb)) c
     WHERE (c.value ->> 'id')::uuid = v_id
       AND (c.value ->> 'kind') = (v_decision ->> 'kind')
     LIMIT 1;

    IF v_choice IS NULL THEN
      RAISE EXCEPTION 'RESOLUTION_INCOMPLETE';
    END IF;

    v_action := v_choice ->> 'action';
    IF v_action NOT IN ('transfer', 'delete') THEN
      RAISE EXCEPTION 'RESOLUTION_INCOMPLETE';
    END IF;
    IF v_action = 'delete' AND NOT (v_decision ->> 'can_delete')::boolean THEN
      RAISE EXCEPTION 'CONTAINER_NOT_DELETABLE';
    END IF;
  END LOOP;

  -- Anything named that is not a live decision means the client is working from
  -- a stale plan.
  FOR v_choice IN
    SELECT c.value FROM jsonb_array_elements(COALESCE(p_resolution -> 'containers', '[]'::jsonb)) c
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_decisions) d
      WHERE (d.value ->> 'id') = (v_choice ->> 'id')
        AND (d.value ->> 'kind') = (v_choice ->> 'kind')
    ) THEN
      RAISE EXCEPTION 'RESOLUTION_UNKNOWN_CONTAINER';
    END IF;
  END LOOP;

  -- ---- 3. Workspaces ------------------------------------------------------
  FOR v_decision IN
    SELECT d.value FROM jsonb_array_elements(v_decisions) d WHERE d.value ->> 'kind' = 'workspace'
  LOOP
    v_id := (v_decision ->> 'id')::uuid;
    SELECT c.value INTO v_choice
      FROM jsonb_array_elements(p_resolution -> 'containers') c
     WHERE (c.value ->> 'id')::uuid = v_id AND (c.value ->> 'kind') = 'workspace' LIMIT 1;

    -- Step 2 already guarantees a choice exists. Re-assert it anyway: with a
    -- NULL v_choice the comparison below is NULL and control would fall to
    -- ELSE, i.e. purge. Destroying a workspace must never be the default branch.
    IF v_choice IS NULL THEN RAISE EXCEPTION 'RESOLUTION_INCOMPLETE'; END IF;

    IF (v_choice ->> 'action') = 'transfer' THEN
      v_nominee := (v_choice ->> 'new_owner_id')::uuid;
      PERFORM public.account_deletion_transfer_workspace(p_user_id, v_id, v_nominee);
    ELSE
      PERFORM public.account_deletion_purge_workspace(v_id);
      v_purged_workspaces := v_purged_workspaces + 1;
    END IF;
  END LOOP;

  -- Sole-owned with nobody else in them: no decision to make, they just go.
  FOR v_rec IN
    SELECT w.id FROM public.workspaces w
    JOIN public.workspace_members me
      ON me.workspace_id = w.id AND me.user_id = p_user_id AND me.role = 'owner'
    WHERE (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) = 1
  LOOP
    PERFORM public.account_deletion_purge_workspace(v_rec.id);
    v_purged_workspaces := v_purged_workspaces + 1;
  END LOOP;

  -- ---- 4. Teams -----------------------------------------------------------
  -- Re-queried from live rows: teams inside a workspace purged above are gone.
  FOR v_decision IN
    SELECT d.value FROM jsonb_array_elements(v_decisions) d WHERE d.value ->> 'kind' = 'team'
  LOOP
    v_id := (v_decision ->> 'id')::uuid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_id);

    SELECT c.value INTO v_choice
      FROM jsonb_array_elements(p_resolution -> 'containers') c
     WHERE (c.value ->> 'id')::uuid = v_id AND (c.value ->> 'kind') = 'team' LIMIT 1;

    -- Same reasoning as the workspace loop: never purge by falling through.
    IF v_choice IS NULL THEN RAISE EXCEPTION 'RESOLUTION_INCOMPLETE'; END IF;

    IF (v_choice ->> 'action') = 'transfer' THEN
      v_nominee := (v_choice ->> 'new_owner_id')::uuid;
      PERFORM public.account_deletion_transfer_team(p_user_id, v_id, v_nominee);
    ELSE
      PERFORM public.account_deletion_purge_team(v_id);
      v_purged_teams := v_purged_teams + 1;
    END IF;
  END LOOP;

  FOR v_rec IN SELECT t.id FROM public.teams t WHERE t.owner_id = p_user_id LOOP
    IF public.account_deletion_team_has_payouts(v_rec.id) THEN
      -- Nobody to hand it to and its payout history must survive: archive it
      -- under the tombstone rather than destroy financial records.
      UPDATE public.teams SET status = 'archived' WHERE id = v_rec.id;
      v_archived_teams := v_archived_teams + 1;
    ELSE
      PERFORM public.account_deletion_purge_team(v_rec.id);
      v_purged_teams := v_purged_teams + 1;
    END IF;
  END LOOP;

  -- ---- 5. Projects --------------------------------------------------------
  FOR v_rec IN SELECT p.id FROM public.projects p WHERE p.owner_id = p_user_id LOOP
    v_successor := public.account_deletion_project_successor(v_rec.id, p_user_id);

    IF v_successor IS NULL THEN
      -- Nobody else can open it, so it is private by definition.
      UPDATE public.task_time_logs l
        SET ended_at = GREATEST(now(), l.started_at + interval '1 second'),
            duration_seconds = GREATEST(0,
              EXTRACT(EPOCH FROM (GREATEST(now(), l.started_at + interval '1 second') - l.started_at))::int
              - COALESCE(l.break_seconds, 0))
      WHERE l.project_id = v_rec.id AND l.ended_at IS NULL;

      DELETE FROM public.projects WHERE id = v_rec.id;
      v_deleted_projects := v_deleted_projects + 1;
    ELSE
      UPDATE public.projects SET owner_id = v_successor WHERE id = v_rec.id;

      -- has_direct_grant = true is mandatory: tg_project_team_members_sync_shares
      -- garbage-collects any project_access row without it once team curation
      -- goes away (20260901154357), so a flag-false row would be one team
      -- detach from deletion.
      -- origin is NOT NULL with no default; 'direct' is the value the codebase
      -- uses for a grant that is not derived from team curation. On conflict
      -- the existing origin is left alone - only the role and the flag move.
      INSERT INTO public.project_access (project_id, user_id, role, origin, has_direct_grant, granted_by, granted_at)
      VALUES (v_rec.id, v_successor, 'owner', 'direct', true, v_successor, now())
      ON CONFLICT (project_id, user_id)
      DO UPDATE SET role = 'owner', has_direct_grant = true;

      UPDATE public.roadmaps SET owner_id = v_successor
        WHERE project_id = v_rec.id AND owner_id = p_user_id;
      UPDATE public.finance_books SET owner_user_id = v_successor
        WHERE project_id = v_rec.id AND owner_user_id = p_user_id;

      v_transferred_projects := v_transferred_projects + 1;
    END IF;
  END LOOP;

  -- Roadmaps with no project are personal scratch space.
  DELETE FROM public.roadmaps WHERE owner_id = p_user_id AND project_id IS NULL;

  -- ---- 6. Collect the object-store keys BEFORE the rows go ---------------
  SELECT jsonb_build_object(
    'avatar_url', v_profile.avatar_url,
    'banner_url', v_profile.banner_url,
    'portfolio', COALESCE((SELECT jsonb_agg(u.image_url) FROM public.user_portfolios u
                           WHERE u.user_id = p_user_id AND u.image_url IS NOT NULL), '[]'::jsonb),
    'identity_documents', COALESCE((SELECT jsonb_agg(d.storage_path) FROM public.user_identity_documents d
                                    WHERE d.user_id = p_user_id AND d.storage_path IS NOT NULL), '[]'::jsonb)
  ) INTO v_storage_keys;

  -- ---- 7. Personal rows ---------------------------------------------------
  DELETE FROM public.workspace_members       WHERE user_id = p_user_id;
  DELETE FROM public.team_members            WHERE user_id = p_user_id;
  DELETE FROM public.project_team_members    WHERE user_id = p_user_id;
  DELETE FROM public.project_access          WHERE user_id = p_user_id;
  DELETE FROM public.chat_room_participants  WHERE user_id = p_user_id;
  DELETE FROM public.chat_room_stars         WHERE user_id = p_user_id;
  DELETE FROM public.chat_room_notification_prefs WHERE user_id = p_user_id;
  DELETE FROM public.meeting_participants    WHERE user_id = p_user_id;
  DELETE FROM public.deliverable_reviewers   WHERE reviewer_id = p_user_id;
  DELETE FROM public.roadmap_task_assignees  WHERE assignee_id = p_user_id;
  DELETE FROM public.roadmap_feature_assignees WHERE assignee_id = p_user_id;
  DELETE FROM public.finance_book_members    WHERE user_id = p_user_id;
  DELETE FROM public.finance_member_allocations WHERE user_id = p_user_id;

  DELETE FROM public.project_invites         WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  DELETE FROM public.workspace_invites       WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  DELETE FROM public.team_invites            WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  DELETE FROM public.project_team_invites    WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  -- pending_mention_invites matches on invitee_email with no invitee_id guard
  -- and no freshness window, so revoke rather than rely on that.
  UPDATE public.pending_mention_invites SET status = 'revoked'
    WHERE invited_by = p_user_id AND status = 'pending';
  UPDATE public.pending_mention_invites SET status = 'revoked'
    WHERE lower(invitee_email) = lower(COALESCE(v_profile.email, '')) AND status = 'pending';

  DELETE FROM public.notifications           WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.notification_email_settings WHERE user_id = p_user_id;
  -- resolveRecipient prefers the frozen to_email, so a queued row would be
  -- delivered to the real address after deletion.
  DELETE FROM public.notification_email_outbox WHERE user_id = p_user_id;

  DELETE FROM public.device_tokens           WHERE user_id = p_user_id;
  DELETE FROM public.mcp_personal_access_tokens WHERE user_id = p_user_id;
  DELETE FROM public.mcp_oauth_grants        WHERE user_id = p_user_id;
  DELETE FROM public.google_calendar_connections WHERE user_id = p_user_id;
  DELETE FROM public.payout_methods          WHERE user_id = p_user_id;
  DELETE FROM public.wallets                 WHERE user_id = p_user_id;

  DELETE FROM public.user_certifications     WHERE user_id = p_user_id;
  DELETE FROM public.user_educations         WHERE user_id = p_user_id;
  DELETE FROM public.user_experiences        WHERE user_id = p_user_id;
  DELETE FROM public.user_languages          WHERE user_id = p_user_id;
  DELETE FROM public.user_licenses           WHERE user_id = p_user_id;
  DELETE FROM public.user_portfolios         WHERE user_id = p_user_id;
  DELETE FROM public.user_rate_settings      WHERE user_id = p_user_id;
  DELETE FROM public.user_skills             WHERE user_id = p_user_id;
  DELETE FROM public.user_specializations    WHERE user_id = p_user_id;
  DELETE FROM public.user_stats              WHERE user_id = p_user_id;
  DELETE FROM public.user_tour_progress      WHERE user_id = p_user_id;
  DELETE FROM public.user_verifications      WHERE user_id = p_user_id;
  DELETE FROM public.user_identity_documents WHERE user_id = p_user_id;

  DELETE FROM public.consultant_applications WHERE user_id = p_user_id;
  DELETE FROM public.consultant_subcategories WHERE user_id = p_user_id;
  DELETE FROM public.consultant_topics       WHERE user_id = p_user_id;
  DELETE FROM public.marketplace_survey_responses WHERE user_id = p_user_id;
  DELETE FROM public.marketplace_survey_categories WHERE user_id = p_user_id;
  DELETE FROM public.admin_profiles          WHERE user_id = p_user_id;
  DELETE FROM public.personal_projects       WHERE user_id = p_user_id;

  -- password_resets has NO FK at all, so nothing would ever clean it, and an
  -- outstanding code would otherwise set a working password on the tombstone
  -- (confirmPasswordReset reads user_id and never re-checks the account).
  DELETE FROM public.password_resets         WHERE user_id = p_user_id;
  IF v_profile.email IS NOT NULL THEN
    DELETE FROM public.password_resets       WHERE lower(email) = lower(v_profile.email);
    DELETE FROM public.email_verification_codes WHERE lower(email) = lower(v_profile.email);
  END IF;
  DELETE FROM public.account_deletion_challenges WHERE user_id = p_user_id;

  -- ---- 8. Retained privilege and public presence --------------------------
  -- Nothing is deleted, so is_admin() and is_active_consultant() would keep
  -- returning true. consultant_profiles/talent_profiles are RESTRICT-bound and
  -- cannot be deleted, so status is the only available lever.
  UPDATE public.consultant_profiles SET status = 'revoked'  WHERE user_id = p_user_id;
  UPDATE public.talent_profiles     SET status = 'paused'   WHERE user_id = p_user_id;
  UPDATE public.service_offerings   SET status = 'archived' WHERE user_id = p_user_id;
  UPDATE public.project_postings    SET status = 'closed'   WHERE author_id = p_user_id;
  DELETE FROM public.project_posting_proposals
    WHERE consultant_id = p_user_id AND status NOT IN ('accepted', 'declined', 'withdrawn');
  -- roadmap_shares carry a share_token: live bearer credentials this user
  -- minted. Deactivate rather than delete so history still resolves.
  UPDATE public.roadmap_shares SET is_active = false WHERE created_by = p_user_id;

  -- Retained snapshot that a profiles scrub never reaches.
  UPDATE public.task_time_logs SET member_display_name_snapshot = 'Deleted user'
    WHERE member_user_id = p_user_id AND member_display_name_snapshot IS NOT NULL;

  -- ---- 9. Scrub the profile ----------------------------------------------
  -- The email is rotated, not nulled: profiles_email_required_for_non_guests
  -- forbids NULL for a non-guest, and setting is_guest instead would arm the
  -- guest auth header AND cleanup_old_guest_users. Lowercase because
  -- profiles_email_key is a plain UNIQUE while every lookup uses ilike, and
  -- not derived from the old address because a hash of an email is still
  -- personal data.
  v_new_email := 'deleted+' || replace(p_user_id::text, '-', '') || '@deleted.invalid';

  UPDATE public.profiles SET
    email                  = v_new_email,
    display_name           = 'Deleted user',
    first_name             = 'Deleted',
    last_name              = 'user',
    avatar_url             = NULL,
    banner_url             = NULL,
    bio                    = NULL,
    headline               = NULL,
    gender                 = NULL,
    phone_number           = NULL,
    country                = NULL,
    city                   = NULL,
    zip_code               = NULL,
    date_of_birth          = NULL,
    migrated_from_guest_id = NULL,
    settings               = '{}'::jsonb,
    tutorials_completed    = '{}'::jsonb,
    is_email_verified      = false,
    deleted_at             = now(),
    updated_at             = now()
  WHERE id = p_user_id;

  -- ---- 10. Scrub the auth row --------------------------------------------
  -- There is no admin API to delete an identity (unlinkIdentity is user-scoped
  -- and refuses the last one), and GoTrue resolves an OIDC login through
  -- auth.identities (provider, provider_id) - so rotating the email alone would
  -- leave the account resurrectable by tapping "Sign in with Google".
  --
  -- banned_until is a finite far-future date, not 'infinity': GoTrue scans that
  -- column into a Go time.Time and infinity is a Postgres-only value.
  UPDATE auth.users SET
    email                      = v_new_email,
    phone                      = NULL,
    encrypted_password         = '',
    email_change               = '',
    phone_change               = '',
    confirmation_token         = '',
    recovery_token             = '',
    email_change_token_new     = '',
    email_change_token_current = '',
    reauthentication_token     = '',
    email_confirmed_at         = NULL,
    phone_confirmed_at         = NULL,
    raw_user_meta_data         = '{}'::jsonb,
    raw_app_meta_data          = jsonb_build_object('provider', 'deleted', 'providers', '[]'::jsonb),
    banned_until               = now() + interval '100 years',
    updated_at                 = now()
  WHERE id = p_user_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- Not decoration. If this function is ever owned by a role without bypassrls
  -- the UPDATE silently matches zero rows and the account stays fully usable
  -- while the API returns 200. Fail loudly and roll the whole thing back.
  IF v_rows <> 1 THEN RAISE EXCEPTION 'AUTH_SCRUB_FAILED'; END IF;

  DELETE FROM auth.identities           WHERE user_id = p_user_id;
  DELETE FROM auth.sessions             WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens       WHERE user_id = p_user_id::text;
  DELETE FROM auth.mfa_factors          WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_recovery_code_sets WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens      WHERE user_id = p_user_id;
  DELETE FROM auth.flow_state           WHERE user_id = p_user_id;
  DELETE FROM auth.oauth_consents       WHERE user_id = p_user_id;
  DELETE FROM auth.oauth_authorizations WHERE user_id = p_user_id;
  DELETE FROM auth.webauthn_credentials WHERE user_id = p_user_id;
  DELETE FROM auth.webauthn_challenges  WHERE user_id = p_user_id;
  DELETE FROM auth.scim_users           WHERE user_id = p_user_id;

  -- ---- 11. Audit + summary ------------------------------------------------
  INSERT INTO public.account_deletions (user_id, resolution, summary, storage_status)
  VALUES (p_user_id, COALESCE(p_resolution, '{}'::jsonb),
    jsonb_build_object(
      'purged_workspaces', v_purged_workspaces,
      'purged_teams', v_purged_teams,
      'archived_teams', v_archived_teams,
      'transferred_projects', v_transferred_projects,
      'deleted_projects', v_deleted_projects),
    'pending')
  ON CONFLICT (user_id) DO UPDATE SET deleted_at = now();

  RETURN jsonb_build_object(
    'deleted', true,
    'user_id', p_user_id,
    'summary', jsonb_build_object(
      'purged_workspaces', v_purged_workspaces,
      'purged_teams', v_purged_teams,
      'archived_teams', v_archived_teams,
      'transferred_projects', v_transferred_projects,
      'deleted_projects', v_deleted_projects),
    'storage_keys', v_storage_keys
  );
END;
$$;

COMMENT ON FUNCTION public.delete_account(uuid, jsonb) IS
  'Irreversibly deletes an account in one transaction: settles owned workspaces, teams and projects per the resolution, purges personal rows, revokes retained privilege, then tombstones the profile and disables the auth row. The profile row is deliberately retained as an attribution target - see 20260923090000.';

REVOKE ALL ON FUNCTION public.account_deletion_project_successor(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_purge_team(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_transfer_team(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_purge_workspace(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_close_running_logs_for_workspace(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_transfer_workspace(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_account(uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.account_deletion_project_successor(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_purge_team(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_transfer_team(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_purge_workspace(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_close_running_logs_for_workspace(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_transfer_workspace(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_account(uuid, jsonb) TO service_role;

COMMIT;
