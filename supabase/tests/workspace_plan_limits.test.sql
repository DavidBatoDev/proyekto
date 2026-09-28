-- Tests for 20260922120000_workspace_plan_limits.sql: the seeded matrix, the
-- CHECKs and composite FK, the effective-plan rule, the workspaces write
-- revoke and comp guard, function and table grants, the admin RPCs and their
-- audit rows, usage counts, workspace_largest_roadmaps, admin_list_workspaces
-- and entitlement_subject.
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

-- Runs p_sql and requires it to fail with p_sqlstate (and, when given, the
-- exact message p_errm). The failed statement's subtransaction rolls back.
create function pg_temp.expect_error(p_sql text, p_sqlstate text, p_msg text, p_errm text default null)
returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_sqlstate or (p_errm is not null and sqlerrm <> p_errm) then
      raise exception 'ASSERTION FAILED: % (expected % %, got %: %)',
        p_msg, p_sqlstate, coalesce(p_errm, ''), sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERTION FAILED: % (statement succeeded, expected %)', p_msg, p_sqlstate;
end;
$$;

do $$
declare
  v_owner uuid;        -- non-guest who already owns a workspace, so no fixture is their default
  v_member uuid;       -- plain second member
  v_fresh uuid;        -- owns no workspace; made the earliest owner of v_ws_u
  v_guest uuid;        -- owns no workspace; flipped to is_guest for the exemption cases
  v_pp_user uuid;      -- has no personal project yet
  v_actor uuid;
  v_ws_a uuid; v_ws_b uuid; v_ws_c uuid; v_ws_d uuid; v_ws_e uuid; v_ws_f uuid;
  v_ws_g uuid; v_ws_h uuid; v_ws_i uuid; v_ws_j uuid; v_ws_k uuid; v_ws_u uuid; v_ws_s uuid;
  v_project uuid; v_archived_project uuid; v_personal_project uuid; v_unhomed_project uuid; v_guest_project uuid;
  v_team uuid;
  v_rm_big uuid; v_rm_empty uuid; v_rm_owner_draft uuid; v_rm_fresh_draft uuid; v_rm_guest_draft uuid;
  v_epic uuid; v_feature uuid;
  v_changed boolean;
  v_count integer;
  v_version timestamptz;
  v_audit_before integer;
  v_sig text;
  rec record;
begin
  -- ── Fixture people (existing dev profiles; nothing is created in auth) ──
  select p.id into strict v_owner
  from public.profiles p
  where coalesce(p.is_guest, false) = false
    and exists (select 1 from public.workspace_members m where m.user_id = p.id and m.role = 'owner')
  order by p.created_at, p.id
  limit 1;

  -- No unlinked drafts either: v_ws_u becomes their default, and the largest-
  -- roadmaps assertion lists exactly the drafts attributed there.
  select p.id into strict v_fresh
  from public.profiles p
  where coalesce(p.is_guest, false) = false
    and not exists (select 1 from public.workspace_members m where m.user_id = p.id and m.role = 'owner')
    and not exists (select 1 from public.roadmaps r where r.owner_id = p.id and r.project_id is null)
  order by p.id
  limit 1;

  select p.id into strict v_guest
  from public.profiles p
  where coalesce(p.is_guest, false) = false
    and p.id <> v_fresh
    and not exists (select 1 from public.workspace_members m where m.user_id = p.id and m.role = 'owner')
  order by p.id
  limit 1;

  select p.id into strict v_member
  from public.profiles p
  where coalesce(p.is_guest, false) = false
    and p.id not in (v_owner, v_fresh, v_guest)
  order by p.id
  limit 1;

  select p.id into strict v_pp_user
  from public.profiles p
  where coalesce(p.is_guest, false) = false
    and not exists (select 1 from public.personal_projects pp where pp.user_id = p.id)
  order by p.id
  limit 1;

  v_actor := v_owner;

  -- ══ 1. Seeded matrix ═════════════════════════════════════════════════════

  perform pg_temp.check((select count(*) from public.plan_limit_keys) = 18, '18 limit keys');
  perform pg_temp.check((select count(*) from public.plan_limits) = 72, '72 limit cells');
  perform pg_temp.check(
    (select count(*) from (
       select l.plan from public.plan_limits l group by l.plan having count(*) = 18
     ) x) = 4,
    '18 cells on each of the 4 plans');
  perform pg_temp.check(not exists (
    select 1
    from public.plan_limit_keys k
    cross join (values ('free'), ('pro'), ('business'), ('enterprise')) p(plan)
    where not exists (
      select 1 from public.plan_limits l where l.plan = p.plan and l.limit_key = k.key
    )), 'every key has a cell on every plan');

  perform pg_temp.check(not exists (
    select 1
    from (values
      ('members', 'count', 'Members', 'members'::text, 'usage'),
      ('projects', 'count', 'Projects', 'projects', 'usage'),
      ('teams', 'count', 'Teams', 'teams', 'usage'),
      ('roadmap_nodes_per_roadmap', 'count', 'Roadmap nodes per roadmap', 'nodes', 'usage'),
      ('ai_messages_monthly', 'quota', 'AI messages', 'messages', 'ai'),
      ('deliverables', 'feature', 'Deliverables', null, 'governance'),
      ('deliverable_review', 'feature', 'Deliverable review and acceptance', null, 'governance'),
      ('change_requests', 'feature', 'Change requests', null, 'governance'),
      ('risks', 'feature', 'Risks and issues register', null, 'governance'),
      ('decisions', 'feature', 'Decision log', null, 'governance'),
      ('custom_register_fields', 'feature', 'Custom register fields', null, 'governance'),
      ('time_tracking', 'feature', 'Time tracking and timesheets', null, 'team'),
      ('private_teams_guests', 'feature', 'Private teams and guests', null, 'team'),
      ('roles_permissions', 'feature', 'Roles and permissions', null, 'team'),
      ('activity_retention_days', 'days', 'Activity log retention', 'days', 'team'),
      ('activity_export', 'feature', 'Activity export', null, 'team'),
      ('mcp_server', 'feature', 'MCP server', null, 'platform'),
      ('saml_scim', 'feature', 'SAML and SCIM', null, 'platform')
    ) e(key, kind, label, unit, group_key)
    left join public.plan_limit_keys k on k.key = e.key
    where k.key is null
       or k.kind <> e.kind
       or k.label <> e.label
       or k.unit is distinct from e.unit
       or k.group_key <> e.group_key
  ), 'key registry matches the contract (kind, label, unit, group)');

  perform pg_temp.check(not exists (
    select 1
    from (values
      ('free', 'members', 10, false, null::text),
      ('pro', 'members', null::integer, false, null),
      ('business', 'members', null, false, null),
      ('enterprise', 'members', null, false, null),
      ('free', 'projects', 2, false, null),
      ('pro', 'projects', 10, false, null),
      ('business', 'projects', null, false, null),
      ('enterprise', 'projects', null, false, null),
      ('free', 'teams', 2, false, null),
      ('pro', 'teams', 3, false, null),
      ('business', 'teams', null, false, null),
      ('enterprise', 'teams', null, false, null),
      ('free', 'roadmap_nodes_per_roadmap', 250, false, null),
      ('pro', 'roadmap_nodes_per_roadmap', null, false, null),
      ('business', 'roadmap_nodes_per_roadmap', null, false, null),
      ('enterprise', 'roadmap_nodes_per_roadmap', null, false, null),
      ('free', 'ai_messages_monthly', 50, false, null),
      ('pro', 'ai_messages_monthly', 500, true, null),
      ('business', 'ai_messages_monthly', 2000, true, null),
      ('enterprise', 'ai_messages_monthly', null, false, 'Negotiated'),
      ('free', 'activity_retention_days', 7, false, null),
      ('pro', 'activity_retention_days', 90, false, null),
      ('business', 'activity_retention_days', null, false, null),
      ('enterprise', 'activity_retention_days', null, false, null)
    ) e(plan, limit_key, int_value, per_seat, display_label)
    left join public.plan_limits l on l.plan = e.plan and l.limit_key = e.limit_key
    where l.plan is null
       or l.int_value is distinct from e.int_value
       or l.per_seat <> e.per_seat
       or l.display_label is distinct from e.display_label
       or l.bool_value is not null
  ), 'numeric cells match pricing.ts');

  perform pg_temp.check(not exists (
    select 1
    from public.plan_limits l
    join (values
      ('free', array[]::text[]),
      ('pro', array['deliverables', 'deliverable_review', 'change_requests', 'risks', 'decisions',
                    'time_tracking', 'mcp_server']),
      ('business', array['deliverables', 'deliverable_review', 'change_requests', 'risks', 'decisions',
                         'time_tracking', 'mcp_server', 'private_teams_guests', 'roles_permissions']),
      ('enterprise', array['deliverables', 'deliverable_review', 'change_requests', 'risks', 'decisions',
                           'custom_register_fields', 'time_tracking', 'private_teams_guests',
                           'roles_permissions', 'activity_export', 'mcp_server', 'saml_scim'])
    ) e(plan, enabled) on e.plan = l.plan
    where l.kind = 'feature'
      and (l.bool_value is distinct from (l.limit_key = any (e.enabled))
           or l.int_value is not null
           or l.per_seat
           or l.display_label is distinct from (
                case
                  when l.plan = 'enterprise' and l.limit_key = 'roles_permissions' then 'Granular'
                  when l.plan = 'enterprise' and l.limit_key = 'mcp_server' then 'Higher limits'
                end))
  ), 'feature cells and their display labels match pricing.ts');
  perform pg_temp.check((select count(*) from public.plan_limits where kind = 'feature') = 48,
    '12 feature keys x 4 plans');

  -- ══ 2. CHECK and composite-FK rejections ═════════════════════════════════

  perform pg_temp.expect_error(
    $q$update public.plan_limits set bool_value = true where plan = 'free' and limit_key = 'members'$q$,
    '23514', 'bool_value on a count cell');
  perform pg_temp.expect_error(
    $q$update public.plan_limits set int_value = 1 where plan = 'free' and limit_key = 'deliverables'$q$,
    '23514', 'int_value on a feature cell');
  perform pg_temp.expect_error(
    $q$update public.plan_limits set bool_value = null where plan = 'pro' and limit_key = 'risks'$q$,
    '23514', 'feature cell without bool_value');
  perform pg_temp.expect_error(
    $q$update public.plan_limits set per_seat = true where plan = 'free' and limit_key = 'projects'$q$,
    '23514', 'per_seat on a count cell');
  perform pg_temp.expect_error(
    $q$update public.plan_limits set int_value = 0 where plan = 'free' and limit_key = 'activity_retention_days'$q$,
    '23514', 'days cell of 0');
  perform pg_temp.expect_error(
    $q$update public.plan_limits set int_value = -1 where plan = 'free' and limit_key = 'projects'$q$,
    '23514', 'negative int_value');
  perform pg_temp.expect_error(
    $q$update public.plan_limits set display_label = repeat('x', 41) where plan = 'free' and limit_key = 'projects'$q$,
    '23514', 'display_label over 40 characters');
  perform pg_temp.expect_error(
    $q$insert into public.plan_limits (plan, limit_key, kind, int_value) values ('gold', 'projects', 'count', 1)$q$,
    '23514', 'unknown plan');
  perform pg_temp.expect_error(
    $q$update public.plan_limits set kind = 'feature', int_value = null, bool_value = true
       where plan = 'free' and limit_key = 'members'$q$,
    '23503', 'cell kind that does not match its key (composite FK)');
  perform pg_temp.expect_error(
    $q$insert into public.plan_limits (plan, limit_key, kind, int_value) values ('free', 'no_such_key', 'count', 1)$q$,
    '23503', 'cell for an unregistered key');
  perform pg_temp.expect_error(
    $q$insert into public.plan_limit_keys (key, kind, label, unit, group_key) values ('zz_test_key', 'feature', 'X', 'x', 'team')$q$,
    '23514', 'feature key with a unit');
  perform pg_temp.expect_error(
    $q$insert into public.plan_limit_keys (key, kind, label, unit, group_key) values ('zz_test_key', 'count', 'X', null, 'team')$q$,
    '23514', 'numeric key without a unit');

  -- ══ 3. Fixture workspaces and the comp CHECKs ════════════════════════════

  insert into public.workspaces (name) values ('plan-limits-test a') returning id into v_ws_a;
  insert into public.workspaces (name) values ('plan-limits-test b') returning id into v_ws_b;
  insert into public.workspaces (name) values ('plan-limits-test c') returning id into v_ws_c;
  insert into public.workspaces (name) values ('plan-limits-test d') returning id into v_ws_d;
  insert into public.workspaces (name) values ('plan-limits-test e') returning id into v_ws_e;
  insert into public.workspaces (name) values ('plan-limits-test f') returning id into v_ws_f;
  insert into public.workspaces (name) values ('plan-limits-test g') returning id into v_ws_g;
  insert into public.workspaces (name) values ('plan-limits-test h') returning id into v_ws_h;
  insert into public.workspaces (name) values ('plan-limits-test i') returning id into v_ws_i;
  insert into public.workspaces (name) values ('plan-limits-test j') returning id into v_ws_j;
  insert into public.workspaces (name) values ('plan-limits-test k') returning id into v_ws_k;
  insert into public.workspaces (name) values ('plan-limits-test u') returning id into v_ws_u;
  insert into public.workspaces (name) values ('plan-limits-test s') returning id into v_ws_s;

  perform pg_temp.check(
    (select not w.is_discounted_free and w.discounted_plan is null and w.discounted_at is null
            and w.discounted_until is null
       from public.workspaces w where w.id = v_ws_a),
    'new workspaces start uncomped');

  perform pg_temp.expect_error(
    format('update public.workspaces set is_discounted_free = true where id = %L', v_ws_a),
    '23514', 'comp flag without a plan');
  perform pg_temp.expect_error(
    format('update public.workspaces set discounted_plan = %L where id = %L', 'pro', v_ws_a),
    '23514', 'comp plan without the flag');
  perform pg_temp.expect_error(
    format('update public.workspaces set is_discounted_free = true, discounted_plan = %L where id = %L', 'free', v_ws_a),
    '23514', 'free is not a comp plan');
  perform pg_temp.expect_error(
    format('update public.workspaces set discounted_until = now() where id = %L', v_ws_a),
    '23514', 'comp dates without the flag');

  -- ══ 4. workspace_plan_state: the effective-plan rule ═════════════════════
  -- a: no subscription row          -> free / default
  -- b: pro active                   -> pro / subscription
  -- c: pro canceled                 -> free / default
  -- d: pro past_due                 -> pro / subscription
  -- e: comp business + paid pro     -> business / complimentary
  -- f: comp pro + paid business     -> business / subscription
  -- g: lapsed comp business + pro   -> pro / subscription
  -- h: lapsed comp enterprise, none -> free / default
  -- i: business trialing            -> business / subscription
  -- j: comp pro + paid pro (tie)    -> pro / subscription

  insert into public.workspace_subscriptions (workspace_id, plan, status) values
    (v_ws_b, 'pro', 'active'),
    (v_ws_c, 'pro', 'canceled'),
    (v_ws_d, 'pro', 'past_due'),
    (v_ws_e, 'pro', 'active'),
    (v_ws_f, 'business', 'active'),
    (v_ws_g, 'pro', 'active'),
    (v_ws_i, 'business', 'trialing'),
    (v_ws_j, 'pro', 'active');
  update public.workspace_subscriptions
     set billing_provider = 'stripe', provider_subscription_id = 'sub_plan_limits_test_b'
   where workspace_id = v_ws_b;

  perform pg_temp.check(public.admin_set_workspace_comp(v_ws_e, 'business', null, 'test', v_actor), 'comp e');
  perform pg_temp.check(public.admin_set_workspace_comp(v_ws_f, 'pro', null, 'test', v_actor), 'comp f');
  perform pg_temp.check(
    public.admin_set_workspace_comp(v_ws_g, 'business', now() - interval '1 day', 'test', v_actor), 'comp g');
  perform pg_temp.check(
    public.admin_set_workspace_comp(v_ws_h, 'enterprise', now() - interval '1 minute', 'test', v_actor), 'comp h');
  perform pg_temp.check(public.admin_set_workspace_comp(v_ws_j, 'pro', null, 'test', v_actor), 'comp j');

  for rec in
    select s.*, e.exp_plan, e.exp_source, e.exp_comp_active, e.exp_sub_plan, e.exp_status, e.exp_provider
    from (values
      (v_ws_a, 'free', 'default', false, 'free', null::text, false),
      (v_ws_b, 'pro', 'subscription', false, 'pro', 'active', true),
      (v_ws_c, 'free', 'default', false, 'pro', 'canceled', false),
      (v_ws_d, 'pro', 'subscription', false, 'pro', 'past_due', false),
      (v_ws_e, 'business', 'complimentary', true, 'pro', 'active', false),
      (v_ws_f, 'business', 'subscription', true, 'business', 'active', false),
      (v_ws_g, 'pro', 'subscription', false, 'pro', 'active', false),
      (v_ws_h, 'free', 'default', false, 'free', null, false),
      (v_ws_i, 'business', 'subscription', false, 'business', 'trialing', false),
      (v_ws_j, 'pro', 'subscription', true, 'pro', 'active', false)
    ) e(ws, exp_plan, exp_source, exp_comp_active, exp_sub_plan, exp_status, exp_provider)
    left join public.workspace_plan_state(array[e.ws]) s on s.workspace_id = e.ws
  loop
    perform pg_temp.check(rec.workspace_id is not null, 'plan state row exists');
    perform pg_temp.check(
      rec.effective_plan = rec.exp_plan and rec.plan_source = rec.exp_source,
      format('%s: expected %s/%s, got %s/%s', rec.workspace_name, rec.exp_plan, rec.exp_source,
             rec.effective_plan, rec.plan_source));
    perform pg_temp.check(rec.comp_active = rec.exp_comp_active,
      format('%s: comp_active %s', rec.workspace_name, rec.comp_active));
    perform pg_temp.check(
      rec.subscription_plan = rec.exp_sub_plan and rec.subscription_status is not distinct from rec.exp_status,
      format('%s: subscription %s/%s', rec.workspace_name, rec.subscription_plan, rec.subscription_status));
    perform pg_temp.check(rec.has_provider_subscription = rec.exp_provider,
      format('%s: has_provider_subscription', rec.workspace_name));
  end loop;

  perform pg_temp.check(
    (select s.workspace_name = 'plan-limits-test e' and s.workspace_slug = 'plan-limits-test-e'
            and s.is_discounted_free and s.discounted_plan = 'business' and s.discounted_at is not null
            and s.discounted_until is null
       from public.workspace_plan_state(array[v_ws_e]) s),
    'plan state carries name, slug and the comp columns');
  perform pg_temp.check(
    (select count(*) from public.workspace_plan_state(array[v_ws_a, v_ws_a, gen_random_uuid()])) = 1,
    'plan state drops unknown ids and collapses duplicates');
  perform pg_temp.check(
    (select count(*) from public.workspace_plan_state(array(select w.id from public.workspaces w)))
      = (select count(*) from public.workspaces),
    'plan state returns one row per workspace');

  -- ══ 5. Grants, the write revoke and the comp guard ═══════════════════════

  perform pg_temp.check(not has_table_privilege('authenticated', 'public.workspaces', 'UPDATE'),
    'authenticated cannot UPDATE workspaces');
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.workspaces', 'INSERT'),
    'authenticated cannot INSERT workspaces');
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.workspaces', 'DELETE'),
    'authenticated cannot DELETE workspaces');
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.workspaces', 'TRUNCATE'),
    'authenticated cannot TRUNCATE workspaces');
  perform pg_temp.check(has_table_privilege('authenticated', 'public.workspaces', 'SELECT'),
    'authenticated keeps SELECT on workspaces');
  perform pg_temp.check(has_table_privilege('service_role', 'public.workspaces', 'UPDATE'),
    'service_role keeps UPDATE on workspaces');

  foreach v_sig in array array[
    'public.plan_limit_keys', 'public.plan_limits', 'public.platform_admin_audit_log'
  ] loop
    perform pg_temp.check(
      not has_table_privilege('anon', v_sig, 'SELECT')
      and not has_table_privilege('authenticated', v_sig, 'SELECT')
      and not has_table_privilege('authenticated', v_sig, 'INSERT')
      and not has_table_privilege('authenticated', v_sig, 'UPDATE')
      and not has_table_privilege('authenticated', v_sig, 'DELETE'),
      v_sig || ' is not readable or writable by browser roles');
    perform pg_temp.check(has_table_privilege('service_role', v_sig, 'SELECT')
                          and has_table_privilege('service_role', v_sig, 'UPDATE'),
      v_sig || ' is service_role readable and writable');
    perform pg_temp.check((select c.relrowsecurity from pg_class c where c.oid = v_sig::regclass),
      v_sig || ' has RLS enabled');
    perform pg_temp.check(
      (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = split_part(v_sig, '.', 2)) = 0,
      v_sig || ' has zero policies');
  end loop;

  foreach v_sig in array array[
    'public.plan_rank(text)',
    'public.workspaces_discount_guard()',
    'public.user_default_workspace_id(uuid)',
    'public.workspace_plan_state(uuid[])',
    'public.workspace_usage_counts(uuid[])',
    'public.workspace_largest_roadmaps(uuid,integer)',
    'public.entitlement_subject(text,uuid)',
    'public.admin_list_workspaces(text,text,integer,integer)',
    'public.admin_update_plan_limits(jsonb,uuid,text,timestamptz)',
    'public.admin_set_workspace_comp(uuid,text,timestamptz,text,uuid)',
    'public.admin_clear_workspace_comp(uuid,text,uuid)'
  ] loop
    perform pg_temp.check(
      not has_function_privilege('anon', v_sig, 'EXECUTE')
      and not has_function_privilege('authenticated', v_sig, 'EXECUTE'),
      v_sig || ' must not be executable by anon or authenticated');
    perform pg_temp.check(has_function_privilege('service_role', v_sig, 'EXECUTE'),
      v_sig || ' must be executable by service_role');
    perform pg_temp.check(
      (select not p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
         from pg_proc p where p.oid = v_sig::regprocedure),
      v_sig || ' is SECURITY INVOKER with a pinned search_path');
  end loop;

  -- An owner of v_ws_a, for the RLS-visible guard case below. Joined now, so
  -- v_owner's default workspace stays their older one.
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws_a, v_owner, 'owner');

  -- The revoke: a browser session cannot write workspaces at all.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    execute 'set local role authenticated';
    update public.workspaces
       set is_discounted_free = true, discounted_plan = 'enterprise'
     where id = v_ws_a;
    raise exception 'ASSERTION FAILED: authenticated updated the comp columns';
  exception when insufficient_privilege then
    if sqlerrm not like 'permission denied%' then
      raise exception 'ASSERTION FAILED: expected the table revoke, got: %', sqlerrm;
    end if;
  end;

  -- The guard, as a second line: even with UPDATE granted back (inside this
  -- rolled-back block) and the owner passing workspaces_update, a browser role
  -- can change ordinary columns but not the comp columns.
  begin
    execute 'grant update on table public.workspaces to authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    execute 'set local role authenticated';
    update public.workspaces set description = 'guard allows ordinary columns' where id = v_ws_a;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'ASSERTION FAILED: owner could not see v_ws_a under RLS (% rows)', v_count;
    end if;
    update public.workspaces
       set is_discounted_free = true, discounted_plan = 'enterprise'
     where id = v_ws_a;
    raise exception 'ASSERTION FAILED: guard let authenticated set a comp';
  exception when insufficient_privilege then
    if sqlerrm <> 'Complimentary plan fields are managed by Proyekto staff' then
      raise exception 'ASSERTION FAILED: expected the comp guard, got: %', sqlerrm;
    end if;
  end;

  perform pg_temp.check(current_user = 'postgres', 'role restored after the guard cases');
  perform pg_temp.check(
    (select not w.is_discounted_free and w.description is null from public.workspaces w where w.id = v_ws_a),
    'guard cases left v_ws_a untouched');

  -- The real write path: service_role through the admin RPCs.
  execute 'set local role service_role';
  v_changed := public.admin_set_workspace_comp(v_ws_s, 'pro', null, 'service role path', v_actor);
  if not v_changed then
    raise exception 'ASSERTION FAILED: service_role could not grant a comp';
  end if;
  v_changed := public.admin_clear_workspace_comp(v_ws_s, 'service role path', v_actor);
  if not v_changed then
    raise exception 'ASSERTION FAILED: service_role could not clear a comp';
  end if;
  execute 'reset role';
  perform pg_temp.check(current_user = 'postgres', 'role restored after the service_role case');

  -- ══ 6. Comp RPCs and their audit rows ════════════════════════════════════
  -- Every audit row in this transaction shares created_at = now(), so each
  -- step is identified by its content, not by "latest".

  perform pg_temp.check(
    (select count(*) from public.platform_admin_audit_log a
      where a.target_type = 'workspace' and a.target_id = v_ws_s) = 2,
    'service_role path wrote a granted and a revoked row');

  perform pg_temp.check(public.admin_set_workspace_comp(v_ws_k, 'pro', null, '  first grant  ', v_actor),
    'grant returns true');
  perform pg_temp.check(
    (select count(*) = 1
       from public.platform_admin_audit_log a
      where a.target_type = 'workspace' and a.target_id = v_ws_k
        and a.action = 'workspace_comp.granted' and a.actor_id = v_actor and a.note = 'first grant'
        and a.before ->> 'is_discounted_free' = 'false' and a.after ->> 'discounted_plan' = 'pro'
        and a.after ->> 'is_discounted_free' = 'true'),
    'grant audited as workspace_comp.granted with actor, trimmed note, before/after');

  select count(*) into v_audit_before
  from public.platform_admin_audit_log a where a.target_id = v_ws_k;
  perform pg_temp.check(not public.admin_set_workspace_comp(v_ws_k, 'pro', null, 'no-op', v_actor),
    'identical grant returns false');
  perform pg_temp.check(
    (select count(*) from public.platform_admin_audit_log a where a.target_id = v_ws_k) = v_audit_before,
    'identical grant writes no audit row');

  -- Editing an active comp keeps its original since.
  update public.workspaces set discounted_at = '2020-01-01T00:00:00Z' where id = v_ws_k;
  perform pg_temp.check(
    public.admin_set_workspace_comp(v_ws_k, 'business', now() + interval '30 days', 'upgrade', v_actor),
    'edit returns true');
  perform pg_temp.check(
    (select w.discounted_plan = 'business' and w.discounted_at = '2020-01-01T00:00:00Z'
            and w.discounted_until = now() + interval '30 days'
       from public.workspaces w where w.id = v_ws_k),
    'edit of an active comp keeps discounted_at');
  perform pg_temp.check(
    (select count(*) = 1
       from public.platform_admin_audit_log a
      where a.target_id = v_ws_k and a.action = 'workspace_comp.updated' and a.note = 'upgrade'
        and a.before ->> 'discounted_plan' = 'pro' and a.after ->> 'discounted_plan' = 'business'),
    'edit audited as workspace_comp.updated');

  -- Re-granting a lapsed comp is a fresh grant with a fresh since.
  update public.workspaces
     set discounted_at = '2020-01-01T00:00:00Z', discounted_until = '2021-01-01T00:00:00Z'
   where id = v_ws_k;
  perform pg_temp.check(public.admin_set_workspace_comp(v_ws_k, 'business', null, 'regrant', v_actor),
    're-grant of a lapsed comp returns true');
  perform pg_temp.check(
    (select w.discounted_at = now() and w.discounted_until is null
       from public.workspaces w where w.id = v_ws_k),
    're-grant of a lapsed comp resets discounted_at');
  perform pg_temp.check(
    (select count(*) = 1
       from public.platform_admin_audit_log a
      where a.target_id = v_ws_k and a.action = 'workspace_comp.granted' and a.note = 'regrant'),
    're-grant of a lapsed comp audited as granted');

  perform pg_temp.check(public.admin_clear_workspace_comp(v_ws_k, 'done', v_actor), 'clear returns true');
  perform pg_temp.check(
    (select not w.is_discounted_free and w.discounted_plan is null and w.discounted_at is null
            and w.discounted_until is null
       from public.workspaces w where w.id = v_ws_k),
    'clear NULLs all four comp columns');
  perform pg_temp.check(
    (select count(*) = 1
       from public.platform_admin_audit_log a
      where a.target_id = v_ws_k and a.action = 'workspace_comp.revoked' and a.note = 'done'
        and a.before ->> 'discounted_plan' = 'business' and a.after ->> 'is_discounted_free' = 'false'
        and a.after -> 'discounted_plan' = 'null'::jsonb),
    'clear audited as workspace_comp.revoked');

  select count(*) into v_audit_before
  from public.platform_admin_audit_log a where a.target_id = v_ws_k;
  perform pg_temp.check(not public.admin_clear_workspace_comp(v_ws_k, 'again', v_actor),
    'second clear returns false');
  perform pg_temp.check(
    (select count(*) from public.platform_admin_audit_log a where a.target_id = v_ws_k) = v_audit_before,
    'second clear writes no audit row');
  perform pg_temp.check(
    (select count(*) from public.platform_admin_audit_log a where a.target_id = v_ws_k) = 4,
    'v_ws_k history: granted, updated, granted, revoked');

  perform pg_temp.expect_error(
    format('select public.admin_set_workspace_comp(%L, %L, null, %L, %L)', gen_random_uuid(), 'pro', 'x', v_actor),
    'P0001', 'set on a missing workspace', 'workspace_not_found');
  perform pg_temp.expect_error(
    format('select public.admin_clear_workspace_comp(%L, %L, %L)', gen_random_uuid(), 'x', v_actor),
    'P0001', 'clear on a missing workspace', 'workspace_not_found');
  perform pg_temp.expect_error(
    format('select public.admin_set_workspace_comp(%L, %L, null, %L, %L)', v_ws_k, 'free', 'x', v_actor),
    '22023', 'free is not a comp plan', 'workspace_comp_invalid_plan');

  -- ══ 7. admin_update_plan_limits ══════════════════════════════════════════

  select max(l.updated_at) into v_version from public.plan_limits l;

  perform pg_temp.check(
    public.admin_update_plan_limits(
      jsonb_build_array(
        jsonb_build_object('plan', 'free', 'limit_key', 'projects', 'int_value', 3,
                           'bool_value', null, 'per_seat', false, 'display_label', null),
        jsonb_build_object('plan', 'pro', 'limit_key', 'saml_scim', 'int_value', null,
                           'bool_value', true, 'per_seat', false, 'display_label', 'Beta')),
      v_actor, 'raise free projects', v_version) = 2,
    'update returns the rows updated');
  perform pg_temp.check(
    (select l.int_value = 3 and l.updated_by = v_actor and l.updated_at = now()
       from public.plan_limits l where l.plan = 'free' and l.limit_key = 'projects'),
    'updated count cell carries value, updated_by and updated_at');
  perform pg_temp.check(
    (select l.bool_value and l.display_label = 'Beta'
       from public.plan_limits l where l.plan = 'pro' and l.limit_key = 'saml_scim'),
    'updated feature cell carries enabled and display_label');
  perform pg_temp.check(
    (select count(*) = 1
       from public.platform_admin_audit_log a
      where a.target_type = 'plan_limits' and a.note = 'raise free projects'
        and a.action = 'plan_limits.updated' and a.target_id is null and a.actor_id = v_actor
        and jsonb_array_length(a.before) = 2 and jsonb_array_length(a.after) = 2
        and (select c ->> 'int_value' from jsonb_array_elements(a.before) c
              where c ->> 'limit_key' = 'projects') = '2'
        and (select c ->> 'int_value' from jsonb_array_elements(a.after) c
              where c ->> 'limit_key' = 'projects') = '3'),
    'update audited once with before/after cells');

  -- The matrix moved, so the pre-edit version is stale.
  perform pg_temp.expect_error(
    format('select public.admin_update_plan_limits(%L::jsonb, %L, null, %L)',
           '[{"plan":"free","limit_key":"teams","int_value":4}]', v_actor, v_version),
    'P0001', 'stale base version', 'plan_limits_stale');
  -- A millisecond-truncated copy of the current version (a JavaScript Date
  -- round-trip) is not stale.
  perform pg_temp.check(
    public.admin_update_plan_limits(
      '[{"plan":"free","limit_key":"teams","int_value":4,"bool_value":null,"per_seat":false,"display_label":null}]',
      v_actor, null,
      (select date_trunc('milliseconds', max(l.updated_at)) from public.plan_limits l)) = 1,
    'ms-truncated current version is accepted');
  perform pg_temp.check(
    public.admin_update_plan_limits(
      '[{"plan":"free","limit_key":"teams","int_value":2,"bool_value":null,"per_seat":false,"display_label":""}]',
      v_actor, null, null) = 1,
    'null base version skips the stale check');
  perform pg_temp.check(
    (select l.display_label is null from public.plan_limits l where l.plan = 'free' and l.limit_key = 'teams'),
    'an empty display_label is stored as NULL');

  perform pg_temp.expect_error(
    format('select public.admin_update_plan_limits(%L::jsonb, %L, null, null)',
           '[{"plan":"free","limit_key":"no_such_key","int_value":1}]', v_actor),
    'P0001', 'unknown cell', 'plan_limits_unknown_cell');
  perform pg_temp.expect_error(
    format('select public.admin_update_plan_limits(%L::jsonb, %L, null, null)',
           '[{"plan":"free","limit_key":"teams","int_value":1},{"plan":"free","limit_key":"teams","int_value":5}]',
           v_actor),
    '22023', 'duplicate cell', 'plan_limits_duplicate_cell');
  perform pg_temp.expect_error(
    format('select public.admin_update_plan_limits(%L::jsonb, %L, null, null)', '[]', v_actor),
    '22023', 'empty change list', 'plan_limits_invalid_changes');
  perform pg_temp.expect_error(
    format('select public.admin_update_plan_limits(%L::jsonb, %L, null, null)',
           '[{"plan":"free","limit_key":"members","bool_value":true}]', v_actor),
    '23514', 'kind mismatch through the RPC');
  perform pg_temp.expect_error(
    format('select public.admin_update_plan_limits(%L::jsonb, %L, null, null)',
           '[{"plan":"free","limit_key":"projects","int_value":2,"per_seat":true}]', v_actor),
    '23514', 'per_seat on a count through the RPC');
  perform pg_temp.expect_error(
    format('select public.admin_update_plan_limits(%L::jsonb, %L, null, null)',
           '[{"plan":"free","limit_key":"activity_retention_days","int_value":0}]', v_actor),
    '23514', 'days = 0 through the RPC');

  -- ══ 8. Usage counts ══════════════════════════════════════════════════════
  -- v_ws_u: 3 members (v_fresh owner joined 2000, v_owner owner, v_member),
  -- 1 pending + 1 declined invite, 2 projects + 1 personal, 2 teams + 1
  -- personal (one regular team archived: all statuses count).

  insert into public.workspace_members (workspace_id, user_id, role, joined_at) values
    (v_ws_u, v_fresh, 'owner', '2000-01-01T00:00:00Z'),
    (v_ws_u, v_owner, 'owner', now()),
    (v_ws_u, v_member, 'member', now());

  insert into public.workspace_invites (workspace_id, invited_by, invitee_email, status) values
    (v_ws_u, v_owner, 'plan-limits-pending@example.invalid', 'pending'),
    (v_ws_u, v_owner, 'plan-limits-declined@example.invalid', 'declined');

  insert into public.projects (owner_id, title, workspace_id)
    values (v_owner, 'plan-limits-test project', v_ws_u) returning id into v_project;
  insert into public.projects (owner_id, title, workspace_id, status)
    values (v_owner, 'plan-limits-test archived project', v_ws_u, 'archived')
    returning id into v_archived_project;
  insert into public.projects (owner_id, title, workspace_id)
    values (v_pp_user, 'plan-limits-test personal project', v_ws_u) returning id into v_personal_project;
  insert into public.personal_projects (user_id, project_id) values (v_pp_user, v_personal_project);

  insert into public.teams (owner_id, name, workspace_id)
    values (v_owner, 'plan-limits-test team', v_ws_u) returning id into v_team;
  insert into public.teams (owner_id, name, workspace_id, status)
    values (v_owner, 'plan-limits-test archived team', v_ws_u, 'archived');
  insert into public.teams (owner_id, name, workspace_id, is_personal)
    values (v_owner, 'plan-limits-test personal team', v_ws_u, true);

  perform pg_temp.check(
    (select u.members = 3 and u.pending_invites = 1 and u.projects = 2 and u.teams = 2
       from public.workspace_usage_counts(array[v_ws_u]) u),
    format('usage counts exclude personal projects and teams: %s',
           (select row_to_json(u)::text from public.workspace_usage_counts(array[v_ws_u]) u)));
  perform pg_temp.check(
    (select u.members = 0 and u.pending_invites = 0 and u.projects = 0 and u.teams = 0
       from public.workspace_usage_counts(array[v_ws_b]) u),
    'an empty workspace counts zero');
  perform pg_temp.check(
    (select count(*) from public.workspace_usage_counts(array[v_ws_u, v_ws_u, gen_random_uuid()])) = 1,
    'usage drops unknown ids and collapses duplicates');

  -- ══ 9. user_default_workspace_id and workspace_largest_roadmaps ══════════

  perform pg_temp.check(public.user_default_workspace_id(v_fresh) = v_ws_u,
    'earliest owner membership is the default workspace');
  perform pg_temp.check(
    public.user_default_workspace_id(v_owner) = (
      select m.workspace_id from public.workspace_members m
       where m.user_id = v_owner and m.role = 'owner'
       order by m.joined_at, m.workspace_id limit 1)
    and public.user_default_workspace_id(v_owner) <> v_ws_u,
    'v_owner keeps their older default workspace');
  perform pg_temp.check(public.user_default_workspace_id(v_member) is distinct from v_ws_u,
    'a plain member is not defaulted to the workspace');
  perform pg_temp.check(public.user_default_workspace_id(gen_random_uuid()) is null,
    'no owner membership means no default');

  insert into public.roadmaps (owner_id, project_id, name, preview_url)
    values (v_owner, v_project, 'plan-limits-test big', '') returning id into v_rm_big;
  -- One roadmap per project (uq_roadmaps_project_id_linked).
  insert into public.roadmaps (owner_id, project_id, name, preview_url)
    values (v_owner, v_archived_project, 'plan-limits-test empty', '') returning id into v_rm_empty;
  insert into public.roadmaps (owner_id, project_id, name, preview_url)
    values (v_owner, null, 'plan-limits-test owner draft', '') returning id into v_rm_owner_draft;
  insert into public.roadmaps (owner_id, project_id, name, preview_url)
    values (v_fresh, null, 'plan-limits-test fresh draft', '') returning id into v_rm_fresh_draft;

  insert into public.roadmap_epics (roadmap_id, title, position)
    values (v_rm_big, 'epic', 0) returning id into v_epic;
  insert into public.roadmap_features (epic_id, roadmap_id, title, position)
    values (v_epic, v_rm_big, 'feature', 0) returning id into v_feature;
  insert into public.roadmap_tasks (feature_id, title, position) values
    (v_feature, 'task one', 0),
    (v_feature, 'task two', 1);

  perform pg_temp.check(
    (select array_agg(x.roadmap_id order by x.nodes desc, x.roadmap_id)
       from public.workspace_largest_roadmaps(v_ws_u, 10) x)
      = (select array_agg(y.id order by y.n desc, y.id)
           from (values (v_rm_big, 4), (v_rm_empty, 0), (v_rm_fresh_draft, 0)) y(id, n)),
    'largest roadmaps: the workspace''s project roadmaps plus the drafts of owners defaulted here, not other owners'' drafts');
  perform pg_temp.check(
    (select x.roadmap_id = v_rm_big and x.nodes = 4 and x.name = 'plan-limits-test big'
            and x.project_id = v_project and x.project_title = 'plan-limits-test project'
            and x.owner_id = v_owner
       from public.workspace_largest_roadmaps(v_ws_u, 1) x),
    'largest roadmap first, nodes = epics + features + tasks, with project and owner');
  perform pg_temp.check((select count(*) from public.workspace_largest_roadmaps(v_ws_u, 1)) = 1,
    'p_limit bounds the rows');
  perform pg_temp.check(
    (select x.project_id is null and x.project_title is null and x.owner_id = v_fresh
       from public.workspace_largest_roadmaps(v_ws_u, 10) x where x.roadmap_id = v_rm_fresh_draft),
    'a draft carries no project');

  -- ══ 10. entitlement_subject ══════════════════════════════════════════════

  perform pg_temp.check(
    (select s.found and s.workspace_id = v_ws_u and not s.exempt
       from public.entitlement_subject('project', v_project) s),
    'project resolves to its workspace');
  perform pg_temp.check(
    (select s.found and s.workspace_id = v_ws_u and not s.exempt
       from public.entitlement_subject('team', v_team) s),
    'team resolves to its workspace');
  perform pg_temp.check(
    (select s.found and s.workspace_id = v_ws_u and not s.exempt
       from public.entitlement_subject('roadmap', v_rm_big) s),
    'linked roadmap resolves to its project''s workspace');
  perform pg_temp.check(
    (select s.found and s.workspace_id = public.user_default_workspace_id(v_owner)
            and s.workspace_id is not null and not s.exempt
       from public.entitlement_subject('roadmap', v_rm_owner_draft) s),
    'unlinked roadmap resolves to its owner''s default workspace');
  perform pg_temp.check(
    (select s.found and s.workspace_id = v_ws_u and not s.exempt
       from public.entitlement_subject('roadmap', v_rm_fresh_draft) s),
    'unlinked roadmap of an owner defaulted here resolves here');
  perform pg_temp.check(
    (select not s.found and s.workspace_id is null and not s.exempt
       from public.entitlement_subject('project', gen_random_uuid()) s),
    'missing project: found = false');
  perform pg_temp.check(
    (select count(*) from public.entitlement_subject('roadmap', gen_random_uuid())) = 1,
    'always exactly one row');
  perform pg_temp.expect_error(
    format('select * from public.entitlement_subject(%L, %L)', 'workspace', v_ws_u),
    '22023', 'unknown kind', 'entitlement_subject_unknown_kind');

  insert into public.projects (owner_id, title, workspace_id)
    values (v_owner, 'plan-limits-test unhomed project', null) returning id into v_unhomed_project;
  perform pg_temp.check(
    (select s.found and s.workspace_id is null and not s.exempt
       from public.entitlement_subject('project', v_unhomed_project) s),
    'unhomed project of a real user: Free, not exempt');

  update public.profiles set is_guest = true where id = v_guest;
  insert into public.projects (owner_id, title, workspace_id)
    values (v_guest, 'plan-limits-test guest project', null) returning id into v_guest_project;
  insert into public.roadmaps (owner_id, project_id, name, preview_url)
    values (v_guest, null, 'plan-limits-test guest draft', '') returning id into v_rm_guest_draft;
  perform pg_temp.check(
    (select s.found and s.workspace_id is null and s.exempt
       from public.entitlement_subject('project', v_guest_project) s),
    'guest-owned unhomed project is exempt');
  perform pg_temp.check(
    (select s.found and s.workspace_id is null and s.exempt
       from public.entitlement_subject('roadmap', v_rm_guest_draft) s),
    'guest draft roadmap is exempt');

  -- ══ 11. admin_list_workspaces ════════════════════════════════════════════

  select * into rec from public.admin_list_workspaces('plan-limits-test u', 'all', 25, 0);
  perform pg_temp.check(
    rec.id = v_ws_u and rec.slug = 'plan-limits-test-u' and rec.owner_id = v_fresh
    and rec.owner_email is not distinct from (select p.email from public.profiles p where p.id = v_fresh)
    and rec.members = 3 and rec.pending_invites = 1 and rec.projects = 2 and rec.teams = 2
    and rec.effective_plan = 'free' and rec.plan_source = 'default' and rec.total_count = 1,
    format('admin list row for v_ws_u: %s', row_to_json(rec)::text));

  perform pg_temp.check(
    (select count(*) from public.admin_list_workspaces('plan-limits-test', 'all', 100, 0)) = 13
    and (select max(x.total_count) from public.admin_list_workspaces('plan-limits-test', 'all', 100, 0) x) = 13,
    'search matches every fixture workspace');
  perform pg_temp.check(
    (select array_agg(x.name order by x.name) from public.admin_list_workspaces('plan-limits-test', 'comped', 100, 0) x)
      = array['plan-limits-test e', 'plan-limits-test f', 'plan-limits-test g', 'plan-limits-test h',
              'plan-limits-test j'],
    'comped filter: every workspace holding a comp row, lapsed included');
  perform pg_temp.check(
    (select array_agg(x.name order by x.name) from public.admin_list_workspaces('plan-limits-test', 'paid', 100, 0) x)
      = array['plan-limits-test b', 'plan-limits-test d', 'plan-limits-test f', 'plan-limits-test g',
              'plan-limits-test i', 'plan-limits-test j'],
    'paid filter: plan_source = subscription');
  perform pg_temp.check(
    (select array_agg(x.name order by x.name) from public.admin_list_workspaces('plan-limits-test', 'free', 100, 0) x)
      = array['plan-limits-test a', 'plan-limits-test c', 'plan-limits-test h', 'plan-limits-test k',
              'plan-limits-test s', 'plan-limits-test u'],
    'free filter: effective plan free');
  perform pg_temp.check(
    (select count(*) = 1 and max(x.total_count) = 13
       from public.admin_list_workspaces('plan-limits-test', 'all', 0, 0) x),
    'limit clamps to at least 1 and total_count is pre-pagination');
  perform pg_temp.check(
    (select count(*) from public.admin_list_workspaces('plan-limits-test', 'all', 5, 10)) = 3,
    'offset pages through the matches');
  perform pg_temp.check(
    (select count(*) from public.admin_list_workspaces(
       (select p.email from public.profiles p where p.id = v_fresh), 'all', 100, 0) x
      where x.id = v_ws_u) = 1,
    'search matches an owner''s email');
  perform pg_temp.check(
    (select count(*) from public.admin_list_workspaces('plan\_limits\_test', 'all', 100, 0)) = 0,
    'escaped wildcards match literally');
  perform pg_temp.check(
    (select count(*) from public.admin_list_workspaces(null, null, 100, 0))
      = least((select count(*) from public.workspaces), 100),
    'null search and filter list everything');
  perform pg_temp.expect_error(
    $q$select * from public.admin_list_workspaces(null, 'bogus', 10, 0)$q$,
    '22023', 'unknown filter', 'admin_list_workspaces_invalid_filter');
end;
$$;

rollback;
