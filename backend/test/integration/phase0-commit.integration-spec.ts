/**
 * Real-DB tests for the commit-flow Phase 0 gaps: G4 (atomic optimistic-
 * concurrency guard in upsert_full_roadmap), G5 (authorization-gated,
 * user+ops-scoped idempotency replay), and G8 (durable project_activity_log
 * audit row on commit) — plus the G-series task-assignee scenarios of
 * upsert_full_roadmap (migration 20260906090000): `assignee_ids` as the
 * canonical full-replacement set, the column as the primary, and the legacy
 * scalar-only writer touching the join table only when the scalar changes.
 */
import { randomUUID } from 'crypto';
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
    // A project holds at most one linked roadmap (uq_roadmaps_project_id_linked),
    // so the G4 roadmap gets its own owner-granted project.
    const g4ProjectId = await h.createProject(owner.id, 'itest g4 project');
    await h.grantAccess(g4ProjectId, owner.id, 'owner');
    g4RoadmapId = await h.createRoadmap(owner.id, g4ProjectId);
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

  // ── G-series: upsert_full_roadmap task assignee reconciliation ───────────
  // Drives the RPC directly (service role) against a personal roadmap so the
  // join-table semantics are proven at the SQL layer, independent of the
  // backend normalizers. The scenarios run in order and build on each other.
  describe('G-series upsert_full_roadmap task assignees', () => {
    type AssigneeRow = {
      assignee_id: string;
      assigned_at: string;
      assigned_by: string | null;
    };

    let gRoadmapId: string;
    let gEpicId: string;
    let gFeatureId: string;
    let a: string;
    let b: string;
    let c: string;
    const taskId = randomUUID();
    const scalarOnlyTaskId = randomUUID();

    const fullState = (tasks: Array<Record<string, unknown>>) => ({
      id: gRoadmapId,
      roadmap_epics: [
        {
          id: gEpicId,
          title: 'g-series epic',
          roadmap_features: [
            {
              id: gFeatureId,
              title: 'g-series feature',
              roadmap_tasks: tasks.map((task, index) => ({
                position: index,
                ...task,
              })),
            },
          ],
        },
      ],
    });

    const upsert = async (
      tasks: Array<Record<string, unknown>>,
      extra: Record<string, unknown> = {},
    ) => {
      const { error } = await h.admin.rpc('upsert_full_roadmap', {
        p_roadmap_id: gRoadmapId,
        p_owner_id: owner.id,
        p_full_state: fullState(tasks),
        p_create_if_missing: false,
        ...extra,
      });
      expect(error).toBeFalsy();
    };

    const readTask = async (
      id: string,
    ): Promise<{ column: string | null; rows: AssigneeRow[] }> => {
      const { data: task, error } = await h.admin
        .from('roadmap_tasks')
        .select('id, assignee_id')
        .eq('id', id)
        .single();
      expect(error).toBeFalsy();
      const { data: rows, error: rowsError } = await h.admin
        .from('roadmap_task_assignees')
        .select('assignee_id, assigned_at, assigned_by')
        .eq('task_id', id)
        .order('assigned_at', { ascending: true });
      expect(rowsError).toBeFalsy();
      return {
        column: (task as { assignee_id: string | null }).assignee_id,
        rows: (rows ?? []) as AssigneeRow[],
      };
    };

    const memberIds = (rows: AssigneeRow[]) =>
      rows.map((row) => row.assignee_id).sort();

    beforeAll(async () => {
      a = owner.id;
      b = nonEditor.id;
      // A third profile so "changed scalar" can prove both the delete of the
      // old members and the insert of a member that never had a row.
      c = (await h.createUser('g-assignee-c')).id;
      gRoadmapId = await h.createRoadmap(owner.id, null);
      gEpicId = await h.createEpic(gRoadmapId, 'g-series epic');
      gFeatureId = await h.createFeature(gEpicId, gRoadmapId);
    });

    it('G-A explicit assignee_ids with duplicates -> rows {a,b}, column = a, assigned_by = actor', async () => {
      await upsert(
        [{ id: taskId, title: 'g-series task', assignee_ids: [a, b, a] }],
        { p_actor_id: owner.id },
      );

      const state = await readTask(taskId);
      expect(memberIds(state.rows)).toEqual([a, b].sort());
      expect(state.column).toBe(a);
      expect(state.rows.map((row) => row.assigned_by)).toEqual([
        owner.id,
        owner.id,
      ]);
    });

    it('G-B explicit [] -> no rows, column NULL', async () => {
      await upsert([{ id: taskId, title: 'g-series task', assignee_ids: [] }]);

      const state = await readTask(taskId);
      expect(state.rows).toEqual([]);
      expect(state.column).toBeNull();
    });

    it('G-C key absent + unchanged scalar -> co-assignee rows untouched', async () => {
      await upsert([
        { id: taskId, title: 'g-series task', assignee_ids: [a, b] },
      ]);
      const before = await readTask(taskId);
      expect(memberIds(before.rows)).toEqual([a, b].sort());
      expect(before.column).toBe(a);

      // A legacy single-assignee writer renaming the task: it sends the
      // scalar it read back, no `assignee_ids` key at all.
      await upsert([{ id: taskId, title: 'g-series renamed', assignee_id: a }]);

      const after = await readTask(taskId);
      expect(memberIds(after.rows)).toEqual([a, b].sort());
      expect(after.column).toBe(a);
      expect(after.rows.map((row) => row.assigned_at)).toEqual(
        before.rows.map((row) => row.assigned_at),
      );
    });

    it('G-D key absent + changed scalar -> rows = [new], column = new', async () => {
      await upsert([{ id: taskId, title: 'g-series renamed', assignee_id: c }]);

      const state = await readTask(taskId);
      expect(memberIds(state.rows)).toEqual([c]);
      expect(state.column).toBe(c);
    });

    it('G-E new task with a scalar only -> exactly one row', async () => {
      await upsert([
        { id: taskId, title: 'g-series renamed', assignee_id: c },
        { id: scalarOnlyTaskId, title: 'g-series scalar-only', assignee_id: b },
      ]);

      const state = await readTask(scalarOnlyTaskId);
      expect(memberIds(state.rows)).toEqual([b]);
      expect(state.column).toBe(b);
    });

    it('G-F re-sending an existing id keeps its assigned_at', async () => {
      const before = await readTask(taskId);
      expect(memberIds(before.rows)).toEqual([c]);
      const originalAssignedAt = before.rows[0].assigned_at;

      await upsert([
        { id: taskId, title: 'g-series renamed', assignee_ids: [c, a] },
        { id: scalarOnlyTaskId, title: 'g-series scalar-only', assignee_id: b },
      ]);

      const after = await readTask(taskId);
      expect(memberIds(after.rows)).toEqual([a, c].sort());
      expect(after.column).toBe(c);
      expect(after.rows.find((row) => row.assignee_id === c)?.assigned_at).toBe(
        originalAssignedAt,
      );
    });

    // State entering G-G: taskId rows {a, c}, column = c; scalarOnlyTaskId
    // rows {b}, column = b. Every payload re-sends both tasks because the RPC
    // deletes tasks missing from the full state.
    it('G-G assignee_ids: null + unchanged scalar -> key treated as absent, rows and column kept', async () => {
      const before = await readTask(taskId);
      expect(memberIds(before.rows)).toEqual([a, c].sort());
      expect(before.column).toBe(c);

      // `null` is "assignment unchanged" in every layer: jsonb_typeof is not
      // 'array', so the RPC falls through to the scalar branch, and an
      // unchanged scalar leaves the join table alone.
      await upsert([
        {
          id: taskId,
          title: 'g-series renamed',
          assignee_ids: null,
          assignee_id: c,
        },
        { id: scalarOnlyTaskId, title: 'g-series scalar-only', assignee_id: b },
      ]);

      const after = await readTask(taskId);
      expect(memberIds(after.rows)).toEqual([a, c].sort());
      expect(after.column).toBe(c);
      expect(after.rows.map((row) => row.assigned_at)).toEqual(
        before.rows.map((row) => row.assigned_at),
      );
    });

    it('G-H non-uuid and null elements are dropped: [a, junk, null] -> rows {a}, column = a', async () => {
      await upsert([
        {
          id: taskId,
          title: 'g-series renamed',
          assignee_ids: [a, 'junk', null],
        },
        { id: scalarOnlyTaskId, title: 'g-series scalar-only', assignee_id: b },
      ]);

      const state = await readTask(taskId);
      expect(memberIds(state.rows)).toEqual([a]);
      expect(state.column).toBe(a);
    });

    it('G-I dedupe is case-insensitive: [a, A] -> rows {a}, column = a', async () => {
      // On the scalar-only task (rows {b}) so the reconciliation actually
      // runs: b is removed and a single lowercase a row is inserted.
      await upsert([
        { id: taskId, title: 'g-series renamed', assignee_ids: [a] },
        {
          id: scalarOnlyTaskId,
          title: 'g-series scalar-only',
          assignee_ids: [a, a.toUpperCase()],
        },
      ]);

      const state = await readTask(scalarOnlyTaskId);
      expect(state.rows).toHaveLength(1);
      expect(memberIds(state.rows)).toEqual([a]);
      expect(state.column).toBe(a);
    });

    it('G-J an upsert without p_actor_id records assigned_by = p_owner_id', async () => {
      // b and c have no row on taskId at this point (rows {a}), so both
      // inserts are fresh and take the COALESCE(p_actor_id, p_owner_id)
      // fallback; the `upsert` helper sends no p_actor_id key.
      await upsert([
        { id: taskId, title: 'g-series renamed', assignee_ids: [b, c] },
        {
          id: scalarOnlyTaskId,
          title: 'g-series scalar-only',
          assignee_ids: [a],
        },
      ]);

      const state = await readTask(taskId);
      expect(memberIds(state.rows)).toEqual([b, c].sort());
      expect(state.column).toBe(b);
      expect(state.rows.map((row) => row.assigned_by)).toEqual([
        owner.id,
        owner.id,
      ]);
    });
  });
});
