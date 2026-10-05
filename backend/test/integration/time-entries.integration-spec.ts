/**
 * /api/time entries over HTTP against hosted dev (P10, backend.md › Endpoints, edge-cases › time-entries row):
 * one of two concurrent starts wins (E4, D07); the timer round trip (pause, resume, stop, stop again);
 * a viewer gets 403 NO_LOGGING_CONTEXT and an empty picker (E24); a stranger 404s on the project and the entry
 * (E65); a guest 404s on writes while `me/running` is `null` and `me/overview` the empty shape (D08, E66);
 * personal time on a Free workspace (E49); manual time, a stale `expected_updated_at` (D42), delete; comments.
 *
 * Runs after M2/M3 are applied to dev (§6 step 4) and after P17 registers TimeEntriesController in TimeModule
 * and TimeModule in AppModule. Never against production (describeDevOnly). Self-cleaning: the harness's
 * cleanup() calls time_test_cleanup per project (entries and emptied sheets), then the LIFO deletes.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Harness, describeDevOnly } from './harness';

jest.setTimeout(180000);

type User = Awaited<ReturnType<Harness['createUser']>>;

describeDevOnly('time entries (real DB)', () => {
  const h = new Harness();

  let owner: User;
  let editor: User;
  let viewer: User;
  let stranger: User;
  let solo: User;
  let guest: User;
  let guestSession: string;
  let workspaceId: string;
  let teamId: string;
  let projectId: string;
  let freeProjectId: string;

  const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });
  const api = (path: string) => `/api/time${path}`;

  beforeAll(async () => {
    owner = await h.createUser('time-owner');
    editor = await h.createUser('time-editor');
    viewer = await h.createUser('time-viewer');
    stranger = await h.createUser('time-stranger');
    solo = await h.createUser('time-solo');
    guest = await h.createUser('time-guest');
    guestSession = randomUUID();
    await h.admin
      .from('profiles')
      .update({ is_guest: true, guest_session_id: guestSession })
      .eq('id', guest.id);

    // A Business-comped workspace (time_tracking) with a team that tracks time, attached and curated.
    workspaceId = await h.createWorkspace(owner.id, 'time');
    await h.compWorkspace(workspaceId, 'business');
    teamId = await h.createTeam(owner.id, workspaceId, 'itest time team');
    await h.setTeamTime(teamId, { time_tracking_enabled: true });
    projectId = await h.createProject(owner.id, 'itest time project');
    await h.setProjectWorkspace(projectId, workspaceId);
    await h.attachTeam(projectId, teamId, true);
    for (const [user, role] of [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ] as const) {
      await h.grantAccess(projectId, user.id, role);
      await h.addTeamMember(teamId, user.id);
      await h.curateTeamMember(projectId, teamId, user.id);
    }

    // A Free workspace where its owner has no team: "Just me" (personal_reason 'plan').
    const freeWs = await h.createWorkspace(solo.id, 'time-free');
    freeProjectId = await h.createProject(solo.id, 'itest time free');
    await h.setProjectWorkspace(freeProjectId, freeWs);

    await h.boot();
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  it('the picker offers the curated team to an editor and nothing to a viewer', async () => {
    const mine = await request(h.server())
      .get(api(`/projects/${projectId}/logging-for`))
      .set(auth(editor))
      .expect(200);
    expect(mine.body.data.selected).toMatchObject({ kind: 'team', id: teamId });

    const theirs = await request(h.server())
      .get(api(`/projects/${projectId}/logging-for`))
      .set(auth(viewer))
      .expect(200);
    expect(theirs.body.data).toMatchObject({ options: [], reason: 'none' });
  });

  it('one of two concurrent starts wins; the other is 409 TIMER_ALREADY_RUNNING', async () => {
    const [a, b] = await Promise.all([
      request(h.server())
        .post(api('/entries/start'))
        .set(auth(editor))
        .send({ project_id: projectId }),
      request(h.server())
        .post(api('/entries/start'))
        .set(auth(editor))
        .send({ project_id: projectId }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('TIMER_ALREADY_RUNNING');
    const winner = a.status === 201 ? a : b;
    expect(winner.body.data).toMatchObject({
      context_kind: 'team',
      team_id: teamId,
      source: 'timer',
      ended_at: null,
      warnings: [],
    });
    expect(winner.body.data).not.toHaveProperty('status');

    const running = await request(h.server())
      .get(api('/me/running'))
      .set(auth(editor))
      .expect(200);
    expect(running.body.data.id).toBe(winner.body.data.id);
  });

  it('pause, resume, stop; stopping again is 409 TIMER_NOT_RUNNING', async () => {
    const running = await request(h.server())
      .get(api('/me/running'))
      .set(auth(editor))
      .expect(200);
    const id = running.body.data.id as string;

    const paused = await request(h.server())
      .post(api(`/entries/${id}/pause`))
      .set(auth(editor))
      .expect(200);
    expect(paused.body.data.paused_at).not.toBeNull();
    await request(h.server())
      .post(api(`/entries/${id}/resume`))
      .set(auth(editor))
      .expect(200);
    const stopped = await request(h.server())
      .post(api(`/entries/${id}/stop`))
      .set(auth(editor))
      .send({})
      .expect(200);
    expect(stopped.body.data.ended_at).not.toBeNull();
    expect(stopped.body.data.timesheet_id).not.toBeNull();

    const again = await request(h.server())
      .post(api(`/entries/${id}/stop`))
      .set(auth(editor))
      .expect(409);
    expect(again.body.error.code).toBe('TIMER_NOT_RUNNING');

    const segments = await request(h.server())
      .get(api(`/entries/${id}/segments`))
      .set(auth(editor))
      .expect(200);
    expect(segments.body.data.map((s: { kind: string }) => s.kind)).toEqual([
      'work',
      'break',
      'work',
    ]);
  });

  it('a viewer gets 403 NO_LOGGING_CONTEXT; a stranger 404s on the project and on the entry', async () => {
    const denied = await request(h.server())
      .post(api('/entries/start'))
      .set(auth(viewer))
      .send({ project_id: projectId })
      .expect(403);
    expect(denied.body.error.code).toBe('NO_LOGGING_CONTEXT');

    await request(h.server())
      .post(api('/entries/start'))
      .set(auth(stranger))
      .send({ project_id: projectId })
      .expect(404);

    const mine = await request(h.server())
      .get(api('/me/entries'))
      .query({ from: '2020-01-01', to: '2030-12-31' })
      .set(auth(editor))
      .expect(200);
    const id = mine.body.data.items[0].id as string;
    await request(h.server())
      .get(api(`/entries/${id}`))
      .set(auth(stranger))
      .expect(404);
    await request(h.server())
      .delete(api(`/entries/${id}`))
      .set(auth(stranger))
      .expect(404);
  });

  it('a guest 404s on writes, while me/running is null and me/overview the empty shape (D08)', async () => {
    const guestHeaders = { 'x-guest-user-id': guestSession };
    await request(h.server())
      .post(api('/entries/start'))
      .set(guestHeaders)
      .send({ project_id: projectId })
      .expect(404);
    const running = await request(h.server())
      .get(api('/me/running'))
      .set(guestHeaders)
      .expect(200);
    expect(running.body.data).toBeNull();
    const overview = await request(h.server())
      .get(api('/me/overview'))
      .set(guestHeaders)
      .expect(200);
    expect(overview.body.data).toEqual({
      can_log: false,
      approver_mode: false,
      contexts: [],
      approvals_waiting: 0,
      workspace_time_admin: [],
    });
    await request(h.server())
      .get(api('/me/entries'))
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set(guestHeaders)
      .expect(404);
  });

  it('personal time on a Free workspace ("Just me")', async () => {
    const picker = await request(h.server())
      .get(api(`/projects/${freeProjectId}/logging-for`))
      .set(auth(solo))
      .expect(200);
    expect(picker.body.data.selected).toMatchObject({ kind: 'personal' });
    expect(picker.body.data.personal_reason).toBe('plan');

    const started = await request(h.server())
      .post(api('/entries/start'))
      .set(auth(solo))
      .send({ project_id: freeProjectId, work_item: 'admin' })
      .expect(201);
    expect(started.body.data).toMatchObject({
      context_kind: 'personal',
      timesheet_id: null,
      work_item: 'admin',
    });
    await request(h.server())
      .post(api(`/entries/${started.body.data.id}/stop`))
      .set(auth(solo))
      .expect(200);
  });

  it('manual time; a stale expected_updated_at is 409; edit; comment; delete', async () => {
    const created = await request(h.server())
      .post(api('/entries'))
      .set(auth(editor))
      .send({
        project_id: projectId,
        started_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
        ended_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
        break_seconds: 600,
        note: 'Planning',
      })
      .expect(201);
    const entry = created.body.data;
    expect(entry).toMatchObject({
      source: 'manual',
      duration_seconds: 3000,
      break_seconds: 600,
      context_kind: 'team',
    });

    const stale = await request(h.server())
      .patch(api(`/entries/${entry.id}`))
      .set(auth(editor))
      .send({ note: 'x', expected_updated_at: '2000-01-01T00:00:00.000Z' })
      .expect(409);
    expect(stale.body.error.code).toBe('STALE_REVISION');

    // Required on /api/time (D42).
    await request(h.server())
      .patch(api(`/entries/${entry.id}`))
      .set(auth(editor))
      .send({ note: 'x' })
      .expect(400);

    const edited = await request(h.server())
      .patch(api(`/entries/${entry.id}`))
      .set(auth(editor))
      .send({ note: 'Planning, done', expected_updated_at: entry.updated_at })
      .expect(200);
    expect(edited.body.data.note).toBe('Planning, done');

    await request(h.server())
      .post(api(`/entries/${entry.id}/comments`))
      .set(auth(editor))
      .send({ body: '  first  ' })
      .expect(201);
    const comments = await request(h.server())
      .get(api(`/entries/${entry.id}/comments`))
      .set(auth(editor))
      .expect(200);
    expect(comments.body.data).toEqual([
      expect.objectContaining({ entry_id: entry.id, body: 'first' }),
    ]);

    await request(h.server())
      .delete(api(`/entries/${entry.id}`))
      .set(auth(editor))
      .expect(200);
    await request(h.server())
      .get(api(`/entries/${entry.id}`))
      .set(auth(editor))
      .expect(404);
  });

  it('the summary and preferences read back', async () => {
    await request(h.server())
      .put(api('/me/preferences'))
      .set(auth(editor))
      .send({ timezone: 'Asia/Manila', week_start: 1 })
      .expect(200);
    const prefs = await request(h.server())
      .get(api('/me/preferences'))
      .set(auth(editor))
      .expect(200);
    expect(prefs.body.data).toMatchObject({
      timezone: 'Asia/Manila',
      week_start: 1,
    });
    // `to` is a local date in the caller's zone (Asia/Manila, UTC+8): use
    // tomorrow's UTC date so an entry logged after local midnight still counts.
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const summary = await request(h.server())
      .get(api('/me/summary'))
      .query({ from: '2026-01-01', to: tomorrow })
      .set(auth(editor))
      .expect(200);
    expect(summary.body.data.timezone).toBe('Asia/Manila');
    expect(summary.body.data.total_seconds).toBeGreaterThan(0);
  });
});
