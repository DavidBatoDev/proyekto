/**
 * Real-DB tests for the commit-flow Phase 0 gaps: G4 (atomic optimistic-
 * concurrency guard in upsert_full_roadmap), G5 (authorization-gated,
 * user+ops-scoped idempotency replay), and G8 (durable project_activity_log
 * audit row on commit).
 */
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

const epicOp = (title: string) => ({ op: 'add_epic', data: { title } });

async function poll<T>(
  fn: () => Promise<T | null>,
  attempts = 20,
  delayMs = 300,
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

describe('phase0 commit flow (G4, G5, G8)', () => {
  const h = new Harness();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let nonEditor: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let roadmapId: string;
  let g4RoadmapId: string;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('owner');
    nonEditor = await h.createUser('noneditor');
    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    await h.grantAccess(projectId, nonEditor.id, 'viewer');
    roadmapId = await h.createRoadmap(owner.id, projectId);
    g4RoadmapId = await h.createRoadmap(owner.id, projectId);
  });

  afterAll(async () => {
    await h.cleanup();
    await h.close();
  });

  // ── G4: atomic optimistic-concurrency guard in the RPC ───────────────────
  describe('G4 optimistic concurrency', () => {
    it('the RPC rejects a stale expected_updated_at with STALE_REVISION', async () => {
      const { error } = await h.admin.rpc('upsert_full_roadmap', {
        p_roadmap_id: g4RoadmapId,
        p_owner_id: owner.id,
        p_full_state: { id: g4RoadmapId },
        p_create_if_missing: false,
        p_expected_updated_at: '2000-01-01T00:00:00.000Z',
      });
      expect(error).toBeTruthy();
      expect(String(error?.message)).toContain('STALE_REVISION');
    });

    it('the RPC accepts the current updated_at as the baseline', async () => {
      const current = await h.roadmapUpdatedAt(g4RoadmapId);
      const { error } = await h.admin.rpc('upsert_full_roadmap', {
        p_roadmap_id: g4RoadmapId,
        p_owner_id: owner.id,
        p_full_state: { id: g4RoadmapId },
        p_create_if_missing: false,
        p_expected_updated_at: current,
      });
      expect(error).toBeFalsy();
    });

    it('the RPC is backward compatible when no baseline is passed (4-arg)', async () => {
      const { error } = await h.admin.rpc('upsert_full_roadmap', {
        p_roadmap_id: g4RoadmapId,
        p_owner_id: owner.id,
        p_full_state: { id: g4RoadmapId },
        p_create_if_missing: false,
      });
      expect(error).toBeFalsy();
    });

    it('an HTTP commit with a stale revision_token returns 409', async () => {
      await request(h.server())
        .post(`/api/roadmaps/${roadmapId}/ai/commit`)
        .set(auth(owner.token))
        .send({
          operations: [epicOp('g4-http')],
          revision_token: '2000-01-01T00:00:00.000Z',
        })
        .expect(409);
    });
  });

  // ── G5: authorization-gated, scoped idempotency replay ───────────────────
  describe('G5 idempotency', () => {
    const keyA = `itest-idem-A`;

    it('a non-editor commit is rejected before any replay lookup (403)', async () => {
      await request(h.server())
        .post(`/api/roadmaps/${roadmapId}/ai/commit`)
        .set(auth(nonEditor.token))
        .send({ operations: [epicOp('g5-forbidden')], idempotency_key: keyA })
        .expect(403);
    });

    it('a retry with the same key + same operations replays the first result', async () => {
      const first = await request(h.server())
        .post(`/api/roadmaps/${roadmapId}/ai/commit`)
        .set(auth(owner.token))
        .send({ operations: [epicOp('g5-shared')], idempotency_key: keyA });
      expect([200, 201]).toContain(first.status);
      const changeId = first.body.data.change_id;
      expect(changeId).toBeTruthy();

      const replay = await request(h.server())
        .post(`/api/roadmaps/${roadmapId}/ai/commit`)
        .set(auth(owner.token))
        .send({ operations: [epicOp('g5-shared')], idempotency_key: keyA });
      expect([200, 201]).toContain(replay.status);
      expect(replay.body.data.change_id).toBe(changeId);
    });

    it('reusing the key with different operations returns 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const res = await request(h.server())
        .post(`/api/roadmaps/${roadmapId}/ai/commit`)
        .set(auth(owner.token))
        .send({ operations: [epicOp('g5-different')], idempotency_key: keyA });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain('IDEMPOTENCY_KEY_REUSED');
    });
  });

  // ── G8: durable audit row on commit ──────────────────────────────────────
  describe('G8 audit trail', () => {
    it('a commit writes a roadmap.committed row to project_activity_log', async () => {
      const res = await request(h.server())
        .post(`/api/roadmaps/${roadmapId}/ai/commit`)
        .set(auth(owner.token))
        .send({
          operations: [epicOp('g8-audit')],
          idempotency_key: 'itest-g8',
        });
      expect([200, 201]).toContain(res.status);

      const row = await poll(async () => {
        const { data } = await h.admin
          .from('project_activity_log')
          .select('id, action, entity_id, metadata')
          .eq('project_id', projectId)
          .eq('action', 'roadmap.committed')
          .eq('entity_id', roadmapId)
          .limit(1);
        return data && data.length ? data[0] : null;
      });
      expect(row).toBeTruthy();
      expect(
        (row as { metadata?: { change_id?: string } }).metadata?.change_id,
      ).toBeTruthy();
    });
  });
});
