/**
 * Real-DB tests for the user-scoped AI context family (`/api/ai/context/*`,
 * PR1 of the agent re-architecture) against the hosted dev project.
 *
 * What a mocked test cannot prove and this one does: that the three
 * `ai_context_*` RPCs (Migration A) and `search_knowledge_chunks_projects`
 * (Migration B) exist with the argument names the repository passes, that the
 * lanes come out of real workspace memberships, that `assigned_to_me` honours
 * the join table with a NULL legacy `assignee_id`, that a NULL task status
 * counts as open, that resolve-refs fails closed on real rows the caller cannot
 * view, and that a run-attributed commit lands `session_id`/`run_id` in
 * `roadmap_change_history` and comes back through `GET changes`.
 *
 * Fixtures (per the plan): owner / member / outsider; workspace W (owner +
 * member); project A in W with roadmap A (epic, feature, three tasks - one
 * assigned to member through the join table only); unhomed project B (owner);
 * outsider's project C in no workspace; a second workspace W2 (owner only)
 * with project D so `other_workspace` has something to land on. Self-cleaning
 * via Harness (sessions/history cascade from roadmaps and workspaces).
 */
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

const epicOp = (title: string) => ({ op: 'add_epic', data: { title } });

type Lane = 'current' | 'shared' | 'other_workspace';
type LanedItem = { id: string; lane: Lane };
type SearchMatch = {
  id: string;
  kind: string;
  roadmap_id: string | null;
  project_id: string | null;
  workspace_id: string | null;
  roadmap_name: string | null;
};
type TaskItem = {
  id: string;
  status: string;
  roadmap_id: string;
  project_id: string | null;
  workspace_id: string | null;
  assignee_ids: string[];
  feature_id: string;
  epic_id: string | null;
};
type ResolvedRef = {
  kind: string;
  id: string;
  accessible: boolean;
  title?: string;
  workspace_id?: string | null;
  project_id?: string | null;
  roadmap_id?: string | null;
  parent_chain?: Array<{ kind: string; id: string; title: string }>;
  error_code?: string;
};

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

describe('AI context family (/api/ai/context)', () => {
  const h = new Harness();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, token: string) =>
    request(h.server()).get(path).set(auth(token));

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let member: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;

  let workspaceW: string;
  let workspaceW2: string;
  let projectA: string;
  let projectB: string;
  let projectC: string;
  let projectD: string;
  let roadmapA: string;
  let roadmapB: string;
  let roadmapC: string;
  let roadmapD: string;
  let epicA: string;
  let featureA: string;
  let taskAssigned: string;
  let taskOverdueNullStatus: string;
  let taskDone: string;
  let epicC: string;
  let taskC: string;
  let teamT: string;
  let teamOutsider: string;

  // Unique needle for the search lane: shared by epic A and epic C on purpose,
  // so the same query proves attribution for the owner and emptiness for
  // roadmaps the caller cannot see.
  let needle: string;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('aic-owner');
    member = await h.createUser('aic-member');
    outsider = await h.createUser('aic-outsider');
    needle = `alpha launch ${h.runId}`;

    workspaceW = await h.createWorkspace(owner.id, 'w');
    await h.addWorkspaceMember(workspaceW, member.id, 'member');
    workspaceW2 = await h.createWorkspace(owner.id, 'w2');

    // Project A in W: owner owns, member is an editor.
    projectA = await h.createProject(owner.id, 'aic project A');
    await h.grantAccess(projectA, owner.id, 'owner');
    await h.grantAccess(projectA, member.id, 'editor');
    await h.setProjectWorkspace(projectA, workspaceW);
    roadmapA = await h.createRoadmap(owner.id, projectA);
    epicA = await h.createEpic(roadmapA, `Alpha Launch ${h.runId}`);
    featureA = await h.createFeature(epicA, roadmapA);
    taskAssigned = await h.createTask(featureA, 0, {
      title: `Alpha task ${h.runId}`,
    });
    // Join table only - the legacy roadmap_tasks.assignee_id stays NULL.
    await h.addTaskAssignee(taskAssigned, member.id);
    // Past due with an explicit NULL status: must count as todo (open) and
    // overdue everywhere the RPCs COALESCE the status.
    taskOverdueNullStatus = await h.createTask(featureA, 1, {
      title: `Overdue task ${h.runId}`,
      due_date: isoDaysFromNow(-2),
      status: null,
    });
    // Done and past due: neither open nor overdue.
    taskDone = await h.createTask(featureA, 2, {
      title: `Done task ${h.runId}`,
      due_date: isoDaysFromNow(-2),
      status: 'done',
    });

    // Unhomed project B: owner only.
    projectB = await h.createProject(owner.id, 'aic project B');
    await h.grantAccess(projectB, owner.id, 'owner');
    roadmapB = await h.createRoadmap(owner.id, projectB);

    // Outsider's project C, no workspace, with the same epic title as A.
    projectC = await h.createProject(outsider.id, 'aic project C');
    await h.grantAccess(projectC, outsider.id, 'owner');
    roadmapC = await h.createRoadmap(outsider.id, projectC);
    epicC = await h.createEpic(roadmapC, `Alpha Launch ${h.runId}`);
    const featureC = await h.createFeature(epicC, roadmapC);
    taskC = await h.createTask(featureC, 0, { title: `C task ${h.runId}` });

    // Project D in W2 (owner only) so the owner's W view has an
    // `other_workspace` item.
    projectD = await h.createProject(owner.id, 'aic project D');
    await h.grantAccess(projectD, owner.id, 'owner');
    await h.setProjectWorkspace(projectD, workspaceW2);
    roadmapD = await h.createRoadmap(owner.id, projectD);

    teamT = await h.createTeam(owner.id, workspaceW, 'aic team');
    await h.addTeamMember(teamT, member.id, 'member');
    teamOutsider = await h.createTeam(outsider.id, null, 'aic outsider team');
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  // ── actor ─────────────────────────────────────────────────────────────────
  describe('GET actor', () => {
    it('returns the caller and the fixed null locale/timezone', async () => {
      const res = await get('/api/ai/context/actor', owner.token).expect(200);
      expect(res.body.data).toEqual({
        actor_id: owner.id,
        display_name: null,
        locale: null,
        timezone: null,
      });
    });

    it('rejects an unauthenticated call', async () => {
      await request(h.server()).get('/api/ai/context/actor').expect(401);
    });
  });

  // ── overview ──────────────────────────────────────────────────────────────
  describe('GET overview', () => {
    const laneOf = (items: LanedItem[], id: string) =>
      items.find((item) => item.id === id)?.lane;

    it('lanes every accessible item against the requested workspace', async () => {
      const res = await get(
        `/api/ai/context/overview?workspace_id=${workspaceW}`,
        owner.token,
      ).expect(200);
      const data = res.body.data;

      expect(data.workspace).toMatchObject({
        id: workspaceW,
        my_role: 'owner',
      });
      expect(typeof data.workspace.slug).toBe('string');
      expect(data.counts_truncated).toBe(false);

      const projects = data.projects as Array<
        LanedItem & { my_role: string | null; roadmap_id: string | null }
      >;
      expect(laneOf(projects, projectA)).toBe('current');
      expect(laneOf(projects, projectB)).toBe('shared');
      expect(laneOf(projects, projectD)).toBe('other_workspace');
      expect(projects.some((p) => p.id === projectC)).toBe(false);
      const projectRowA = projects.find((p) => p.id === projectA)!;
      expect(projectRowA.my_role).toBe('owner');
      expect(projectRowA.roadmap_id).toBe(roadmapA);

      const roadmaps = data.roadmaps as Array<
        LanedItem & {
          counts: Record<string, number>;
          project_id: string | null;
          workspace_id: string | null;
        }
      >;
      expect(laneOf(roadmaps, roadmapA)).toBe('current');
      expect(laneOf(roadmaps, roadmapB)).toBe('shared');
      expect(laneOf(roadmaps, roadmapD)).toBe('other_workspace');
      expect(roadmaps.some((r) => r.id === roadmapC)).toBe(false);

      // Counts come from ai_context_roadmap_counts: the NULL-status task is
      // open AND overdue, the done task is neither.
      const roadmapRowA = roadmaps.find((r) => r.id === roadmapA)!;
      expect(roadmapRowA.project_id).toBe(projectA);
      expect(roadmapRowA.workspace_id).toBe(workspaceW);
      expect(roadmapRowA.counts).toEqual({
        epics: 1,
        features: 1,
        tasks: 3,
        open_tasks: 2,
        overdue_tasks: 1,
      });

      const teams = data.teams as Array<LanedItem & { my_role: string | null }>;
      expect(laneOf(teams, teamT)).toBe('current');
      expect(teams.find((t) => t.id === teamT)!.my_role).toBe('owner');
      expect(teams.some((t) => t.id === teamOutsider)).toBe(false);
    });

    it('shows a workspace member only what project_access grants', async () => {
      const res = await get(
        `/api/ai/context/overview?workspace_id=${workspaceW}`,
        member.token,
      ).expect(200);
      const data = res.body.data;
      expect(data.workspace).toMatchObject({
        id: workspaceW,
        my_role: 'member',
      });

      const projects = data.projects as Array<LanedItem & { my_role: string }>;
      expect(laneOf(projects, projectA)).toBe('current');
      expect(projects.find((p) => p.id === projectA)!.my_role).toBe('editor');
      // Workspace membership is not project access: B and D stay invisible.
      expect(projects.some((p) => p.id === projectB)).toBe(false);
      expect(projects.some((p) => p.id === projectD)).toBe(false);

      const teams = data.teams as Array<LanedItem & { my_role: string | null }>;
      expect(teams.find((t) => t.id === teamT)!.my_role).toBe('member');
    });

    it('answers 404 for a workspace the caller is not a member of', async () => {
      await get(
        `/api/ai/context/overview?workspace_id=${workspaceW}`,
        outsider.token,
      ).expect(404);
    });

    it('works without a workspace, laning everything the caller reaches', async () => {
      const res = await get('/api/ai/context/overview', outsider.token).expect(
        200,
      );
      const data = res.body.data;
      expect(data.workspace).toBeNull();
      const projects = data.projects as LanedItem[];
      expect(projects.map((p) => p.id)).toEqual([projectC]);
      // Unhomed and in no workspace of the caller's: shared.
      expect(laneOf(projects, projectC)).toBe('shared');
      expect((data.roadmaps as LanedItem[]).map((r) => r.id)).toEqual([
        roadmapC,
      ]);
    });

    it('rejects a non-uuid workspace_id', async () => {
      await get(
        '/api/ai/context/overview?workspace_id=nope',
        owner.token,
      ).expect(400);
    });
  });

  // ── roadmaps ──────────────────────────────────────────────────────────────
  describe('GET roadmaps', () => {
    it('filters by workspace and pages with a keyset cursor', async () => {
      const inW = await get(
        `/api/ai/context/roadmaps?workspace_id=${workspaceW}`,
        owner.token,
      ).expect(200);
      expect(
        (inW.body.data.items as Array<{ id: string }>).map((i) => i.id),
      ).toEqual([roadmapA]);
      expect(inW.body.data.next_cursor).toBeNull();

      const page1 = await get(
        '/api/ai/context/roadmaps?limit=2',
        owner.token,
      ).expect(200);
      expect(page1.body.data.items).toHaveLength(2);
      expect(typeof page1.body.data.next_cursor).toBe('string');

      const page2 = await get(
        `/api/ai/context/roadmaps?limit=2&cursor=${encodeURIComponent(
          page1.body.data.next_cursor as string,
        )}`,
        owner.token,
      ).expect(200);
      const ids = [...page1.body.data.items, ...page2.body.data.items].map(
        (i: { id: string }) => i.id,
      );
      expect(new Set(ids)).toEqual(new Set([roadmapA, roadmapB, roadmapD]));
      expect(page2.body.data.next_cursor).toBeNull();
    });

    it('rejects a malformed cursor', async () => {
      await get(
        '/api/ai/context/roadmaps?cursor=not-a-cursor',
        owner.token,
      ).expect(400);
    });
  });

  // ── search ────────────────────────────────────────────────────────────────
  describe('GET search', () => {
    it('finds nodes across accessible roadmaps with full attribution', async () => {
      const res = await get(
        `/api/ai/context/search?q=${encodeURIComponent(needle)}&kinds=epic`,
        owner.token,
      ).expect(200);
      const matches = res.body.data.matches as SearchMatch[];
      expect(matches.map((m) => m.id)).toEqual([epicA]);
      expect(matches[0]).toMatchObject({
        kind: 'epic',
        roadmap_id: roadmapA,
        project_id: projectA,
        workspace_id: workspaceW,
      });
      expect(matches[0].roadmap_name).toBeTruthy();
    });

    it('is empty for an outsider on those roadmaps and non-empty on their own', async () => {
      const res = await get(
        `/api/ai/context/search?q=${encodeURIComponent(needle)}&kinds=epic`,
        outsider.token,
      ).expect(200);
      const matches = res.body.data.matches as SearchMatch[];
      expect(matches.map((m) => m.id)).toEqual([epicC]);
      expect(matches[0].roadmap_id).toBe(roadmapC);
    });

    it('never widens through roadmap_ids', async () => {
      const res = await get(
        `/api/ai/context/search?q=${encodeURIComponent(
          needle,
        )}&kinds=epic&roadmap_ids=${roadmapC}`,
        owner.token,
      ).expect(200);
      expect(res.body.data.matches).toEqual([]);
    });

    it('matches roadmaps and tasks in-process and via the RPC', async () => {
      const roadmapHits = await get(
        `/api/ai/context/search?q=${encodeURIComponent(
          `itest roadmap ${h.runId}`,
        )}&kinds=roadmap&workspace_id=${workspaceW}`,
        owner.token,
      ).expect(200);
      expect(
        (roadmapHits.body.data.matches as SearchMatch[]).map((m) => m.id),
      ).toEqual([roadmapA]);

      const taskHits = await get(
        `/api/ai/context/search?q=${encodeURIComponent(
          `alpha task ${h.runId}`,
        )}&kinds=task`,
        member.token,
      ).expect(200);
      const tasks = taskHits.body.data.matches as SearchMatch[];
      expect(tasks.map((m) => m.id)).toEqual([taskAssigned]);
      expect(tasks[0].roadmap_id).toBe(roadmapA);
    });

    it('rejects an unknown kind and an empty query', async () => {
      await get('/api/ai/context/search?q=x&kinds=comment', owner.token).expect(
        400,
      );
      await get('/api/ai/context/search?q=', owner.token).expect(400);
    });
  });

  // ── tasks ─────────────────────────────────────────────────────────────────
  describe('GET tasks', () => {
    const ids = (res: request.Response) =>
      (res.body.data.tasks as TaskItem[]).map((t) => t.id);

    it('assigned_to_me honours the join table with a NULL legacy assignee_id', async () => {
      const mine = await get(
        '/api/ai/context/tasks?assigned_to_me=true',
        member.token,
      ).expect(200);
      expect(ids(mine)).toEqual([taskAssigned]);
      const task = (mine.body.data.tasks as TaskItem[])[0];
      expect(task).toMatchObject({
        roadmap_id: roadmapA,
        project_id: projectA,
        workspace_id: workspaceW,
        feature_id: featureA,
        epic_id: epicA,
        assignee_ids: [member.id],
      });

      const ownersOwn = await get(
        '/api/ai/context/tasks?assigned_to_me=true',
        owner.token,
      ).expect(200);
      expect(ids(ownersOwn)).not.toContain(taskAssigned);
    });

    it('treats a NULL status as open and excludes done by default', async () => {
      const open = await get('/api/ai/context/tasks', owner.token).expect(200);
      expect(ids(open)).toEqual(
        expect.arrayContaining([taskAssigned, taskOverdueNullStatus]),
      );
      expect(ids(open)).not.toContain(taskDone);
      expect(
        (open.body.data.tasks as TaskItem[]).find(
          (t) => t.id === taskOverdueNullStatus,
        )!.status,
      ).toBe('todo');

      const done = await get(
        `/api/ai/context/tasks?status=done&roadmap_ids=${roadmapA}`,
        owner.token,
      ).expect(200);
      expect(ids(done)).toEqual([taskDone]);

      const all = await get(
        `/api/ai/context/tasks?status=all&roadmap_ids=${roadmapA}`,
        owner.token,
      ).expect(200);
      expect(new Set(ids(all))).toEqual(
        new Set([taskAssigned, taskOverdueNullStatus, taskDone]),
      );
    });

    it('overdue keeps only open tasks whose due date has passed', async () => {
      const res = await get(
        '/api/ai/context/tasks?overdue=true',
        owner.token,
      ).expect(200);
      expect(ids(res)).toEqual([taskOverdueNullStatus]);
    });

    it('never widens through roadmap_ids and scopes an outsider to their own', async () => {
      const widened = await get(
        `/api/ai/context/tasks?roadmap_ids=${roadmapC}`,
        owner.token,
      ).expect(200);
      expect(widened.body.data.tasks).toEqual([]);

      const theirs = await get('/api/ai/context/tasks', outsider.token).expect(
        200,
      );
      expect(ids(theirs)).toEqual([taskC]);
      expect((theirs.body.data.tasks as TaskItem[])[0].roadmap_id).toBe(
        roadmapC,
      );
    });

    it('rejects an unknown status filter', async () => {
      await get('/api/ai/context/tasks?status=archived', owner.token).expect(
        400,
      );
    });
  });

  // ── resolve-refs ──────────────────────────────────────────────────────────
  describe('POST resolve-refs', () => {
    const resolve = (token: string, refs: unknown[]) =>
      request(h.server())
        .post('/api/ai/context/resolve-refs')
        .set(auth(token))
        .send({ refs });

    it('resolves a mixed batch, failing closed on rows the caller cannot view', async () => {
      const ghost = randomUUID();
      const res = await resolve(owner.token, [
        { kind: 'project', id: projectA, label: '@project-a' },
        { kind: 'project', id: projectA }, // duplicate: deduped
        { kind: 'roadmap', id: roadmapA },
        { kind: 'epic', id: epicA },
        { kind: 'feature', id: featureA },
        { kind: 'task', id: taskAssigned },
        { kind: 'team', id: teamT },
        { kind: 'project', id: projectC },
        { kind: 'roadmap', id: roadmapC },
        { kind: 'epic', id: epicC },
        { kind: 'team', id: teamOutsider },
        { kind: 'task', id: ghost },
      ]).expect(200);
      const refs = res.body.data.refs as ResolvedRef[];
      expect(refs).toHaveLength(11);
      const byKey = new Map(refs.map((r) => [`${r.kind}:${r.id}`, r]));

      const task = byKey.get(`task:${taskAssigned}`)!;
      expect(task.accessible).toBe(true);
      expect(task.title).toBe(`Alpha task ${h.runId}`);
      expect(task).toMatchObject({
        roadmap_id: roadmapA,
        project_id: projectA,
        workspace_id: workspaceW,
      });
      // Nearest-first: feature -> epic -> roadmap -> project -> workspace.
      expect(task.parent_chain!.map((p) => [p.kind, p.id])).toEqual([
        ['feature', featureA],
        ['epic', epicA],
        ['roadmap', roadmapA],
        ['project', projectA],
        ['workspace', workspaceW],
      ]);
      expect(task.parent_chain!.every((p) => p.title.length > 0)).toBe(true);

      expect(
        byKey.get(`roadmap:${roadmapA}`)!.parent_chain!.map((p) => p.kind),
      ).toEqual(['project', 'workspace']);
      expect(
        byKey.get(`project:${projectA}`)!.parent_chain!.map((p) => p.kind),
      ).toEqual(['workspace']);
      // A project ref carries its linked roadmap when the caller can view it.
      expect(byKey.get(`project:${projectA}`)).toMatchObject({
        roadmap_id: roadmapA,
      });
      expect(byKey.get(`team:${teamT}`)).toMatchObject({
        accessible: true,
        workspace_id: workspaceW,
      });
      expect(byKey.get(`epic:${epicA}`)!.accessible).toBe(true);
      expect(byKey.get(`feature:${featureA}`)!.accessible).toBe(true);

      for (const key of [
        `project:${projectC}`,
        `roadmap:${roadmapC}`,
        `epic:${epicC}`,
        `team:${teamOutsider}`,
        `task:${ghost}`,
      ]) {
        const denied = byKey.get(key)!;
        expect(denied).toMatchObject({
          accessible: false,
          error_code: 'NOT_FOUND',
        });
        // A denial never carries a title (no existence leak).
        expect(denied.title).toBeUndefined();
      }
    });

    it('resolves through project_access for a member and denies the rest', async () => {
      const res = await resolve(member.token, [
        { kind: 'task', id: taskAssigned },
        { kind: 'project', id: projectB },
        { kind: 'roadmap', id: roadmapD },
        { kind: 'team', id: teamT },
      ]).expect(200);
      const refs = res.body.data.refs as ResolvedRef[];
      expect(refs.map((r) => r.accessible)).toEqual([true, false, false, true]);
    });

    it('validates the batch shape', async () => {
      await resolve(owner.token, []).expect(400);
      await resolve(
        owner.token,
        Array.from({ length: 26 }, () => ({ kind: 'task', id: randomUUID() })),
      ).expect(400);
      await resolve(owner.token, [
        { kind: 'comment', id: randomUUID() },
      ]).expect(400);
      await resolve(owner.token, [{ kind: 'task', id: 'not-a-uuid' }]).expect(
        400,
      );
    });
  });

  // ── knowledge-search ──────────────────────────────────────────────────────
  describe('GET knowledge-search', () => {
    it('searches only the accessible subset of the requested projects', async () => {
      const res = await get(
        `/api/ai/context/knowledge-search?q=alpha&project_ids=${projectA},${projectB},${projectC}`,
        owner.token,
      ).expect(200);
      expect([...res.body.data.project_ids].sort()).toEqual(
        [projectA, projectB].sort(),
      );
      expect(res.body.data.query).toBe('alpha');
      expect(Array.isArray(res.body.data.results)).toBe(true);
    });

    it('narrows by workspace and defaults to everything reachable', async () => {
      const inW = await get(
        `/api/ai/context/knowledge-search?q=alpha&workspace_id=${workspaceW}`,
        owner.token,
      ).expect(200);
      expect(inW.body.data.project_ids).toEqual([projectA]);

      const mine = await get(
        '/api/ai/context/knowledge-search?q=alpha',
        member.token,
      ).expect(200);
      expect(mine.body.data.project_ids).toEqual([projectA]);
    });

    it('is a stable empty result when nothing is accessible', async () => {
      const res = await get(
        `/api/ai/context/knowledge-search?q=alpha&project_ids=${projectA}`,
        outsider.token,
      ).expect(200);
      expect(res.body.data).toEqual({
        project_ids: [],
        query: 'alpha',
        results: [],
      });
    });
  });

  // ── projects/:projectId ───────────────────────────────────────────────────
  describe('GET projects/:projectId', () => {
    it('serves the context pack to the owner and to a project member', async () => {
      const ownerRes = await get(
        `/api/ai/context/projects/${projectA}`,
        owner.token,
      ).expect(200);
      expect(ownerRes.body.data.project.id).toBe(projectA);
      const memberIds = (
        ownerRes.body.data.members as Array<{ id: string }>
      ).map((m) => m.id);
      expect(memberIds).toEqual(expect.arrayContaining([owner.id, member.id]));

      await get(`/api/ai/context/projects/${projectA}`, member.token).expect(
        200,
      );
      for (const sub of ['brief', 'resources', 'meetings']) {
        await get(
          `/api/ai/context/projects/${projectA}/${sub}`,
          owner.token,
        ).expect(200);
      }
    });

    it('lists members and member details, 404 for a non-member id', async () => {
      const list = await get(
        `/api/ai/context/projects/${projectA}/members`,
        owner.token,
      ).expect(200);
      expect(list.body.data.project_id).toBe(projectA);
      expect(
        (list.body.data.members as Array<{ id: string }>).map((m) => m.id),
      ).toContain(member.id);

      await get(
        `/api/ai/context/projects/${projectA}/members/${member.id}`,
        owner.token,
      ).expect(200);
      await get(
        `/api/ai/context/projects/${projectA}/members/${outsider.id}`,
        owner.token,
      ).expect(404);
    });

    it('answers 404 for an outsider and for a project the caller cannot see', async () => {
      await get(`/api/ai/context/projects/${projectA}`, outsider.token).expect(
        404,
      );
      await get(`/api/ai/context/projects/${projectC}`, owner.token).expect(
        404,
      );
      await get(
        `/api/ai/context/projects/${projectC}/members`,
        owner.token,
      ).expect(404);
    });

    it('rejects a non-uuid project id', async () => {
      await get('/api/ai/context/projects/nope', owner.token).expect(400);
    });
  });

  // ── changes (run-attributed commit) ───────────────────────────────────────
  describe('GET changes', () => {
    let projectE: string;
    let roadmapE: string;
    let sessionId: string;
    let runId: string;
    let changeId: string;

    beforeAll(async () => {
      // A dedicated roadmap so the commit cannot collide with the fixtures the
      // overview/search tests already asserted on.
      projectE = await h.createProject(owner.id, 'aic project E');
      await h.grantAccess(projectE, owner.id, 'owner');
      roadmapE = await h.createRoadmap(owner.id, projectE);

      const session = await request(h.server())
        .post(`/api/roadmaps/${roadmapE}/ai-sessions`)
        .set(auth(owner.token))
        .send({ title: `aic thread ${h.runId}` })
        .expect(201);
      sessionId = session.body.data.id as string;
      runId = randomUUID();
    });

    it('a run-attributed commit reports history_recorded and stamps the row', async () => {
      const res = await request(h.server())
        .post(`/api/roadmaps/${roadmapE}/ai/commit`)
        .set(auth(owner.token))
        .send({
          operations: [epicOp(`aic-run-${h.runId}`)],
          idempotency_key: `aic-run-${h.runId}`,
          run_id: runId,
          session_id: sessionId,
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.data.history_recorded).toBe(true);
      changeId = res.body.data.change_id as string;
      expect(changeId).toBeTruthy();

      const { data: row } = await h.admin
        .from('roadmap_change_history')
        .select('run_id, session_id, actor_id')
        .eq('change_id', changeId)
        .single();
      expect(row).toMatchObject({
        run_id: runId,
        session_id: sessionId,
        actor_id: owner.id,
      });

      // The 24h trimmed replay record carries the same outcome.
      const replay = await request(h.server())
        .post(`/api/roadmaps/${roadmapE}/ai/commit`)
        .set(auth(owner.token))
        .send({
          operations: [epicOp(`aic-run-${h.runId}`)],
          idempotency_key: `aic-run-${h.runId}`,
          run_id: runId,
          session_id: sessionId,
        });
      expect([200, 201]).toContain(replay.status);
      expect(replay.body.data.change_id).toBe(changeId);
      expect(replay.body.data.history_recorded).toBe(true);
      expect(replay.body.data.candidate_snapshot).toBeUndefined();
    });

    it('lists the run and the session, scoped to the actor and the viewable roadmaps', async () => {
      const byRun = await get(
        `/api/ai/context/changes?run_id=${runId}`,
        owner.token,
      ).expect(200);
      expect(byRun.body.data.changes).toHaveLength(1);
      expect(byRun.body.data.changes[0]).toMatchObject({
        change_id: changeId,
        roadmap_id: roadmapE,
        project_id: projectE,
        status: 'applied',
        operations_count: 1,
        run_id: runId,
        session_id: sessionId,
      });

      const bySession = await get(
        `/api/ai/context/changes?session_id=${sessionId}`,
        owner.token,
      ).expect(200);
      expect(
        (bySession.body.data.changes as Array<{ change_id: string }>).map(
          (c) => c.change_id,
        ),
      ).toEqual([changeId]);

      // Another actor never sees it, even with the exact run id.
      const theirs = await get(
        `/api/ai/context/changes?run_id=${runId}`,
        outsider.token,
      ).expect(200);
      expect(theirs.body.data.changes).toEqual([]);
    });

    it('requires exactly one selector', async () => {
      await get('/api/ai/context/changes', owner.token).expect(400);
      await get(
        `/api/ai/context/changes?run_id=${runId}&session_id=${sessionId}`,
        owner.token,
      ).expect(400);
      await get('/api/ai/context/changes?run_id=nope', owner.token).expect(400);
    });

    it('a foreign session id is dropped from attribution, never a 4xx', async () => {
      // Fresh UNLINKED roadmap: keeps this commit independent of the run above
      // (a project holds at most one linked roadmap - uq_roadmaps_project_id_linked).
      const roadmapF = await h.createRoadmap(owner.id);
      const res = await request(h.server())
        .post(`/api/roadmaps/${roadmapF}/ai/commit`)
        .set(auth(owner.token))
        .send({
          operations: [epicOp(`aic-foreign-${h.runId}`)],
          idempotency_key: `aic-foreign-${h.runId}`,
          run_id: randomUUID(),
          session_id: randomUUID(),
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.data.history_recorded).toBe(true);
      const { data: row } = await h.admin
        .from('roadmap_change_history')
        .select('session_id, run_id')
        .eq('change_id', res.body.data.change_id as string)
        .single();
      expect(row?.session_id).toBeNull();
      expect(row?.run_id).toBeTruthy();
    });
  });
});
