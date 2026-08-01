/**
 * Real-DB tests for GET /projects/:projectId/activity.
 *
 * The ordering guarantees this endpoint makes cannot be proven against
 * naturally-occurring data: production has ZERO seq/created_at inversions,
 * because an inversion only happens when a flush exceeds
 * ACTIVITY_FLUSH_TIMEOUT_MS. So the fixtures CONSTRUCT the pathological cases
 * — a late-landing row (higher seq, earlier created_at) and a set of rows
 * sharing one millisecond — and assert the feed still reads correctly.
 *
 * Activity rows cascade from `projects`, which the harness already tracks, so
 * everything seeded here is cleaned up in teardown.
 */
import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

describe('activity read API', () => {
  const h = new Harness();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let viewer: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;

  /** Ascending event times; the feed returns the reverse. */
  const T = (n: number) => `2026-07-0${n}T10:00:00.000Z`;

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('act-owner');
    viewer = await h.createUser('act-viewer');
    outsider = await h.createUser('act-outsider');

    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    // A viewer holds logs.view but NOT logs.view_sensitive.
    await h.grantAccess(projectId, viewer.id, 'viewer');

    // Seed with explicit created_at so the ordering is deterministic. seq is
    // assigned by the sequence in insert order — which is exactly what lets us
    // build an inversion below.
    const rows = [
      { action: 'epic.created', created_at: T(1) },
      { action: 'epic.updated', created_at: T(2) },
      { action: 'feature.created', created_at: T(3) },
      { action: 'task.created', created_at: T(4) },
      // Three events sharing ONE millisecond — the case that forces seq into
      // the sort key, since created_at alone cannot order them.
      { action: 'task.reordered', created_at: T(5) },
      { action: 'task.status_changed', created_at: T(5) },
      { action: 'task.assigned', created_at: T(5) },
      // Sensitive: must be invisible without logs.view_sensitive.
      { action: 'access.granted', created_at: T(6), is_sensitive: true },
    ];

    for (const row of rows) {
      const { error } = await h.admin.from('project_activity_log').insert({
        project_id: projectId,
        actor_id: owner.id,
        action: row.action,
        entity_type: 'task',
        is_sensitive: row.is_sensitive ?? false,
        created_at: row.created_at,
        metadata: { title: row.action },
      });
      if (error) throw new Error(`seed failed: ${error.message}`);
    }

    // THE LATE-LANDING ROW: inserted last (so it gets the HIGHEST seq) but
    // stamped with the EARLIEST created_at. This is what a flush that exceeded
    // its timeout looks like. Ordering by seq would put it first; ordering by
    // created_at puts it last, which is the truth.
    const { error } = await h.admin.from('project_activity_log').insert({
      project_id: projectId,
      actor_id: owner.id,
      action: 'roadmap.created',
      entity_type: 'roadmap',
      created_at: '2026-07-01T09:00:00.000Z', // earlier than every row above
      metadata: { title: 'late lander' },
    });
    if (error) throw new Error(`seed failed: ${error.message}`);
  });

  afterAll(async () => {
    // Seeded activity rows are not individually tracked; they cascade from
    // `projects`, which the harness does track (project_id is ON DELETE CASCADE).
    await h.cleanup();
  });

  const list = (token: string, query = '') =>
    request(h.app.getHttpServer())
      .get(`/api/projects/${projectId}/activity${query}`)
      .set(auth(token));

  it('returns EVENT order, not insert order', async () => {
    const res = await list(owner.token, '?limit=50').expect(200);
    const items = res.body.data.items;

    // Newest first by created_at.
    const times = items.map((r: any) => r.created_at);
    const sorted = [...times].sort().reverse();
    expect(times).toEqual(sorted);

    // The late lander has the highest seq but must appear LAST, because it
    // happened first. Ordering by seq would have put it first.
    const last = items[items.length - 1];
    expect(last.metadata.title).toBe('late lander');
    const maxSeq = Math.max(...items.map((r: any) => r.seq));
    expect(last.seq).toBe(maxSeq);
  });

  it('breaks millisecond ties by seq, descending', async () => {
    const res = await list(owner.token, '?limit=50').expect(200);
    const tied = res.body.data.items.filter(
      (r: any) =>
        new Date(r.created_at).toISOString() === '2026-07-05T10:00:00.000Z',
    );
    expect(tied).toHaveLength(3);
    expect(tied.map((r: any) => r.seq)).toEqual(
      [...tied.map((r: any) => r.seq)].sort((a, b) => b - a),
    );
  });

  /**
   * The assertion that justifies keyset paging over OFFSET: walking the cursor
   * to exhaustion must reproduce the single-page list EXACTLY — no duplicates,
   * no gaps. A degraded keyset (the OR-without-.lte form) re-serves rows.
   */
  it('pages by cursor to exactly the same list, with no gaps or duplicates', async () => {
    const full = await list(owner.token, '?limit=50').expect(200);
    const expected = full.body.data.items.map((r: any) => r.id);

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const query = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await list(owner.token, query).expect(200);
      collected.push(...res.body.data.items.map((r: any) => r.id));
      cursor = res.body.data.next_cursor;
      if (!cursor) break;
    }

    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(collected.length);
  });

  it('serves a row inserted OLDER than the cursor on a later page', async () => {
    const first = await list(owner.token, '?limit=3').expect(200);
    const cursor = first.body.data.next_cursor;
    expect(cursor).toBeTruthy();

    // Lands below the cursor, so it belongs to the not-yet-fetched region.
    const { error } = await h.admin.from('project_activity_log').insert({
      project_id: projectId,
      actor_id: owner.id,
      action: 'milestone.created',
      entity_type: 'milestone',
      created_at: '2026-07-02T12:00:00.000Z',
      metadata: { title: 'inserted mid-scroll' },
    });
    expect(error).toBeNull();

    const rest: any[] = [];
    let next: string | null = cursor;
    for (let page = 0; page < 20 && next; page++) {
      const res = await list(
        owner.token,
        `?limit=3&cursor=${encodeURIComponent(next)}`,
      ).expect(200);
      rest.push(...res.body.data.items);
      next = res.body.data.next_cursor;
    }

    // A row older than the cursor must still be reachable on a later page.
    expect(rest.some((r) => r.metadata?.title === 'inserted mid-scroll')).toBe(
      true,
    );
  });

  describe('sensitivity', () => {
    it('hides sensitive rows from a reader without logs.view_sensitive', async () => {
      const res = await list(viewer.token, '?limit=50').expect(200);
      expect(res.body.data.can_view_sensitive).toBe(false);
      expect(
        res.body.data.items.some((r: any) => r.action === 'access.granted'),
      ).toBe(false);
      expect(
        res.body.data.items.every((r: any) => r.is_sensitive === false),
      ).toBe(true);
    });

    it('shows them to a reader who holds it', async () => {
      const res = await list(owner.token, '?limit=50').expect(200);
      expect(res.body.data.can_view_sensitive).toBe(true);
      expect(
        res.body.data.items.some((r: any) => r.action === 'access.granted'),
      ).toBe(true);
    });
  });

  describe('filters', () => {
    it('narrows by action family', async () => {
      const res = await list(owner.token, '?family=task&limit=50').expect(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(
        res.body.data.items.every((r: any) => r.action.startsWith('task.')),
      ).toBe(true);
    });

    it('narrows by exact action', async () => {
      const res = await list(owner.token, '?action=epic.created').expect(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].action).toBe('epic.created');
    });

    it('narrows by date range', async () => {
      const res = await list(
        owner.token,
        `?from=${encodeURIComponent(T(3))}&to=${encodeURIComponent(T(4))}`,
      ).expect(200);

      // Compare as instants, not strings: PostgREST renders timestamps as
      // '...+00:00' while the fixtures are '...Z', and those two sort
      // differently lexically even when they denote the same moment.
      const within = res.body.data.items.every((r: any) => {
        const at = Date.parse(r.created_at);
        return at >= Date.parse(T(3)) && at <= Date.parse(T(4));
      });
      expect(within).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });
  });

  describe('rejections', () => {
    it('403s a non-member with the permission path', async () => {
      const res = await list(outsider.token, '').expect(403);
      const body = JSON.stringify(res.body);
      expect(body).toContain('logs.view');
    });

    it('400s ?offset — the stale-client guard', async () => {
      await list(owner.token, '?offset=0').expect(400);
    });

    it('400s a tampered cursor rather than 500ing or leaking', async () => {
      await list(owner.token, '?cursor=zzzz-not-a-cursor').expect(400);
      // A cursor whose payload parses but is not a real timestamp.
      const forged = Buffer.from(
        JSON.stringify({ c: '2026-01-01T00:00:00.000Z",seq.gt.0', s: 1 }),
        'utf8',
      ).toString('base64url');
      await list(owner.token, `?cursor=${forged}`).expect(400);
    });

    it('400s an out-of-range limit', async () => {
      await list(owner.token, '?limit=500').expect(400);
    });
  });

  // NOTE: the presence of idx_project_activity_log_project_occurred_desc is
  // deliberately NOT asserted here. PostgREST cannot read pg_indexes, and
  // there is no generic SQL RPC to borrow — any check written through this
  // client would be theatre. Index existence is verified with EXPLAIN at
  // migration time (see 20260802090000_*), and its absence would show up here
  // as a slow feed rather than a wrong one, since the queries stay correct
  // either way.
});
