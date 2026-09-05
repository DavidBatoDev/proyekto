/**
 * Real-DB tests for workspace-scoped AI threads
 * (`/api/workspaces/:id/ai-sessions`, PR1 of the agent re-architecture)
 * against the hosted dev project.
 *
 * What only a real database can prove here: that Migration A's one-of scope
 * CHECK, the re-added `mode` CHECK (`plan_proposal` used to 500), the message
 * `seq` trigger, and above all the restored own-row RLS on
 * `roadmap_ai_sessions` / `roadmap_ai_messages` behave as designed when probed
 * with real user JWTs - including that DML from an authenticated client is
 * refused outright and that losing workspace membership hides a thread.
 *
 * Fixtures: owner (workspace owner), member (workspace member), outsider;
 * workspace W; one roadmap of the owner's for the cross-route checks.
 * Self-cleaning via Harness (threads cascade from workspaces and roadmaps).
 */
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

type SessionRow = {
  id: string;
  scope: 'roadmap' | 'workspace';
  roadmap_id: string | null;
  workspace_id: string | null;
  user_id: string;
  title: string | null;
  mode: string;
  is_pinned: boolean;
  pinned_at: string | null;
  is_archived: boolean;
  message_count: number;
  metadata: Record<string, unknown>;
};

describe('Workspace AI sessions (/api/workspaces/:id/ai-sessions)', () => {
  const h = new Harness();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let member: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let workspaceW: string;
  let roadmapId: string;
  let memberSeatId: string;

  const base = () => `/api/workspaces/${workspaceW}/ai-sessions`;

  const createThread = (token: string, body: Record<string, unknown> = {}) =>
    request(h.server())
      .post(base())
      .set(auth(token))
      .send({ title: `ws thread ${h.runId}`, ...body });

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('was-owner');
    member = await h.createUser('was-member');
    outsider = await h.createUser('was-outsider');

    workspaceW = await h.createWorkspace(owner.id, 'was');
    memberSeatId = await h.addWorkspaceMember(workspaceW, member.id, 'member');
    roadmapId = await h.createRoadmap(owner.id, null);
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  describe('CRUD', () => {
    let sessionId: string;

    it('creates a workspace-scope thread, plan_proposal mode included', async () => {
      const res = await createThread(owner.token, {
        mode: 'plan_proposal',
      }).expect(201);
      const row = res.body.data as SessionRow;
      expect(row).toMatchObject({
        scope: 'workspace',
        workspace_id: workspaceW,
        roadmap_id: null,
        user_id: owner.id,
        title: `ws thread ${h.runId}`,
        mode: 'plan_proposal',
        is_archived: false,
        message_count: 0,
      });
      sessionId = row.id;
    });

    it('lists and reads only the caller’s own threads in that workspace', async () => {
      const mine = await request(h.server())
        .get(base())
        .set(auth(owner.token))
        .expect(200);
      expect((mine.body.data as SessionRow[]).map((s) => s.id)).toContain(
        sessionId,
      );

      // A fellow workspace member can list (200) but never sees the owner's
      // private thread, in the list or by id.
      const theirs = await request(h.server())
        .get(base())
        .set(auth(member.token))
        .expect(200);
      expect((theirs.body.data as SessionRow[]).map((s) => s.id)).not.toContain(
        sessionId,
      );
      await request(h.server())
        .get(`${base()}/${sessionId}`)
        .set(auth(member.token))
        .expect(404);

      const one = await request(h.server())
        .get(`${base()}/${sessionId}`)
        .set(auth(owner.token))
        .expect(200);
      expect((one.body.data as SessionRow).id).toBe(sessionId);
    });

    it('patches title/pin and stores the agent-state snapshot', async () => {
      const patched = await request(h.server())
        .patch(`${base()}/${sessionId}`)
        .set(auth(owner.token))
        .send({ title: 'renamed', is_pinned: true })
        .expect(200);
      expect(patched.body.data).toMatchObject({
        title: 'renamed',
        is_pinned: true,
      });
      expect((patched.body.data as SessionRow).pinned_at).toBeTruthy();

      const agentState = { pending_plan: null, recents: ['E1'], summary: 'x' };
      await request(h.server())
        .put(`${base()}/${sessionId}/agent-state`)
        .set(auth(owner.token))
        .send({ agent_state: agentState })
        .expect(204);

      const after = await request(h.server())
        .get(`${base()}/${sessionId}`)
        .set(auth(owner.token))
        .expect(200);
      expect((after.body.data as SessionRow).metadata.agent_state).toEqual(
        agentState,
      );
    });

    it('appends and pages messages, refusing metadata over 64KB', async () => {
      const first = await request(h.server())
        .post(`${base()}/${sessionId}/messages`)
        .set(auth(owner.token))
        .send({ role: 'user', content: 'hello' })
        .expect(201);
      expect(first.body.data.message).toMatchObject({
        session_id: sessionId,
        seq: 1,
        role: 'user',
      });
      expect(first.body.data.seed_messages).toEqual([
        { role: 'user', content: 'hello' },
      ]);

      const refs = [{ kind: 'roadmap', id: roadmapId, label: '@roadmap' }];
      const second = await request(h.server())
        .post(`${base()}/${sessionId}/messages`)
        .set(auth(owner.token))
        .send({ role: 'assistant', content: 'hi', metadata: { refs } })
        .expect(201);
      expect(second.body.data.message.seq).toBe(2);
      expect(second.body.data.message.metadata).toEqual({ refs });
      expect(second.body.data.seed_messages).toHaveLength(2);

      const tooBig = await request(h.server())
        .post(`${base()}/${sessionId}/messages`)
        .set(auth(owner.token))
        .send({
          role: 'user',
          content: 'big',
          metadata: { blob: 'x'.repeat(70_000) },
        })
        .expect(400);
      expect(JSON.stringify(tooBig.body)).toContain(
        'MESSAGE_METADATA_TOO_LARGE',
      );

      const page = await request(h.server())
        .get(`${base()}/${sessionId}/messages`)
        .set(auth(owner.token))
        .expect(200);
      expect(
        (page.body.data as Array<{ seq: number; role: string }>).map((m) => [
          m.seq,
          m.role,
        ]),
      ).toEqual([
        [1, 'user'],
        [2, 'assistant'],
      ]);

      const session = await request(h.server())
        .get(`${base()}/${sessionId}`)
        .set(auth(owner.token))
        .expect(200);
      expect((session.body.data as SessionRow).message_count).toBe(2);
    });

    it('sorts pinned threads first', async () => {
      const other = await createThread(owner.token, {
        title: `ws second ${h.runId}`,
      }).expect(201);
      const list = await request(h.server())
        .get(base())
        .set(auth(owner.token))
        .expect(200);
      const ids = (list.body.data as SessionRow[]).map((s) => s.id);
      expect(ids.indexOf(sessionId)).toBeLessThan(
        ids.indexOf(other.body.data.id as string),
      );
    });

    it('deletes the thread and its messages', async () => {
      await request(h.server())
        .delete(`${base()}/${sessionId}`)
        .set(auth(owner.token))
        .expect(204);
      await request(h.server())
        .get(`${base()}/${sessionId}`)
        .set(auth(owner.token))
        .expect(404);
      const { count } = await h.admin
        .from('roadmap_ai_messages')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId);
      expect(count).toBe(0);
    });
  });

  describe('scope isolation', () => {
    it('never reads a workspace thread through the roadmap route, or vice versa', async () => {
      const wsThread = await createThread(owner.token).expect(201);
      const roadmapThread = await request(h.server())
        .post(`/api/roadmaps/${roadmapId}/ai-sessions`)
        .set(auth(owner.token))
        .send({ title: `rm thread ${h.runId}` })
        .expect(201);
      expect(roadmapThread.body.data).toMatchObject({
        scope: 'roadmap',
        roadmap_id: roadmapId,
        workspace_id: null,
      });

      await request(h.server())
        .get(`/api/roadmaps/${roadmapId}/ai-sessions/${wsThread.body.data.id}`)
        .set(auth(owner.token))
        .expect(404);
      await request(h.server())
        .get(`${base()}/${roadmapThread.body.data.id}`)
        .set(auth(owner.token))
        .expect(404);
      await request(h.server())
        .patch(`${base()}/${roadmapThread.body.data.id}`)
        .set(auth(owner.token))
        .send({ title: 'stolen' })
        .expect(404);

      const roadmapList = await request(h.server())
        .get(`/api/roadmaps/${roadmapId}/ai-sessions`)
        .set(auth(owner.token))
        .expect(200);
      expect(
        (roadmapList.body.data as SessionRow[]).map((s) => s.id),
      ).not.toContain(wsThread.body.data.id);
    });

    it('answers 404 to a non-member on every route', async () => {
      const seeded = await createThread(owner.token).expect(201);
      const id = seeded.body.data.id as string;
      const o = auth(outsider.token);
      await request(h.server()).get(base()).set(o).expect(404);
      await createThread(outsider.token).expect(404);
      await request(h.server()).get(`${base()}/${id}`).set(o).expect(404);
      await request(h.server())
        .patch(`${base()}/${id}`)
        .set(o)
        .send({ title: 'x' })
        .expect(404);
      await request(h.server())
        .put(`${base()}/${id}/agent-state`)
        .set(o)
        .send({ agent_state: {} })
        .expect(404);
      await request(h.server()).delete(`${base()}/${id}`).set(o).expect(404);
      await request(h.server())
        .get(`${base()}/${id}/messages`)
        .set(o)
        .expect(404);
      await request(h.server())
        .post(`${base()}/${id}/messages`)
        .set(o)
        .send({ role: 'user', content: 'x' })
        .expect(404);
      // An unknown workspace id is indistinguishable from a foreign one.
      await request(h.server())
        .get(`/api/workspaces/${randomUUID()}/ai-sessions`)
        .set(auth(owner.token))
        .expect(404);
    });
  });

  describe('RLS (direct PostgREST access with user JWTs)', () => {
    let ownerThread: string;
    let memberThread: string;

    beforeAll(async () => {
      ownerThread = (await createThread(owner.token).expect(201)).body.data
        .id as string;
      await request(h.server())
        .post(`${base()}/${ownerThread}/messages`)
        .set(auth(owner.token))
        .send({ role: 'user', content: 'rls probe' })
        .expect(201);
      memberThread = (await createThread(member.token).expect(201)).body.data
        .id as string;
    });

    it('shows a thread and its messages to their owner only', async () => {
      const ownerClient = h.userClient(owner.token);
      const { data: ownRows, error: ownErr } = await ownerClient
        .from('roadmap_ai_sessions')
        .select('id, scope, workspace_id')
        .eq('id', ownerThread);
      expect(ownErr).toBeNull();
      expect(ownRows).toEqual([
        { id: ownerThread, scope: 'workspace', workspace_id: workspaceW },
      ]);
      const { data: ownMessages } = await ownerClient
        .from('roadmap_ai_messages')
        .select('id')
        .eq('session_id', ownerThread);
      expect(ownMessages).toHaveLength(1);

      for (const token of [member.token, outsider.token]) {
        const client = h.userClient(token);
        const { data: rows } = await client
          .from('roadmap_ai_sessions')
          .select('id')
          .eq('id', ownerThread);
        expect(rows ?? []).toHaveLength(0);
        const { data: messages } = await client
          .from('roadmap_ai_messages')
          .select('id')
          .eq('session_id', ownerThread);
        expect(messages ?? []).toHaveLength(0);
      }
    });

    it('refuses direct writes from an authenticated client', async () => {
      const ownerClient = h.userClient(owner.token);
      const { error: insertErr } = await ownerClient
        .from('roadmap_ai_sessions')
        .insert({
          scope: 'workspace',
          workspace_id: workspaceW,
          user_id: owner.id,
          title: 'direct insert',
        });
      expect(insertErr).toBeTruthy();

      const { error: updateErr, data: updated } = await ownerClient
        .from('roadmap_ai_sessions')
        .update({ title: 'direct update' })
        .eq('id', ownerThread)
        .select('id');
      expect(updateErr ?? (updated ?? []).length === 0).toBeTruthy();

      const { error: messageErr } = await ownerClient
        .from('roadmap_ai_messages')
        .insert({ session_id: ownerThread, role: 'user', content: 'direct' });
      expect(messageErr).toBeTruthy();

      const { data: still } = await h.admin
        .from('roadmap_ai_sessions')
        .select('title')
        .eq('id', ownerThread)
        .single();
      expect(still?.title).toBe(`ws thread ${h.runId}`);
    });

    it('hides a thread once its owner loses workspace membership', async () => {
      const memberClient = h.userClient(member.token);
      const before = await memberClient
        .from('roadmap_ai_sessions')
        .select('id')
        .eq('id', memberThread);
      expect(before.data).toHaveLength(1);

      const { error } = await h.admin
        .from('workspace_members')
        .delete()
        .eq('id', memberSeatId);
      expect(error).toBeNull();

      const after = await memberClient
        .from('roadmap_ai_sessions')
        .select('id')
        .eq('id', memberThread);
      expect(after.data ?? []).toHaveLength(0);

      // The backend agrees: the route now 404s for the former member.
      await request(h.server())
        .get(`${base()}/${memberThread}`)
        .set(auth(member.token))
        .expect(404);
    });
  });
});
