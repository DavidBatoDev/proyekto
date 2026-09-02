-- Organizational seed for Prodigitality Services Inc.
--
-- The general backfill (20260902090400) gives every user a solo workspace,
-- deliberately inferring nothing from team membership. This is the one
-- hand-reviewed exception: the Prodigitality team is a real organization, so
-- its 14 members become members of one "Prodigitality Workspace" that holds
-- the team and the 17 projects attached to it. Requested 2026-09-01.
--
-- Ordering matters. This MUST run after the general backfill: if it ran first,
-- the owner would already hold an owner-role membership, the backfill would skip
-- creating his personal workspace, and his unrelated teams and projects would
-- be filed into the organization. Run after, they stay in his own workspace.
--
-- Keyed on natural identifiers (team name + owner email), never on generated
-- ids, and a no-op where that team does not exist — which is how it stays
-- applicable to hosted dev without seeding anything there.

DO $$
DECLARE
  v_team_id uuid;
  v_owner_id uuid;
  v_workspace_id uuid;
  v_members integer;
  v_projects integer;
BEGIN
  SELECT t.id, t.owner_id
  INTO v_team_id, v_owner_id
  FROM public.teams t
  JOIN public.profiles p ON p.id = t.owner_id
  WHERE t.name = 'Prodigitality Services Inc. Team'
    AND lower(p.email) = 'august.teleg@gmail.com';

  IF v_team_id IS NULL THEN
    RAISE NOTICE 'seed_prodigitality_workspace: team not present in this environment; nothing to do';
    RETURN;
  END IF;

  SELECT w.id
  INTO v_workspace_id
  FROM public.workspaces w
  WHERE w.name = 'Prodigitality Workspace'
    AND w.created_by = v_owner_id;

  IF v_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, created_by)
    VALUES ('Prodigitality Workspace', v_owner_id)
    RETURNING id INTO v_workspace_id;
  END IF;

  -- Team roles map one-to-one onto workspace roles, and the real join dates
  -- come along. The dates are load-bearing, not decorative: the default
  -- workspace is the earliest owner-role membership, so the owner's May 2026
  -- date makes this organization his default ahead of the personal workspace
  -- the backfill created at apply time. Re-runs never push a date later.
  INSERT INTO public.workspace_members (workspace_id, user_id, role, joined_at)
  SELECT v_workspace_id, tm.user_id, tm.role, tm.joined_at
  FROM public.team_members tm
  WHERE tm.team_id = v_team_id
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        joined_at = LEAST(public.workspace_members.joined_at, EXCLUDED.joined_at);

  INSERT INTO public.workspace_subscriptions (workspace_id)
  VALUES (v_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  UPDATE public.teams
  SET workspace_id = v_workspace_id
  WHERE id = v_team_id;

  UPDATE public.projects pr
  SET workspace_id = v_workspace_id
  FROM public.project_teams pt
  WHERE pt.project_id = pr.id
    AND pt.team_id = v_team_id;

  SELECT count(*) INTO v_members FROM public.workspace_members WHERE workspace_id = v_workspace_id;
  SELECT count(*) INTO v_projects FROM public.projects WHERE workspace_id = v_workspace_id;
  RAISE NOTICE 'seed_prodigitality_workspace: workspace % now holds % members and % projects',
    v_workspace_id, v_members, v_projects;
END $$;
