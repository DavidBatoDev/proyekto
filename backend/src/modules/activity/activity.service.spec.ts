import { BadRequestException } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { decodeActivityCursor, encodeActivityCursor } from './dto/activity.dto';

/**
 * Records every filter/order call so the tests can assert the exact PostgREST
 * shape — the keyset correctness lives in which operators are emitted, not in
 * the returned rows.
 */
function buildSupabase(rows: any[] = []) {
  const calls: Array<{ op: string; args: any[] }> = [];
  const builder: any = {};
  for (const op of ['select', 'eq', 'in', 'gte', 'lte', 'or', 'order']) {
    builder[op] = (...args: any[]) => {
      calls.push({ op, args });
      return builder;
    };
  }
  builder.limit = (...args: any[]) => {
    calls.push({ op: 'limit', args });
    return Promise.resolve({ data: rows, error: null });
  };
  let fromCount = 0;
  const db = {
    from: (table: string) => {
      fromCount++;
      calls.push({ op: 'from', args: [table] });
      return builder;
    },
  };
  return { db, calls, fromCalls: () => fromCount };
}

function permissions(viewSensitive: boolean) {
  return { logs: { view: true, view_sensitive: viewSensitive } };
}

function build(opts: { rows?: any[]; sensitive?: boolean } = {}) {
  const { db, calls, fromCalls } = buildSupabase(opts.rows ?? []);
  const authorization = {
    assertPermission: jest
      .fn()
      .mockResolvedValue(permissions(opts.sensitive ?? false)),
  };
  const service = new ActivityService(db as never, authorization as never);
  return { service, calls, authorization, fromCalls };
}

const PROJECT = 'proj-1';
const USER = 'user-1';

function row(seq: number, createdAt: string) {
  return {
    id: `row-${seq}`,
    seq,
    project_id: PROJECT,
    roadmap_id: null,
    actor_id: USER,
    action: 'task.updated',
    entity_type: 'task',
    entity_id: null,
    is_sensitive: false,
    metadata: {},
    created_at: createdAt,
    actor: null,
  };
}

const ISO = '2026-08-01T13:45:54.004Z';

describe('ActivityService.list', () => {
  const opArgs = (calls: any[], op: string) =>
    calls.filter((c) => c.op === op).map((c) => c.args);

  it('orders by created_at then seq, both descending', async () => {
    const { service, calls } = build();
    await service.list(PROJECT, USER, {});

    expect(opArgs(calls, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['seq', { ascending: false }],
    ]);
  });

  it('probes for a next page with limit + 1', async () => {
    const { service, calls } = build();
    await service.list(PROJECT, USER, { limit: 10 });
    expect(opArgs(calls, 'limit')).toEqual([[11]]);
  });

  describe('sensitivity', () => {
    it('filters sensitive rows out without logs.view_sensitive', async () => {
      const { service, calls } = build({ sensitive: false });
      const out = await service.list(PROJECT, USER, {});

      expect(opArgs(calls, 'eq')).toContainEqual(['is_sensitive', false]);
      expect(out.can_view_sensitive).toBe(false);
    });

    it('does not filter when the reader holds logs.view_sensitive', async () => {
      const { service, calls } = build({ sensitive: true });
      const out = await service.list(PROJECT, USER, {});

      expect(opArgs(calls, 'eq')).not.toContainEqual(['is_sensitive', false]);
      expect(out.can_view_sensitive).toBe(true);
    });
  });

  describe('keyset cursor', () => {
    it('emits BOTH the positioning .lte and the tie-breaking .or', async () => {
      const { service, calls } = build();
      await service.list(PROJECT, USER, {
        cursor: encodeActivityCursor({ created_at: ISO, seq: 79 }),
      });

      // The .lte is what moves created_at into the index Index Cond. Without
      // it the plan degrades to a Filter over the whole project range.
      expect(opArgs(calls, 'lte')).toEqual([['created_at', ISO]]);
      expect(opArgs(calls, 'or')).toEqual([
        [`created_at.lt."${ISO}",and(created_at.eq."${ISO}",seq.lt.79)`],
      ]);
    });

    it('folds a `to` bound and the cursor into exactly ONE .lte', async () => {
      const { service, calls } = build();
      await service.list(PROJECT, USER, {
        cursor: encodeActivityCursor({ created_at: ISO, seq: 5 }),
        to: '2026-09-01T00:00:00.000Z', // later than the cursor
      });

      const ltes = opArgs(calls, 'lte');
      expect(ltes).toHaveLength(1);
      // The tighter (earlier) of the two bounds wins.
      expect(ltes[0]).toEqual(['created_at', ISO]);
    });

    it('keeps a `to` bound that is tighter than the cursor', async () => {
      const { service, calls } = build();
      await service.list(PROJECT, USER, {
        cursor: encodeActivityCursor({ created_at: ISO, seq: 5 }),
        to: '2026-01-01T00:00:00.000Z',
      });
      expect(opArgs(calls, 'lte')).toEqual([
        ['created_at', '2026-01-01T00:00:00.000Z'],
      ]);
    });

    it('returns a cursor only when a further page exists', async () => {
      const rows = [row(3, ISO), row(2, ISO), row(1, ISO)];
      const more = build({ rows });
      const out = await more.service.list(PROJECT, USER, { limit: 2 });
      expect(out.items).toHaveLength(2);
      expect(out.next_cursor).not.toBeNull();

      const exact = build({ rows: rows.slice(0, 2) });
      const out2 = await exact.service.list(PROJECT, USER, { limit: 2 });
      expect(out2.items).toHaveLength(2);
      expect(out2.next_cursor).toBeNull();
    });
  });

  describe('filters', () => {
    it('expands a family to its exact action list', async () => {
      const { service, calls } = build();
      await service.list(PROJECT, USER, { family: ['milestone'] });

      const [[column, actions]] = opArgs(calls, 'in');
      expect(column).toBe('action');
      expect(actions).toContain('milestone.created');
      expect(actions).toContain('milestone.deleted');
      // Nothing from another family leaks in.
      expect(actions.every((a: string) => a.startsWith('milestone.'))).toBe(
        true,
      );
    });

    it('ORs several families together', async () => {
      // What a checkbox sidebar means: task OR epic, not "last one wins".
      const { service, calls } = build();
      await service.list(PROJECT, USER, { family: ['task', 'epic'] });

      const [[, actions]] = opArgs(calls, 'in');
      expect(actions).toContain('task.created');
      expect(actions).toContain('epic.created');
      expect(
        actions.every(
          (a: string) => a.startsWith('task.') || a.startsWith('epic.'),
        ),
      ).toBe(true);
    });

    it('ORs several actors together', async () => {
      const { service, calls } = build();
      await service.list(PROJECT, USER, { actor_id: ['a-1', 'a-2'] });
      expect(opArgs(calls, 'in')).toContainEqual(['actor_id', ['a-1', 'a-2']]);
    });

    it('lets an exact action win over family', async () => {
      const { service, calls } = build();
      await service.list(PROJECT, USER, {
        action: 'task.created',
        family: ['epic'],
      });

      expect(opArgs(calls, 'eq')).toContainEqual(['action', 'task.created']);
      expect(opArgs(calls, 'in')).toHaveLength(0);
    });

    it('passes the scalar filters through', async () => {
      const { service, calls } = build();
      await service.list(PROJECT, USER, {
        actor_id: ['a-1'],
        roadmap_id: 'rm-1',
        entity_type: 'task',
        entity_id: 'e-1',
        from: '2026-01-01T00:00:00.000Z',
      });

      const eqs = opArgs(calls, 'eq');
      expect(opArgs(calls, 'in')).toContainEqual(['actor_id', ['a-1']]);
      expect(eqs).toContainEqual(['roadmap_id', 'rm-1']);
      expect(eqs).toContainEqual(['entity_type', 'task']);
      expect(eqs).toContainEqual(['entity_id', 'e-1']);
      expect(opArgs(calls, 'gte')).toEqual([
        ['created_at', '2026-01-01T00:00:00.000Z'],
      ]);
    });
  });

  it('never touches the database when authorization rejects', async () => {
    const { service, calls, authorization } = build();
    authorization.assertPermission.mockRejectedValue(new Error('denied'));

    await expect(service.list(PROJECT, USER, {})).rejects.toThrow('denied');
    expect(calls).toHaveLength(0);
  });

  it('rejects a malformed cursor before issuing any query', async () => {
    const { service, calls } = build();
    await expect(
      service.list(PROJECT, USER, { cursor: '!!!not-base64!!!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });
});

describe('activity cursor', () => {
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

  it('round-trips', () => {
    const cursor = encodeActivityCursor({ created_at: ISO, seq: 42 });
    expect(decodeActivityCursor(cursor)).toEqual({
      createdAt: ISO,
      seq: 42,
    });
  });

  it('normalises the Postgres timestamp format on encode', () => {
    // Postgres returns a space separator and microseconds; the cursor must be
    // a value that survives the decode round-trip check.
    const cursor = encodeActivityCursor({
      created_at: '2026-08-01 13:45:54.004646+00',
      seq: 7,
    });
    expect(decodeActivityCursor(cursor)).toEqual({
      createdAt: '2026-08-01T13:45:54.004Z',
      seq: 7,
    });
  });

  it('returns null for an absent cursor', () => {
    expect(decodeActivityCursor(undefined)).toBeNull();
    expect(decodeActivityCursor(null)).toBeNull();
    expect(decodeActivityCursor('')).toBeNull();
  });

  it.each([
    ['not base64', '!!!'],
    ['empty object', enc({})],
    ['non-timestamp c', enc({ c: 'nope', s: 1 })],
    ['negative seq', enc({ c: ISO, s: -1 })],
    ['fractional seq', enc({ c: ISO, s: 1.5 })],
    ['unsafe seq', enc({ c: ISO, s: 2 ** 53 })],
    ['string seq', enc({ c: ISO, s: '1' })],
    ['null payload', enc(null)],
  ])('rejects %s', (_label, raw) => {
    expect(() => decodeActivityCursor(raw)).toThrow(BadRequestException);
  });

  /**
   * The reason decode is a security boundary and not just parsing: the value
   * is interpolated into a raw PostgREST filter string via .or(). A cursor
   * that smuggled its own clause could reveal rows the caller is not entitled
   * to see. The round-trip check rejects every such shape because none of
   * them survive re-serialisation through Date.
   */
  it('rejects a filter-injection payload aimed at revealing sensitive rows', () => {
    const injected = enc({
      c: `${ISO}",seq.gt.0,or(is_sensitive.eq.true`,
      s: 1,
    });
    expect(() => decodeActivityCursor(injected)).toThrow(BadRequestException);
  });
});
