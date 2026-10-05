/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked<EntitlementsService>; passing its
 * members to expect() is an identity check on the mock, never a call.
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  allowAllEntitlements,
  denyingEntitlements,
  type EntitlementsMock,
} from '../../shared/entitlements/__entitlements-test-kit-spec';
import { PlanLimitException } from '../../shared/entitlements/plan-limit.exception';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

/**
 * Payouts after the time rebuild (backend.md "Payouts", D37, E18, E54, E61,
 * E67, E75): team managers (isTeamManager) of a team with time tracking and
 * payouts on, and time_payouts on the team's plan subject for create and owed;
 * Owed = approved team time with no payout and no legacy marker; fixed-rate
 * and self payments refused before the RPC; totals rounded once; the member's
 * notice carries no amount.
 */

const TEAM_ID = 'team-1';
const OWNER = 'user-owner';
const MANAGER = 'user-manager';
const WORKER = 'user-worker';
const STRANGER = 'user-stranger';
const E1 = '00000000-0000-4000-a000-000000000001';
const E2 = '00000000-0000-4000-a000-000000000002';
const E3 = '00000000-0000-4000-a000-000000000003';

type Result = { data: unknown; error: unknown };
type Call = [string, ...unknown[]];
interface Query {
  table: string;
  calls: Call[];
}

/** A team that tracks time and records payouts. */
function teamRow(over: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    owner_id: OWNER,
    workspace_id: 'ws-1',
    time_tracking_enabled: true,
    payouts_enabled: true,
    ...over,
  };
}

/** An Owed entry of WORKER on TEAM_ID. */
function entry(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    team_id: TEAM_ID,
    member_user_id: WORKER,
    context_kind: 'team',
    payout_id: null,
    legacy_status: null,
    payable_seconds: 3600,
    rate_type_snapshot: 'hourly',
    currency_snapshot: 'PHP',
    ...over,
  };
}

function payoutRow(over: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    team_id: TEAM_ID,
    member_user_id: WORKER,
    created_by: MANAGER,
    currency: 'PHP',
    total_amount: 1234.56,
    status: 'recorded',
    source: 'batch',
    proof_path: null,
    ...over,
  };
}

/**
 * Chain-agnostic PostgREST fake: every builder method records itself and
 * returns the builder; terminals resolve through `tables[table](query)`, which
 * sees every call made so far (filters, range).
 */
function makeSupabase(
  tables: Record<string, (q: Query) => Result>,
  rpcs: Record<string, (args: Record<string, unknown>) => Result>,
) {
  const queries: Query[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const from = jest.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const resolve = (): Promise<Result> => {
      const handler = tables[table];
      return Promise.resolve(
        handler
          ? handler(query)
          : { data: null, error: { message: `unexpected table ${table}` } },
      );
    };
    const b: Record<string, unknown> = {};
    for (const method of [
      'select',
      'eq',
      'in',
      'is',
      'not',
      'neq',
      'gte',
      'lt',
      'lte',
      'order',
      'range',
      'limit',
      'update',
    ]) {
      b[method] = (...args: unknown[]) => {
        query.calls.push([method, ...args]);
        return b;
      };
    }
    b.maybeSingle = resolve;
    b.single = resolve;
    b.then = (
      onFulfilled: (v: Result) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => resolve().then(onFulfilled, onRejected);
    return b;
  });
  const rpc = jest.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    const handler = rpcs[fn];
    return Promise.resolve(
      handler
        ? handler(args)
        : { data: null, error: { message: `unexpected rpc ${fn}` } },
    );
  });
  return {
    supabase: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
    queries,
    rpcCalls,
  };
}

function build(
  opts: {
    team?: Record<string, unknown> | null;
    managers?: string[];
    entries?: unknown[];
    owedPages?: unknown[][];
    payout?: Record<string, unknown>;
    payoutEntries?: unknown[];
    createResult?: Result;
    voidResult?: Result;
    entitlements?: EntitlementsMock;
    teamTimezone?: string;
    planRef?: unknown;
    /** A PostgREST error answered by every read of that table. */
    failures?: Partial<Record<'teams' | 'payouts', unknown>>;
  } = {},
) {
  const managers = opts.managers ?? [OWNER, MANAGER];
  const team = opts.team === undefined ? teamRow() : opts.team;
  const fake = makeSupabase(
    {
      teams: () =>
        opts.failures?.teams
          ? { data: null, error: opts.failures.teams }
          : { data: team, error: null },
      payouts: () =>
        opts.failures?.payouts
          ? { data: null, error: opts.failures.payouts }
          : { data: opts.payout ?? payoutRow(), error: null },
      payout_methods: () => ({ data: { id: 'method-1' }, error: null }),
      time_entries: (q) => {
        const isOwed = q.calls.some(
          ([m, col]) => m === 'eq' && col === 'context_kind',
        );
        if (isOwed) {
          const range = q.calls.find(([m]) => m === 'range');
          const offset = (range?.[1] as number) ?? 0;
          const pages = opts.owedPages ?? [[]];
          return { data: pages[offset / 1000] ?? [], error: null };
        }
        const byPayout = q.calls.some(
          ([m, col]) => m === 'eq' && col === 'payout_id',
        );
        if (byPayout) {
          return { data: opts.payoutEntries ?? [], error: null };
        }
        return { data: opts.entries ?? [entry(E1), entry(E2)], error: null };
      },
    },
    {
      can_manage_team: (args) => ({
        data:
          args.p_team_id === TEAM_ID &&
          managers.includes(String(args.p_user_id)),
        error: null,
      }),
      create_payout_and_mark_paid: () =>
        opts.createResult ?? { data: payoutRow(), error: null },
      void_payout_and_revert: () =>
        opts.voidResult ?? { data: payoutRow({ status: 'void' }), error: null },
    },
  );
  const entitlements = opts.entitlements ?? allowAllEntitlements();
  const timePolicy = {
    planRefForTeam: jest.fn().mockResolvedValue(opts.planRef ?? 'ws-1'),
    teamTimezone: jest.fn().mockResolvedValue(opts.teamTimezone ?? 'UTC'),
  };
  const timeNotifications = {
    payoutRecorded: jest.fn().mockResolvedValue(undefined),
  };
  const qaFixtures = {
    assertTeamSideEffectAllowed: jest.fn().mockResolvedValue(undefined),
  };
  const uploads = {
    getPrivateSignedUrl: jest.fn().mockResolvedValue('https://signed'),
  };
  const service = new PayoutsService(
    fake.supabase,
    uploads as never,
    qaFixtures as never,
    entitlements,
    timePolicy as never,
    timeNotifications as never,
  );
  return { service, ...fake, entitlements, timePolicy, timeNotifications };
}

function payoutsDenied(): EntitlementsMock {
  return denyingEntitlements({
    kind: 'feature',
    limit_key: 'time_payouts',
    label: 'Payouts',
    limit: null,
    used: null,
    context: 'write',
    message: 'Payouts are available on Business and above.',
  });
}

/** The HttpException body's `code`, when it has one. */
function codeOf(err: unknown): unknown {
  if (!(err instanceof HttpException)) return undefined;
  const body = err.getResponse();
  return typeof body === 'object' && body
    ? (body as { code?: unknown }).code
    : undefined;
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err,
  );
}

const timeEntryQueries = (queries: Query[]) =>
  queries.filter((q) => q.table === 'time_entries');

/** Neither the select list nor any filter names time_entries.status (it drops in M5). */
function expectNoStatusColumn(queries: Query[]) {
  for (const q of timeEntryQueries(queries)) {
    for (const [method, ...args] of q.calls) {
      if (method === 'select') {
        expect(String(args[0])).not.toMatch(/(^|[\s,(])status([\s,)]|$)/);
      } else {
        expect(args[0]).not.toBe('status');
      }
    }
  }
}

describe('PayoutsService.createPayout', () => {
  const base = { team_id: TEAM_ID, member_user_id: WORKER };

  it.each([
    ['entry_ids', { entry_ids: [E1, E2] }],
    ['log_ids (deprecated synonym)', { log_ids: [E1, E2] }],
  ])(
    'pays the entries named by %s, passing them as p_log_ids',
    async (_n, ids) => {
      const { service, rpcCalls } = build();
      await service.createPayout(MANAGER, { ...base, ...ids });

      const create = rpcCalls.find(
        (c) => c.fn === 'create_payout_and_mark_paid',
      );
      expect(create?.args).toMatchObject({
        p_team_id: TEAM_ID,
        p_member_user_id: WORKER,
        p_created_by: MANAGER,
        p_currency: 'PHP',
        p_log_ids: [E1, E2],
      });
    },
  );

  it('refuses both entry_ids and log_ids before reading anything', async () => {
    const { service, from, rpc } = build();
    const err = await failure(
      service.createPayout(MANAGER, {
        ...base,
        entry_ids: [E1],
        log_ids: [E2],
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a request with neither', async () => {
    const { service, from } = build();
    await expect(
      service.createPayout(MANAGER, { ...base }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(from).not.toHaveBeenCalled();
  });

  it('pays a repeated id once', async () => {
    const { service, rpcCalls, timeNotifications } = build({
      entries: [entry(E1)],
    });
    await service.createPayout(MANAGER, { ...base, entry_ids: [E1, E1] });
    const create = rpcCalls.find((c) => c.fn === 'create_payout_and_mark_paid');
    expect(create?.args.p_log_ids).toEqual([E1]);
    expect(timeNotifications.payoutRecorded).toHaveBeenCalledWith(
      expect.anything(),
      1,
      MANAGER,
    );
  });

  describe('authority', () => {
    it('refuses someone who does not manage the team, before the plan or any entry', async () => {
      const { service, entitlements, queries } = build();
      const err = await failure(
        service.createPayout(STRANGER, { ...base, entry_ids: [E1] }),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(entitlements.assertFeature).not.toHaveBeenCalled();
      expect(timeEntryQueries(queries)).toHaveLength(0);
    });

    it('lets the owner and a team admin pay (isTeamManager)', async () => {
      for (const caller of [OWNER, MANAGER]) {
        const { service, rpcCalls } = build();
        await service.createPayout(caller, { ...base, entry_ids: [E1, E2] });
        expect(rpcCalls[0]).toEqual({
          fn: 'can_manage_team',
          args: { p_team_id: TEAM_ID, p_user_id: caller },
        });
      }
    });

    it.each([
      ['time tracking', { time_tracking_enabled: false }, /time tracking/i],
      ['payouts', { payouts_enabled: false }, /payouts are disabled/i],
    ])('refuses when %s is off', async (_n, over, message) => {
      const { service, rpcCalls } = build({ team: teamRow(over) });
      await expect(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1] }),
      ).rejects.toThrow(message);
      expect(rpcCalls.map((c) => c.fn)).not.toContain(
        'create_payout_and_mark_paid',
      );
    });

    it('answers 404 for a team that does not exist', async () => {
      const { service } = build({ team: null });
      await expect(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('plan gate (time_payouts)', () => {
    it("refuses on a plan without payouts, checked on the team's plan subject", async () => {
      const entitlements = payoutsDenied();
      const { service, timePolicy, queries } = build({ entitlements });
      const err = await failure(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1] }),
      );
      expect(err).toBeInstanceOf(PlanLimitException);
      expect(timePolicy.planRefForTeam).toHaveBeenCalledWith(
        expect.objectContaining({ id: TEAM_ID, workspace_id: 'ws-1' }),
      );
      expect(entitlements.assertFeature).toHaveBeenCalledWith(
        'ws-1',
        'time_payouts',
      );
      expect(timeEntryQueries(queries)).toHaveLength(0);
    });

    it('passes the team-scope subject through for a team with no workspace', async () => {
      const scope = { workspaceId: null, exempt: false };
      const { service, entitlements } = build({
        team: teamRow({ workspace_id: null }),
        planRef: scope,
      });
      await service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] });
      expect(entitlements.assertFeature).toHaveBeenCalledWith(
        scope,
        'time_payouts',
      );
    });
  });

  describe('E54: self payment', () => {
    it('is a 403 PAYOUT_SELF_NOT_ALLOWED before any entry is read', async () => {
      const { service, queries, rpcCalls } = build({ managers: [WORKER] });
      const err = await failure(
        service.createPayout(WORKER, { ...base, entry_ids: [E1] }),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(codeOf(err)).toBe('PAYOUT_SELF_NOT_ALLOWED');
      expect(timeEntryQueries(queries)).toHaveLength(0);
      expect(rpcCalls.map((c) => c.fn)).not.toContain(
        'create_payout_and_mark_paid',
      );
    });
  });

  describe('which entries can be paid', () => {
    it('reads only owed-ness columns, never time_entries.status', async () => {
      const { service, queries } = build();
      await service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] });
      expectNoStatusColumn(queries);
    });

    it.each([
      ['an entry that does not exist', [entry(E1)]],
      ["another team's entry", [entry(E1), entry(E2, { team_id: 'team-2' })]],
    ])('answers 404 for %s', async (_n, rows) => {
      const { service, rpcCalls } = build({ entries: rows });
      const err = await failure(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      );
      expect(err).toBeInstanceOf(NotFoundException);
      expect(codeOf(err)).toBe('TIME_NOT_FOUND');
      expect(rpcCalls.map((c) => c.fn)).not.toContain(
        'create_payout_and_mark_paid',
      );
    });

    it("refuses another member's entry", async () => {
      const { service } = build({
        entries: [entry(E1), entry(E2, { member_user_id: 'user-other' })],
      });
      await expect(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      ).rejects.toThrow(/member being paid/);
    });

    /** E61: fixed pay is a manual payment. */
    it('refuses fixed-rate time with 422 FIXED_RATE_NOT_PAYABLE_BY_ENTRY before the RPC', async () => {
      const { service, rpcCalls } = build({
        entries: [entry(E1), entry(E2, { rate_type_snapshot: 'fixed' })],
      });
      const err = await failure(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      );
      expect((err as HttpException).getStatus()).toBe(422);
      expect(codeOf(err)).toBe('FIXED_RATE_NOT_PAYABLE_BY_ENTRY');
      expect(rpcCalls.map((c) => c.fn)).not.toContain(
        'create_payout_and_mark_paid',
      );
    });

    it.each([
      ['not approved yet (no payable seconds)', { payable_seconds: null }],
      ['already paid', { payout_id: 'payout-0' }],
      ['paid outside Proyekto', { legacy_status: 'paid_outside' }],
      ['rejected before the rebuild', { legacy_status: 'rejected' }],
      ['not team time', { context_kind: 'workspace' }],
    ])('refuses time that is %s', async (_n, over) => {
      const { service, rpcCalls } = build({
        entries: [entry(E1), entry(E2, over)],
      });
      await expect(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rpcCalls.map((c) => c.fn)).not.toContain(
        'create_payout_and_mark_paid',
      );
    });

    it('refuses time in two currencies', async () => {
      const { service } = build({
        entries: [entry(E1), entry(E2, { currency_snapshot: 'USD' })],
      });
      await expect(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      ).rejects.toThrow(/single currency/);
    });
  });

  describe('RPC refusals', () => {
    it.each([
      ['PAYOUT_SELF_NOT_ALLOWED', 403],
      ['FIXED_RATE_NOT_PAYABLE_BY_ENTRY', 422],
    ])('maps the %s sentinel', async (sentinel, status) => {
      const { service } = build({
        createResult: {
          data: null,
          error: { code: 'P0001', message: sentinel, details: null },
        },
      });
      const err = await failure(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      );
      expect((err as HttpException).getStatus()).toBe(status);
      expect(codeOf(err)).toBe(sentinel);
    });

    it("answers a plain-text refusal with Proyekto copy, never the database's text", async () => {
      const pgText =
        'One or more logs are not payable (must be approved, unpaid, same member/team, and PHP currency)';
      const { service } = build({
        createResult: {
          data: null,
          error: { code: 'P0001', message: pgText },
        },
      });
      const err = await failure(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((err as HttpException).getResponse()),
      ).not.toContain('logs are not payable');
    });

    it('turns any other database failure into a logged 500 without its text', async () => {
      const { service } = build({
        createResult: {
          data: null,
          error: {
            code: '57014',
            message: 'canceling statement due to timeout',
          },
        },
      });
      const err = await failure(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      );
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect(
        JSON.stringify((err as HttpException).getResponse()),
      ).not.toContain('canceling statement');
    });
  });

  /** E67: the member hears about it, without any amount. */
  describe('notice', () => {
    it('sends time_payout_recorded with the entry count and no amount', async () => {
      const { service, timeNotifications } = build();
      await service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] });

      expect(timeNotifications.payoutRecorded).toHaveBeenCalledTimes(1);
      const [payout, count, actor] = timeNotifications.payoutRecorded.mock
        .calls[0] as [Record<string, unknown>, number, string];
      expect(payout).toEqual({
        id: 'payout-1',
        member_user_id: WORKER,
        team_id: TEAM_ID,
      });
      expect(count).toBe(2);
      expect(actor).toBe(MANAGER);
      // The recorded total (1234.56 PHP) never reaches the notification layer.
      expect(
        JSON.stringify(timeNotifications.payoutRecorded.mock.calls),
      ).not.toMatch(/1234|PHP|total_amount|currency/);
    });

    it('sends nothing when the RPC refused', async () => {
      const { service, timeNotifications } = build({
        createResult: { data: null, error: { code: 'P0001', message: 'nope' } },
      });
      await expect(
        service.createPayout(MANAGER, { ...base, entry_ids: [E1, E2] }),
      ).rejects.toThrow();
      expect(timeNotifications.payoutRecorded).not.toHaveBeenCalled();
    });
  });
});

describe('PayoutsService.listTeamOwed', () => {
  function owed(
    id: string,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id,
      member_user_id: WORKER,
      currency_snapshot: 'PHP',
      payable_seconds: 3600,
      rate_snapshot: 100,
      member: { id: WORKER, display_name: 'Worker', avatar_url: null },
      ...over,
    };
  }

  it('refuses a non-manager and a plan without payouts', async () => {
    await expect(
      build().service.listTeamOwed(STRANGER, TEAM_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      build({ entitlements: payoutsDenied() }).service.listTeamOwed(
        MANAGER,
        TEAM_ID,
      ),
    ).rejects.toBeInstanceOf(PlanLimitException);
  });

  it('selects Owed team time only (CHANGE-5), never by status', async () => {
    const { service, queries } = build();
    await service.listTeamOwed(MANAGER, TEAM_ID);
    const [q] = timeEntryQueries(queries);
    expect(q.calls).toEqual(
      expect.arrayContaining([
        ['eq', 'team_id', TEAM_ID],
        ['eq', 'context_kind', 'team'],
        ['not', 'payable_seconds', 'is', null],
        ['is', 'payout_id', null],
        ['is', 'legacy_status', null],
        // Fixed pay is manual (E61), so it is never owed by entry.
        ['neq', 'rate_type_snapshot', 'fixed'],
      ]),
    );
    const select = q.calls.find(([m]) => m === 'select')?.[1] as string;
    expect(select).toContain('profiles!member_user_id');
    expect(select).not.toMatch(/_fkey/);
    expectNoStatusColumn(queries);
  });

  /** E75 / L65: local dates in the team policy timezone, never raw started_at. */
  it('turns until into the exclusive UTC instant after that local day', async () => {
    const { service, queries, timePolicy } = build({
      teamTimezone: 'Asia/Manila',
    });
    await service.listTeamOwed(MANAGER, TEAM_ID, {
      from: '2026-09-16',
      until: '2026-09-30',
    });
    expect(timePolicy.teamTimezone).toHaveBeenCalledWith(TEAM_ID);
    const [q] = timeEntryQueries(queries);
    expect(q.calls).toEqual(
      expect.arrayContaining([
        ['gte', 'started_at', '2026-09-15T16:00:00.000Z'],
        ['lt', 'started_at', '2026-09-30T16:00:00.000Z'],
      ]),
    );
    expect(q.calls.some(([m]) => m === 'lte')).toBe(false);
  });

  it('follows the team timezone across a DST change', async () => {
    const { service, queries } = build({ teamTimezone: 'America/New_York' });
    await service.listTeamOwed(MANAGER, TEAM_ID, { until: '2026-11-01' });
    const [q] = timeEntryQueries(queries);
    // 2026-11-02 00:00 EST (after the fall-back) is 05:00Z.
    expect(q.calls).toEqual(
      expect.arrayContaining([
        ['lt', 'started_at', '2026-11-02T05:00:00.000Z'],
      ]),
    );
  });

  it('reads an instant (the old to=) as its local date in the team timezone', async () => {
    const { service, queries } = build({ teamTimezone: 'Asia/Manila' });
    // 20:00Z on the 30th is already 1 October in Manila.
    await service.listTeamOwed(MANAGER, TEAM_ID, {
      until: '2026-09-30T20:00:00Z',
    });
    const [q] = timeEntryQueries(queries);
    expect(q.calls).toEqual(
      expect.arrayContaining([
        ['lt', 'started_at', '2026-10-01T16:00:00.000Z'],
      ]),
    );
  });

  it.each(['2026-02-30', 'soon'])('refuses %p as a date', async (bad) => {
    const { service } = build();
    await expect(
      service.listTeamOwed(MANAGER, TEAM_ID, { until: bad }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /** E18 / L63: per (member, currency), rounded once. */
  it('rounds each bucket once, never per entry', async () => {
    const { service } = build({
      owedPages: [
        [
          // 10 s at 100/h = 0.2777…; per-entry rounding would give 0.84.
          owed(E1, { payable_seconds: 10 }),
          owed(E2, { payable_seconds: 10 }),
          owed(E3, { payable_seconds: 10 }),
          owed('e-usd', {
            currency_snapshot: 'USD',
            payable_seconds: 1800,
            rate_snapshot: '20',
          }),
        ],
      ],
    });
    const rows = await service.listTeamOwed(MANAGER, TEAM_ID);
    const php = rows.find((r) => r.currency === 'PHP');
    const usd = rows.find((r) => r.currency === 'USD');
    expect(php).toMatchObject({
      member_user_id: WORKER,
      log_count: 3,
      entry_count: 3,
      amount: 0.83,
    });
    expect(php?.hours).toBeCloseTo(30 / 3600, 10);
    expect(usd).toMatchObject({ entry_count: 1, hours: 0.5, amount: 10 });
  });

  it('pays from payable seconds, not the raw duration', async () => {
    const { service } = build({
      owedPages: [
        [owed(E1, { payable_seconds: 5400, duration_seconds: 9999 })],
      ],
    });
    const [row] = await service.listTeamOwed(MANAGER, TEAM_ID);
    expect(row).toMatchObject({ hours: 1.5, amount: 150 });
  });

  it('reads every page', async () => {
    const page = Array.from({ length: 1000 }, (_, i) =>
      owed(`e-${i}`, { payable_seconds: 36 }),
    );
    const { service, queries } = build({
      owedPages: [page, [owed('e-last', { payable_seconds: 36 })]],
    });
    const [row] = await service.listTeamOwed(MANAGER, TEAM_ID);
    expect(row.entry_count).toBe(1001);
    const ranges = timeEntryQueries(queries).map((q) =>
      q.calls.find(([m]) => m === 'range'),
    );
    expect(ranges).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
  });
});

describe('PayoutsController owed query (D37)', () => {
  function controller() {
    const service = { listTeamOwed: jest.fn().mockResolvedValue([]) };
    return {
      service,
      ctl: new PayoutsController(service as unknown as PayoutsService),
    };
  }
  const user = { id: MANAGER } as never;

  it('accepts to as the old name for until', async () => {
    const { service, ctl } = controller();
    await ctl.listTeamOwed(
      TEAM_ID,
      user,
      '2026-09-01',
      undefined,
      '2026-09-15',
    );
    expect(service.listTeamOwed).toHaveBeenCalledWith(MANAGER, TEAM_ID, {
      from: '2026-09-01',
      until: '2026-09-15',
    });
  });

  it('prefers until when both come', async () => {
    const { service, ctl } = controller();
    await ctl.listTeamOwed(
      TEAM_ID,
      user,
      undefined,
      '2026-09-30',
      '2026-09-15',
    );
    expect(service.listTeamOwed).toHaveBeenCalledWith(MANAGER, TEAM_ID, {
      from: undefined,
      until: '2026-09-30',
    });
  });
});

describe('PayoutsService reads and void', () => {
  const paidRows = [
    {
      id: E1,
      duration_seconds: 3600,
      payable_seconds: 3600,
      task: { id: 't1', title: 'Build' },
      project: { id: 'p1', title: 'Acme' },
    },
    {
      id: E2,
      duration_seconds: 1800,
      payable_seconds: 1800,
      task: null,
      project: { id: 'p1', title: 'Acme' },
    },
  ];

  it('getPayout keeps logs and adds entries, the same rows', async () => {
    const { service, queries } = build({ payoutEntries: paidRows });
    const detail = await service.getPayout(MANAGER, 'payout-1');
    expect(detail.entries).toHaveLength(2);
    expect(detail.logs).toEqual(detail.entries);
    expect(detail.entries[0]).toMatchObject({
      id: E1,
      duration_seconds: 3600,
      task: { title: 'Build' },
      project: { title: 'Acme' },
      status: 'paid',
    });
    const [q] = timeEntryQueries(queries);
    const select = q.calls.find(([m]) => m === 'select')?.[1] as string;
    expect(select).toContain('roadmap_tasks!task_id');
    expect(select).toContain('projects!project_id');
    expect(select).not.toMatch(/_fkey/);
    expectNoStatusColumn(queries);
  });

  it('lets the member read their own payout with no other check', async () => {
    const { service, rpc, entitlements } = build({
      team: teamRow({ payouts_enabled: false }),
      payoutEntries: paidRows,
    });
    await expect(service.getPayout(WORKER, 'payout-1')).resolves.toMatchObject({
      id: 'payout-1',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(entitlements.assertFeature).not.toHaveBeenCalled();
  });

  it('refuses a stranger', async () => {
    await expect(
      build().service.getPayout(STRANGER, 'payout-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never plan-gates listing, viewing or voiding', async () => {
    const entitlements = payoutsDenied();
    const { service } = build({ entitlements, payoutEntries: paidRows });
    await service.listTeamPayouts(MANAGER, TEAM_ID);
    await service.getPayout(MANAGER, 'payout-1');
    await service.voidPayout(MANAGER, 'payout-1');
    expect(entitlements.assertFeature).not.toHaveBeenCalled();
  });

  it('voids through the RPC for a manager', async () => {
    const { service, rpcCalls } = build();
    await expect(
      service.voidPayout(MANAGER, 'payout-1'),
    ).resolves.toMatchObject({
      status: 'void',
    });
    expect(rpcCalls).toContainEqual({
      fn: 'void_payout_and_revert',
      args: { p_payout_id: 'payout-1', p_actor: MANAGER },
    });
  });

  it('a failed team or payout read is a fixed-copy 500 with no Postgres text (D55, W2 review F4)', async () => {
    const pgError = {
      code: '57014',
      message: 'canceling statement due to statement timeout',
    };
    const runs: Array<[string, (s: PayoutsService) => Promise<unknown>]> = [
      ['teams', (s) => s.listTeamPayouts(MANAGER, TEAM_ID)],
      [
        'teams',
        (s) =>
          s.createPayout(MANAGER, {
            team_id: TEAM_ID,
            member_user_id: WORKER,
            entry_ids: [E1],
          }),
      ],
      ['payouts', (s) => s.getPayout(MANAGER, 'payout-1')],
      ['payouts', (s) => s.voidPayout(MANAGER, 'payout-1')],
    ];
    for (const [table, run] of runs) {
      const { service } = build({ failures: { [table]: pgError } });
      const err = await failure(run(service));
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect(codeOf(err)).toBe('TIME_INTERNAL');
      expect(
        JSON.stringify((err as HttpException).getResponse()),
      ).not.toContain('canceling statement');
    }
  });

  it('answers an already-void payout with Proyekto copy', async () => {
    const { service } = build({
      voidResult: {
        data: null,
        error: { code: 'P0001', message: 'Payout is already void' },
      },
    });
    const err = await failure(service.voidPayout(MANAGER, 'payout-1'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as HttpException).message).toBe(
      'This payment is already void.',
    );
  });
});
