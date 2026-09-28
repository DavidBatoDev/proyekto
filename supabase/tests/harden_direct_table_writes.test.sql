-- Tests for 20260922130000_harden_direct_table_writes.sql: a browser session
-- (anon / authenticated over PostgREST) can no longer rewrite invites, write
-- membership or subscription rows, move projects/teams/roadmaps between plan
-- scopes, plant projects or teams, write roadmap nodes, call the node-writing
-- RPCs, or set its own guest flag; ordinary self-service writes (own profile
-- names, project/team/roadmap titles) still work; and service_role, the API's
-- only write path, can still do all of it.
--
-- Run on hosted development (execute_sql). Every fixture, grant and role
-- switch rolls back. Assertions RAISE, so any error output is a failing test
-- and a clean run returns nothing.
begin;

create function pg_temp.check(p_ok boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_msg;
  end if;
end;
$$;

-- Runs p_sql as p_role (with p_uid as the JWT subject when given) and requires
-- it to fail with 42501 and a message LIKE p_errm. The failed statement's
-- subtransaction rolls back the role switch and the claims with it.
create function pg_temp.expect_denied(p_role text, p_uid uuid, p_sql text, p_msg text, p_errm text)
returns void
language plpgsql as $$
begin
  begin
    perform set_config('request.jwt.claims',
      coalesce(json_build_object('sub', p_uid, 'role', p_role)::text, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql;
  exception when others then
    if sqlstate <> '42501' or sqlerrm not like p_errm then
      raise exception 'ASSERTION FAILED: % (expected 42501 like "%", got %: %)',
        p_msg, p_errm, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERTION FAILED: % (statement succeeded as %)', p_msg, p_role;
end;
$$;

-- Runs p_sql as authenticated with p_uid as the JWT subject and returns the
-- affected row count, then restores the role.
create function pg_temp.run_as_user(p_uid uuid, p_sql text) returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  get diagnostics v_count = row_count;
  execute 'reset role';
  return v_count;
end;
$$;

do $$
declare
  v_user uuid;         -- the browser session under test (a real dev profile)
  v_other uuid;        -- inviter, and owner of the fixtures v_user must not reach
  v_ws_own uuid;       -- v_user's workspace
  v_ws_victim uuid;    -- a workspace v_user is not in
  v_ws_invite uuid; v_team_invite uuid; v_project_invite uuid;
  v_project uuid;      -- v_user holds owner access, so projects_update_via_shares passes
  v_other_project uuid;
  v_team uuid; v_other_team uuid;
  v_roadmap uuid; v_epic uuid; v_feature uuid; v_task uuid;
  v_guest uuid;
  v_count integer;
  v_sig text;
begin
  -- ── Fixture people (existing dev profiles; nothing is created in auth) ──
  -- No personal team yet, so the service_role case can reclassify v_team
  -- (teams_one_personal_per_owner).
  select p.id into strict v_user
  from public.profiles p
  where p.is_guest = false and p.guest_session_id is null and p.email is not null
    and not exists (select 1 from public.teams t where t.owner_id = p.id and t.is_personal)
  order by p.created_at, p.id
  limit 1;

  select p.id into strict v_other
  from public.profiles p
  where coalesce(p.is_guest, false) = false and p.id <> v_user
  order by p.created_at, p.id
  limit 1;

  insert into public.workspaces (name) values ('harden-writes-test own') returning id into v_ws_own;
  insert into public.workspaces (name) values ('harden-writes-test victim') returning id into v_ws_victim;
  insert into public.workspace_members (workspace_id, user_id, role) values
    (v_ws_own, v_other, 'owner'),
    (v_ws_victim, v_other, 'owner');

  insert into public.teams (owner_id, name, workspace_id)
    values (v_other, 'harden-writes-test other team', v_ws_own) returning id into v_other_team;
  insert into public.projects (owner_id, title, workspace_id)
    values (v_other, 'harden-writes-test other project', v_ws_victim) returning id into v_other_project;

  insert into public.workspace_invites (workspace_id, invited_by, invitee_id, role)
    values (v_ws_own, v_other, v_user, 'member') returning id into v_ws_invite;
  insert into public.team_invites (team_id, invited_by, invitee_id, role)
    values (v_other_team, v_other, v_user, 'member') returning id into v_team_invite;
  insert into public.project_invites (project_id, invited_by, invitee_id)
    values (v_other_project, v_other, v_user) returning id into v_project_invite;

  insert into public.projects (owner_id, title, workspace_id)
    values (v_user, 'harden-writes-test project', v_ws_own) returning id into v_project;
  insert into public.project_access (project_id, user_id, role, origin, has_direct_grant)
    values (v_project, v_user, 'owner', 'direct', true);
  insert into public.teams (owner_id, name, workspace_id)
    values (v_user, 'harden-writes-test team', v_ws_own) returning id into v_team;

  insert into public.roadmaps (owner_id, project_id, name, preview_url)
    values (v_user, null, 'harden-writes-test roadmap', '') returning id into v_roadmap;
  insert into public.roadmap_epics (roadmap_id, title, position)
    values (v_roadmap, 'epic', 0) returning id into v_epic;
  insert into public.roadmap_features (epic_id, roadmap_id, title, position)
    values (v_epic, v_roadmap, 'feature', 0) returning id into v_feature;
  insert into public.roadmap_tasks (feature_id, title, position)
    values (v_feature, 'task', 0) returning id into v_task;

  -- ══ 1. Grants ═════════════════════════════════════════════════════════════

  foreach v_sig in array array[
    'public.workspace_invites', 'public.workspace_members', 'public.workspace_subscriptions',
    'public.team_invites', 'public.project_invites'
  ] loop
    perform pg_temp.check(
      not has_table_privilege('authenticated', v_sig, 'INSERT')
      and not has_table_privilege('authenticated', v_sig, 'UPDATE')
      and not has_table_privilege('authenticated', v_sig, 'DELETE')
      and not has_table_privilege('authenticated', v_sig, 'TRUNCATE')
      and not has_table_privilege('anon', v_sig, 'INSERT')
      and not has_table_privilege('anon', v_sig, 'UPDATE')
      and not has_table_privilege('anon', v_sig, 'DELETE'),
      v_sig || ' is not writable by anon/authenticated');
    perform pg_temp.check(has_table_privilege('authenticated', v_sig, 'SELECT'),
      v_sig || ' stays readable by authenticated (select policy scopes it)');
    perform pg_temp.check(
      has_table_privilege('service_role', v_sig, 'INSERT')
      and has_table_privilege('service_role', v_sig, 'UPDATE')
      and has_table_privilege('service_role', v_sig, 'DELETE'),
      v_sig || ' stays writable by service_role');
  end loop;

  foreach v_sig in array array['public.roadmap_epics', 'public.roadmap_features', 'public.roadmap_tasks'] loop
    perform pg_temp.check(
      not has_table_privilege('authenticated', v_sig, 'INSERT')
      and not has_table_privilege('authenticated', v_sig, 'UPDATE')
      and not has_table_privilege('anon', v_sig, 'INSERT')
      and not has_table_privilege('anon', v_sig, 'UPDATE'),
      v_sig || ' is not insertable/updatable by anon/authenticated');
    perform pg_temp.check(
      has_table_privilege('authenticated', v_sig, 'SELECT')
      and has_table_privilege('authenticated', v_sig, 'DELETE'),
      v_sig || ' keeps SELECT (realtime) and DELETE');
    perform pg_temp.check(
      has_table_privilege('service_role', v_sig, 'INSERT')
      and has_table_privilege('service_role', v_sig, 'UPDATE'),
      v_sig || ' stays writable by service_role');
  end loop;

  -- The web writes profiles directly; only the guest columns are guarded.
  perform pg_temp.check(
    has_table_privilege('authenticated', 'public.profiles', 'INSERT')
    and has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
    'profiles keeps INSERT/UPDATE for authenticated');

  foreach v_sig in array array[
    'public.upsert_full_roadmap(uuid, uuid, jsonb, boolean, timestamptz, uuid)',
    'public.link_roadmap_to_project(uuid, uuid)',
    'public.get_or_create_default_project(uuid, text)'
  ] loop
    perform pg_temp.check(
      not has_function_privilege('authenticated', v_sig, 'EXECUTE')
      and not has_function_privilege('anon', v_sig, 'EXECUTE'),
      v_sig || ' is not executable by anon/authenticated');
    perform pg_temp.check(has_function_privilege('service_role', v_sig, 'EXECUTE'),
      v_sig || ' stays executable by service_role');
  end loop;

  foreach v_sig in array array[
    'public.plan_scope_row_guard()', 'public.roadmaps_scope_guard()', 'public.profiles_guest_columns_guard()'
  ] loop
    perform pg_temp.check(
      (select not p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
         from pg_proc p where p.oid = v_sig::regprocedure),
      v_sig || ' is SECURITY INVOKER with a pinned search_path');
    perform pg_temp.check(
      not has_function_privilege('authenticated', v_sig, 'EXECUTE')
      and not has_function_privilege('anon', v_sig, 'EXECUTE'),
      v_sig || ' is off the RPC surface');
  end loop;

  -- ══ 2. Invite takeover ════════════════════════════════════════════════════

  -- RLS alone would allow the rewrite (invitee_id is unchanged, so both USING
  -- and WITH CHECK pass): prove it with UPDATE granted back inside a
  -- rolled-back block, so the denial below is the revoke doing its job.
  begin
    execute 'grant update on table public.workspace_invites to authenticated';
    v_count := pg_temp.run_as_user(v_user, format(
      'update public.workspace_invites set workspace_id = %L, role = %L where id = %L',
      v_ws_victim, 'owner', v_ws_invite));
    if v_count <> 1 then
      raise exception 'ASSERTION FAILED: fixture: invitee should pass workspace_invites_update RLS (% rows)', v_count;
    end if;
    raise exception 'rollback-grant-probe';
  exception when raise_exception then
    if sqlerrm <> 'rollback-grant-probe' then
      raise;
    end if;
  end;
  perform pg_temp.check(current_user = 'postgres', 'role restored after the RLS probe');
  perform pg_temp.check(
    (select i.workspace_id = v_ws_own and i.role = 'member' from public.workspace_invites i where i.id = v_ws_invite),
    'RLS probe rolled back');

  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.workspace_invites set workspace_id = %L, role = %L where id = %L',
    v_ws_victim, 'owner', v_ws_invite),
    'invitee cannot repoint their workspace invite', 'permission denied for table workspace_invites');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.project_invites set project_id = %L where id = %L', v_project, v_project_invite),
    'invitee cannot repoint their project invite', 'permission denied for table project_invites');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, %L)',
    v_ws_victim, v_user, 'owner'),
    'cannot insert a membership row', 'permission denied for table workspace_members');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.workspace_subscriptions set plan = %L where workspace_id = %L', 'enterprise', v_ws_own),
    'cannot write workspace_subscriptions', 'permission denied for table workspace_subscriptions');
  perform pg_temp.expect_denied('anon', null, format(
    'update public.workspace_invites set role = %L where id = %L', 'owner', v_ws_invite),
    'anon cannot write workspace_invites', 'permission denied for table workspace_invites');

  -- ══ 3. Projects and teams: placement and planting ═════════════════════════

  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.projects set workspace_id = %L where id = %L', v_ws_victim, v_project),
    'project admin cannot move a project to another workspace',
    'Workspace placement is managed by the Proyekto API');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.projects set workspace_id = null where id = %L', v_project),
    'project admin cannot unhome a project to leave the count',
    'Workspace placement is managed by the Proyekto API');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.projects (owner_id, title, workspace_id) values (%L, %L, %L)',
    v_user, 'planted', v_ws_victim),
    'cannot plant a project in a stranger''s workspace',
    'Projects and teams are created through the Proyekto API');

  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.teams (owner_id, name, workspace_id) values (%L, %L, %L)',
    v_user, 'planted', v_ws_victim),
    'cannot insert a team with a workspace_id',
    'Projects and teams are created through the Proyekto API');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.teams (owner_id, name) values (%L, %L)', v_user, 'unhomed'),
    'cannot insert an unhomed team past the count',
    'Projects and teams are created through the Proyekto API');

  -- Ordinary columns stay writable under the existing policies.
  perform pg_temp.check(
    pg_temp.run_as_user(v_user, format(
      'update public.projects set title = %L where id = %L', 'renamed', v_project)) = 1,
    'project admin can still rename their project');

  -- teams_select <-> team_members_select (and team_members_select on itself)
  -- recurse for every authenticated read of teams, team_members and
  -- team_invites (42P17, pre-existing on dev and prod), so an authenticated
  -- UPDATE there dies in the rewriter before any privilege check or trigger.
  -- Run those cases with RLS off on both tables inside a rolled-back block:
  -- the team_invites revoke and the teams guard are what is under test.
  begin
    execute 'alter table public.teams disable row level security';
    execute 'alter table public.team_members disable row level security';
    perform pg_temp.expect_denied('authenticated', v_user, format(
      'update public.team_invites set team_id = team_id, role = %L where id = %L', 'owner', v_team_invite),
      'invitee cannot rewrite their team invite', 'permission denied for table team_invites');
    perform pg_temp.expect_denied('authenticated', v_user, format(
      'update public.teams set workspace_id = %L where id = %L', v_ws_victim, v_team),
      'team owner cannot move a team to another workspace',
      'Workspace placement is managed by the Proyekto API');
    perform pg_temp.expect_denied('authenticated', v_user, format(
      'update public.teams set workspace_id = null where id = %L', v_team),
      'team owner cannot unhome a team to leave the count',
      'Workspace placement is managed by the Proyekto API');
    perform pg_temp.expect_denied('authenticated', v_user, format(
      'update public.teams set is_personal = true where id = %L', v_team),
      'team owner cannot reclassify a team as personal',
      'Workspace placement is managed by the Proyekto API');
    perform pg_temp.check(
      pg_temp.run_as_user(v_user, format(
        'update public.teams set name = %L, workspace_id = %L where id = %L', 'renamed', v_ws_own, v_team)) = 1,
      'a team can still be renamed (an unchanged workspace_id passes the guard)');
    raise exception 'rollback-teams-rls-probe';
  exception when raise_exception then
    if sqlerrm <> 'rollback-teams-rls-probe' then
      raise;
    end if;
  end;
  perform pg_temp.check(current_user = 'postgres', 'role restored after the teams cases');
  perform pg_temp.check(
    (select c.relrowsecurity from pg_class c where c.oid = 'public.teams'::regclass)
    and (select c.relrowsecurity from pg_class c where c.oid = 'public.team_members'::regclass),
    'teams / team_members RLS restored');

  -- ══ 4. Roadmaps: project link and ownership ═══════════════════════════════

  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.roadmaps set project_id = %L where id = %L', v_other_project, v_roadmap),
    'roadmap owner cannot re-link to another project',
    'Roadmap project links and ownership are managed by the Proyekto API');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.roadmaps set owner_id = %L where id = %L', v_other, v_roadmap),
    'roadmap owner cannot hand the roadmap to another owner',
    'Roadmap project links and ownership are managed by the Proyekto API');
  perform pg_temp.check(
    pg_temp.run_as_user(v_user, format(
      'update public.roadmaps set name = %L where id = %L', 'renamed', v_roadmap)) = 1,
    'roadmap owner can still rename their roadmap');

  -- ══ 5. Roadmap nodes and RPCs ═════════════════════════════════════════════

  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.roadmap_epics (roadmap_id, title, position) values (%L, %L, 1)', v_roadmap, 'direct'),
    'editor cannot insert an epic directly', 'permission denied for table roadmap_epics');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.roadmap_features (epic_id, roadmap_id, title, position) values (%L, %L, %L, 1)',
    v_epic, v_roadmap, 'direct'),
    'editor cannot insert a feature directly', 'permission denied for table roadmap_features');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.roadmap_tasks (feature_id, title, position) values (%L, %L, 1)', v_feature, 'direct'),
    'editor cannot insert a task directly', 'permission denied for table roadmap_tasks');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.roadmap_tasks set title = %L where id = %L', 'moved', v_task),
    'editor cannot update (or re-parent) a task directly', 'permission denied for table roadmap_tasks');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.roadmap_features set roadmap_id = roadmap_id where id = %L', v_feature),
    'editor cannot update (or re-parent) a feature directly', 'permission denied for table roadmap_features');
  perform pg_temp.expect_denied('anon', null, format(
    'insert into public.roadmap_epics (roadmap_id, title, position) values (%L, %L, 1)', v_roadmap, 'direct'),
    'anon cannot insert an epic', 'permission denied for table roadmap_epics');

  perform pg_temp.expect_denied('authenticated', v_user, format(
    'select public.upsert_full_roadmap(%L::uuid, %L::uuid, %L::jsonb, false, null, null)',
    v_roadmap, v_user, '{}'),
    'authenticated cannot call upsert_full_roadmap', 'permission denied for function upsert_full_roadmap');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'select public.link_roadmap_to_project(%L::uuid, %L::uuid)', v_roadmap, v_other_project),
    'authenticated cannot call link_roadmap_to_project', 'permission denied for function link_roadmap_to_project');
  perform pg_temp.expect_denied('anon', null, format(
    'select public.get_or_create_default_project(%L::uuid, %L)', v_other, 'spam'),
    'anon cannot call get_or_create_default_project', 'permission denied for function get_or_create_default_project');

  -- ══ 6. Guest flag ═════════════════════════════════════════════════════════

  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.profiles set is_guest = true where id = %L', v_user),
    'a real account cannot flag itself as a guest', 'Guest status is managed by Proyekto');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'update public.profiles set guest_session_id = %L where id = %L', 'forged-session', v_user),
    'a real account cannot set a guest session id', 'Guest status is managed by Proyekto');
  perform pg_temp.expect_denied('authenticated', v_user, format(
    'insert into public.profiles (id, email, is_guest) values (%L, %L, true)', v_user, 'x@example.test'),
    'a browser insert cannot create a guest profile', 'Guest status is managed by Proyekto');

  perform pg_temp.check(
    pg_temp.run_as_user(v_user, format(
      'update public.profiles set first_name = %L where id = %L', 'Harden', v_user)) = 1,
    'a user can still edit their own first_name');
  -- The web's signup/callback upsert shape (no guest columns in the payload).
  perform pg_temp.check(
    pg_temp.run_as_user(v_user, format(
      'insert into public.profiles (id, email, first_name, last_name) values (%L, %L, %L, %L)'
      || ' on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name',
      v_user, (select p.email from public.profiles p where p.id = v_user), 'Harden', 'Upsert')) = 1,
    'the web''s own-profile upsert still works');
  -- Passing the current values back unchanged (a full-profile PATCH) is fine.
  perform pg_temp.check(
    pg_temp.run_as_user(v_user, format(
      'update public.profiles set is_guest = false, guest_session_id = null, last_name = %L where id = %L',
      'Unchanged', v_user)) = 1,
    'an unchanged guest flag passes the guard');
  perform pg_temp.check(
    (select coalesce(p.is_guest, false) = false and p.guest_session_id is null and p.first_name = 'Harden'
       from public.profiles p where p.id = v_user),
    'the guest columns were never changed by the browser cases');

  -- ══ 7. service_role, the API's write path, is unaffected ══════════════════
  -- No pg_temp helper calls while switched: failures are raised inline.

  execute 'set local role service_role';

  update public.workspace_invites set workspace_id = v_ws_victim, role = 'admin' where id = v_ws_invite;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not update workspace_invites'; end if;
  update public.team_invites set role = 'admin' where id = v_team_invite;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not update team_invites'; end if;
  update public.project_invites set status = 'declined' where id = v_project_invite;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not update project_invites'; end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws_victim, v_user, 'member');

  update public.projects set workspace_id = v_ws_victim where id = v_project;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not move a project'; end if;
  insert into public.projects (owner_id, title, workspace_id) values (v_user, 'service project', v_ws_own);
  insert into public.teams (owner_id, name, workspace_id) values (v_user, 'service team', v_ws_victim);
  update public.teams set workspace_id = v_ws_victim, is_personal = true where id = v_team;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not move and reclassify a team'; end if;

  update public.roadmaps set project_id = v_other_project where id = v_roadmap;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not link a roadmap'; end if;
  update public.roadmaps set owner_id = v_other where id = v_roadmap;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not transfer a roadmap'; end if;

  insert into public.roadmap_epics (roadmap_id, title, position) values (v_roadmap, 'service epic', 1);
  update public.roadmap_tasks set title = 'service title' where id = v_task;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not update a task'; end if;

  update public.profiles set is_guest = true, guest_session_id = 'harden-writes-test-session' where id = v_user;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'ASSERTION FAILED: service_role could not set the guest columns'; end if;

  -- Guest creation: the SECURITY DEFINER RPC runs as its owner, so the profile
  -- guard does not fire even though it inserts is_guest = true.
  v_guest := public.create_guest_user('harden-writes-test-' || replace(gen_random_uuid()::text, '-', ''));
  execute 'reset role';

  perform pg_temp.check(current_user = 'postgres', 'role restored after the service_role cases');
  perform pg_temp.check(
    (select p.is_guest and p.guest_session_id like 'harden-writes-test-%' from public.profiles p where p.id = v_guest),
    'create_guest_user still creates a guest profile');
  perform pg_temp.check(
    (select t.is_personal and t.workspace_id = v_ws_victim from public.teams t where t.id = v_team)
    and (select r.project_id = v_other_project and r.owner_id = v_other from public.roadmaps r where r.id = v_roadmap)
    and (select p.workspace_id = v_ws_victim from public.projects p where p.id = v_project),
    'service_role writes landed');
end;
$$;

rollback;
