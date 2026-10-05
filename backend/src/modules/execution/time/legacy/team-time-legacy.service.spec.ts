import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../projects/authorization/project-authorization.service';
import { ROLE_DEFAULTS } from '../../projects/permissions/project-permissions';
import type { ListLogsQueryDto } from '../dto/legacy-team-time.dto';
import { TimeAuthorityService } from '../time-authority.service';
import { TimeEntriesService } from '../time-entries.service';
import {
  ENTRY_AUTH_SELECT,
  ENTRY_LEGACY_REVIEW_SELECT,
} from '../time-entry.select';
import type { CapContext, EntryAuthRow, TimeEntryView } from '../time.types';
import { TeamTimeLegacyService } from './team-time-legacy.service';

// ── Scripted PostgREST stand-in (the time-reports spec pattern): every chain is recorded; a per-table handler
// answers at await time ──────────────────────────────────────────────────────────────────────────────────────────

type Op = [string, ...unknown[]];
interface Call {
  table: string;
  select: string;
  options?: { count?: string; head?: boolean };
  ops: Op[];
}
interface Answer {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}
type Handler = (call: Call) => Answer;

function fakeDb(handlers: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const answer = () => {
        const r = handlers[table]?.(call) ?? { data: [] };
        return {
          data: r.data ?? null,
          error: r.error ?? null,
          count: r.count ?? null,
        };
      };
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string, options?: Call['options']) => {
        call.select = columns;
        call.options = options;
        return builder;
      };
      for (const m of [
        'eq',
        'neq',
        'is',
        'in',
        'not',
        'or',
        'gte',
        'lte',
        'lt',
        'order',
        'range',
        'limit',
      ]) {
        builder[m] = (...args: unknown[]) => {
          call.ops.push([m, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(answer());
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(answer()).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const opsOf = (call: Call, name: string) =>
  call.ops.filter((o) => o[0] === name);
const has = (call: Call, ...op: unknown[]) =>
  call.ops.some((o) => JSON.stringify(o) === JSON.stringify(op));
const entryCalls = (calls: Call[]) =>
  calls.filter((c) => c.table === 'time_entries');
/** The list query: ENTRY_AUTH_SELECT with count 'exact'. */
const listCall = (calls: Call[]) =>
  entryCalls(calls).find((c) => c.select.startsWith(ENTRY_AUTH_SELECT));

// ── Ids and fixtures ──────────────────────────────────────────────────────────────────────────────────────────

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TALENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DECIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LEGACY_REVIEWER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TEAM = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const A1 = '55555555-5555-4555-8555-555555555555';
const A2 = '66666666-6666-4666-8666-666666666666';

function authRow(partial: Partial<EntryAuthRow> = {}): EntryAuthRow {
  return {
    id: 'e1',
    member_user_id: ME,
    project_id: PROJECT,
    context_kind: 'team',
    context_ref: TEAM,
    team_id: TEAM,
    workspace_id: null,
    engagement_assignment_id: null,
    timesheet_id: 's1',
    started_at: '2026-09-02T01:00:00.000Z',
    ...partial,
  };
}

function view(partial: Partial<TimeEntryView> = {}): TimeEntryView {
  return {
    id: 'e1',
    context_kind: 'team',
    context_ref: TEAM,
    context_label_snapshot: 'Design team',
    timesheet_id: 's1',
    work_item: 'task',
    started_at: '2026-09-02T01:00:00.000Z',
    ended_at: '2026-09-02T03:00:00.000Z',
    paused_at: null,
    duration_seconds: 7200,
    break_seconds: 0,
    break_minutes: 0,
    payable_seconds: null,
    source: 'timer',
    work_type_snapshot: 'real_work',
    legacy_status: null,
    payout_id: null,
    flagged_reason: null,
    project_id: PROJECT,
    team_id: TEAM,
    workspace_id: null,
    engagement_assignment_id: null,
    created_at: '2026-09-02T03:00:00.000Z',
    updated_at: '2026-09-02T03:00:00.000Z',
    timesheet: {
      id: 's1',
      status: 'open',
      period_start: '2026-08-31',
      period_end: '2026-09-06',
      decision_kind: null,
      decided_by: null,
      decided_at: null,
      decision_note: null,
      scope_label_snapshot: 'Acme',
    },
    locked_reason: null,
    identity: 'visible',
    member_user_id: ME,
    member_display_name_snapshot: 'Me Myself',
    member: { id: ME, display_name: 'Me', avatar_url: null },
    member_label: null,
    content: 'visible',
    task_id: 't1',
    note: null,
    task: { id: 't1', title: 'Logo', work_type: 'real_work', status: 'done' },
    project: { id: PROJECT, title: 'Acme site' },
    content_label: null,
    cost: 'visible',
    rate_snapshot: 50,
    rate_type_snapshot: 'hourly',
    currency_snapshot: 'USD',
    amount_snapshot: null,
    ...partial,
  };
}

function q(partial: Partial<ListLogsQueryDto> = {}): ListLogsQueryDto {
  return { ...partial } as ListLogsQueryDto;
}

const CAP: CapContext = {
  over_limit: false,
  limit_window: 'weekly',
  limit_hours: 40,
  logged_hours_in_window: 2,
  overtime_requires_approval: true,
  window_start: '2026-08-31',
  window_end: '2026-09-06',
};

interface BuildOptions {
  handlers?: Record<string, Handler>;
  /** The rows the list query answers. */
  listRows?: EntryAuthRow[];
  listCount?: number;
  /** View per auth row (default: view({ id, member_user_id })). */
  viewFor?: (r: EntryAuthRow) => TimeEntryView;
}

async function build(o: BuildOptions = {}) {
  const listRows = o.listRows ?? [authRow()];
  const db = fakeDb({
    teams: () => ({ data: { id: TEAM, owner_id: OTHER } }),
    team_members: () => ({ count: 1 }),
    projects: () => ({ data: { id: PROJECT, owner_id: OTHER } }),
    profiles: () => ({ data: [] }),
    project_teams: () => ({ data: [] }),
    time_entries: (call) => {
      if (call.select.startsWith(ENTRY_AUTH_SELECT)) {
        return { data: listRows, count: o.listCount ?? listRows.length };
      }
      return { data: [] };
    },
    ...o.handlers,
  });
  const viewFor =
    o.viewFor ??
    ((r: EntryAuthRow) => view({ id: r.id, member_user_id: r.member_user_id }));
  const authority = {
    isTeamManager: jest.fn().mockResolvedValue(true),
    hydrate: jest.fn((_viewer: string, rows: EntryAuthRow[]) =>
      Promise.resolve(rows.map(viewFor)),
    ),
    identityVisible: jest.fn((_viewer: string, rows: EntryAuthRow[]) =>
      Promise.resolve(new Set(rows.map((r) => r.id))),
    ),
    costVisible: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const entries = {
    capContext: jest.fn().mockResolvedValue(new Map<string, CapContext>()),
    workItems: jest.fn().mockResolvedValue({
      tasks: [
        {
          id: 't1',
          title: 'Logo',
          work_type: 'real_work',
          feature_id: 'f1',
          feature_title: 'Brand',
          epic_id: 'ep1',
          epic_title: 'Launch',
        },
      ],
      presets: ['meeting', 'other'],
    }),
  };
  const projectAuth = {
    resolvePermissions: jest.fn().mockResolvedValue(ROLE_DEFAULTS.admin),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      TeamTimeLegacyService,
      { provide: SUPABASE_ADMIN, useValue: db.client },
      { provide: TimeAuthorityService, useValue: authority },
      { provide: TimeEntriesService, useValue: entries },
      { provide: ProjectAuthorizationService, useValue: projectAuth },
    ],
  }).compile();
  return {
    service: moduleRef.get(TeamTimeLegacyService),
    db,
    authority,
    entries,
    projectAuth,
  };
}

async function notFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(NotFoundException);
  await promise.catch((err: NotFoundException) => {
    expect(err.getResponse()).toMatchObject({ code: 'TIME_NOT_FOUND' });
  });
}

// Logged failures are expected in the error cases; keep the run quiet.
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// ── The Row builder ───────────────────────────────────────────────────────────────────────────────────────────

describe('TeamTimeLegacyService.rows (the Row builder, CC13)', () => {
  const decided = view({
    id: 'e1',
    payable_seconds: 7200,
    timesheet: {
      id: 's1',
      status: 'approved',
      period_start: '2026-08-31',
      period_end: '2026-09-06',
      decision_kind: 'manual',
      decided_by: DECIDER,
      decided_at: '2026-09-07T00:00:00.000Z',
      decision_note: 'Thanks',
      scope_label_snapshot: 'Acme',
    },
  });
  const legacyReviewed = view({ id: 'e2' });

  it('adds legacy review fields, the decider profile (one profiles query) and limit_context', async () => {
    const { service, db, entries } = await build({
      handlers: {
        time_entries: () => ({
          data: [
            {
              id: 'E2',
              legacy_reviewed_by: LEGACY_REVIEWER,
              legacy_reviewed_at: '2026-08-01T00:00:00.000Z',
              legacy_review_note: 'old ok',
              legacy_reviewer: {
                id: LEGACY_REVIEWER,
                display_name: 'Old Admin',
                avatar_url: null,
              },
            },
          ],
        }),
        profiles: () => ({
          data: [{ id: DECIDER, display_name: 'Dee', avatar_url: null }],
        }),
      },
    });
    entries.capContext.mockResolvedValue(new Map([['e1', CAP]]));

    const rows = await service.rows([decided, legacyReviewed], { cost: true });

    const review = entryCalls(db.calls);
    expect(review).toHaveLength(1);
    expect(review[0].select).toBe(ENTRY_LEGACY_REVIEW_SELECT);
    expect(has(review[0], 'in', 'id', ['e1', 'e2'])).toBe(true);
    const profiles = db.calls.filter((c) => c.table === 'profiles');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].select).toBe('id, display_name, avatar_url');
    expect(has(profiles[0], 'in', 'id', [DECIDER])).toBe(true);
    expect(entries.capContext).toHaveBeenCalledWith([decided, legacyReviewed]);

    expect(rows[0]).toMatchObject({
      status: 'approved',
      reviewed_by: DECIDER,
      review_note: 'Thanks',
      reviewer: { id: DECIDER, display_name: 'Dee', avatar_url: null },
      limit_context: CAP,
      rate_snapshot: 50,
      currency_snapshot: 'USD',
    });
    expect(rows[1]).toMatchObject({
      status: 'pending',
      reviewed_by: LEGACY_REVIEWER,
      reviewed_at: '2026-08-01T00:00:00.000Z',
      review_note: 'old ok',
      reviewer: { id: LEGACY_REVIEWER, display_name: 'Old Admin' },
    });
    expect(rows[1]).not.toHaveProperty('limit_context');
  });

  it('no sheet decision → no profiles query; cost: false strips cost', async () => {
    const { service, db } = await build();
    const [row] = await service.rows([legacyReviewed], { cost: false });
    expect(db.calls.filter((c) => c.table === 'profiles')).toHaveLength(0);
    expect(row).not.toHaveProperty('rate_snapshot');
    expect(row).not.toHaveProperty('currency_snapshot');
  });

  it('no views → no query at all', async () => {
    const { service, db, entries } = await build();
    expect(await service.rows([], { cost: true })).toEqual([]);
    expect(db.calls).toHaveLength(0);
    expect(entries.capContext).not.toHaveBeenCalled();
  });

  it('after a write the extras are best effort; on a read a failure is a read-copy 500', async () => {
    const { service, entries } = await build({
      handlers: {
        time_entries: () => ({
          error: { code: 'XX000', message: 'relation "x" does not exist' },
        }),
      },
    });
    const [row] = await service.rows([legacyReviewed], {
      cost: true,
      write: true,
    });
    expect(row).toMatchObject({
      id: 'e2',
      status: 'pending',
      reviewed_by: null,
    });

    entries.capContext.mockResolvedValue(new Map());
    const read = service.rows([legacyReviewed], { cost: true });
    await expect(read).rejects.toBeInstanceOf(InternalServerErrorException);
    await read.catch((err: InternalServerErrorException) => {
      expect(err.getResponse()).toEqual({
        code: 'TIME_INTERNAL',
        message: "Proyekto couldn't load this time. Try again.",
      });
      expect(JSON.stringify(err.getResponse())).not.toContain('relation');
    });
  });
});

// ── Team routes ───────────────────────────────────────────────────────────────────────────────────────────────

describe('TeamTimeLegacyService team routes', () => {
  it('#15 a stranger, an unknown team and a malformed id are 404', async () => {
    const stranger = await build({
      handlers: { team_members: () => ({ count: 0 }) },
    });
    await notFound(stranger.service.listTeamMine(ME, TEAM, q()));
    expect(entryCalls(stranger.db.calls)).toHaveLength(0);

    const unknown = await build({
      handlers: { teams: () => ({ data: null }) },
    });
    await notFound(unknown.service.listTeamMine(ME, TEAM, q()));

    const malformed = await build({
      handlers: {
        teams: () => ({ error: { code: '22P02', message: 'invalid input' } }),
      },
    });
    await notFound(malformed.service.listTeamMine(ME, 'nope', q()));
  });

  it('#15 the team owner passes without a member row; never gated on the team toggle', async () => {
    const { service, db } = await build({
      handlers: {
        teams: () => ({ data: { id: TEAM, owner_id: ME } }),
        team_members: () => ({ count: 0 }),
      },
    });
    await service.listTeamMine(ME, TEAM, q());
    expect(db.calls.some((c) => c.table === 'team_members')).toBe(false);
  });

  it('#15 own team-context entries, newest first, count exact, default limit 50, self email and cost', async () => {
    const { service, db, authority, entries } = await build({
      listRows: [authRow({ id: 'e1' }), authRow({ id: 'e2' })],
      listCount: 7,
    });
    entries.capContext.mockResolvedValue(new Map([['e2', CAP]]));
    const result = await service.listTeamMine(
      ME,
      TEAM,
      q({ member_user_id: OTHER, project_id: PROJECT }),
    );

    const list = listCall(db.calls)!;
    expect(list.select).toBe(ENTRY_AUTH_SELECT);
    expect(list.options).toEqual({ count: 'exact' });
    expect(has(list, 'eq', 'context_kind', 'team')).toBe(true);
    expect(has(list, 'eq', 'team_id', TEAM)).toBe(true);
    // The person is forced to the caller; the query's member filter is ignored.
    expect(opsOf(list, 'eq').filter((o) => o[1] === 'member_user_id')).toEqual([
      ['eq', 'member_user_id', ME],
    ]);
    expect(has(list, 'eq', 'project_id', PROJECT)).toBe(true);
    expect(opsOf(list, 'order')).toEqual([
      ['order', 'started_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
    ]);
    expect(opsOf(list, 'range')).toEqual([['range', 0, 49]]);
    expect(authority.hydrate).toHaveBeenCalledWith(
      ME,
      [authRow({ id: 'e1' }), authRow({ id: 'e2' })],
      { withEmail: true },
    );
    expect(result.total).toBe(7);
    expect(result.items.map((r) => r.id)).toEqual(['e1', 'e2']);
    expect(result.items[0]).toHaveProperty('rate_snapshot', 50);
    expect(result.items[1].limit_context).toEqual(CAP);
  });

  it('page/limit, task_status (inner task join), status, from/to (raw started_at bounds)', async () => {
    const { service, db } = await build();
    await service.listTeamMine(
      ME,
      TEAM,
      q({
        page: 3,
        limit: 200,
        task_status: 'done',
        status: 'approved',
        from: '2026-09-01',
        to: '2026-09-30T23:59:59.999Z',
      }),
    );
    const list = listCall(db.calls)!;
    expect(list.select).toBe(
      `${ENTRY_AUTH_SELECT}, task:roadmap_tasks!task_id!inner(status)`,
    );
    expect(has(list, 'eq', 'task.status', 'done')).toBe(true);
    expect(opsOf(list, 'range')).toEqual([['range', 400, 599]]);
    expect(has(list, 'not', 'payable_seconds', 'is', null)).toBe(true);
    expect(has(list, 'is', 'payout_id', null)).toBe(true);
    expect(has(list, 'is', 'legacy_status', null)).toBe(true);
    expect(has(list, 'gte', 'started_at', '2026-09-01')).toBe(true);
    expect(has(list, 'lte', 'started_at', '2026-09-30T23:59:59.999Z')).toBe(
      true,
    );
    // Never time_entries.status (D03).
    expect(JSON.stringify(list.ops)).not.toMatch(/"status"/);
  });

  it('status=paid is one or-group', async () => {
    const { service, db } = await build();
    await service.listTeamMine(ME, TEAM, q({ status: 'paid' }));
    expect(opsOf(listCall(db.calls)!, 'or')).toEqual([
      ['or', 'payout_id.not.is.null,legacy_status.eq.paid_outside'],
    ]);
  });

  it('#19 a team member who does not manage the team is 404 before any entry read', async () => {
    const { service, db, authority } = await build();
    authority.isTeamManager.mockResolvedValue(false);
    await notFound(service.listTeam(ME, TEAM, q()));
    await notFound(service.teamSummary(ME, TEAM, q()));
    expect(entryCalls(db.calls)).toHaveLength(0);
  });

  it('#19 every team-context entry of the team, member/project filters, manager emails, cost per row', async () => {
    const { service, db, authority } = await build({
      listRows: [authRow({ id: 'e1', member_user_id: OTHER })],
      viewFor: (r) =>
        view({
          id: r.id,
          member_user_id: OTHER,
          cost: 'hidden',
          rate_snapshot: undefined,
          rate_type_snapshot: undefined,
          currency_snapshot: undefined,
          amount_snapshot: undefined,
        }),
    });
    const result = await service.listTeam(
      ME,
      TEAM,
      q({ member_user_id: OTHER, project_id: PROJECT }),
    );
    const list = listCall(db.calls)!;
    expect(has(list, 'eq', 'context_kind', 'team')).toBe(true);
    expect(has(list, 'eq', 'team_id', TEAM)).toBe(true);
    expect(has(list, 'eq', 'member_user_id', OTHER)).toBe(true);
    expect(has(list, 'eq', 'project_id', PROJECT)).toBe(true);
    expect(authority.hydrate).toHaveBeenCalledWith(ME, expect.any(Array), {
      withEmail: true,
    });
    expect(result.items[0]).not.toHaveProperty('rate_snapshot');
  });

  it('#16 own summary: cost columns selected, status/task_status ignored, statusCounts present', async () => {
    const { service, db } = await build({
      handlers: {
        time_entries: () => ({
          data: [
            {
              id: 'e1',
              member_user_id: ME,
              duration_seconds: 3600,
              payable_seconds: 3600,
              payout_id: null,
              legacy_status: null,
              rate_snapshot: 40,
              currency_snapshot: 'USD',
              amount_snapshot: null,
            },
          ],
        }),
      },
    });
    const summary = await service.teamMineSummary(
      ME,
      TEAM,
      q({ status: 'paid', task_status: 'done', from: '2026-09-01' }),
    );
    const [call] = entryCalls(db.calls);
    expect(call.select).toBe(
      'id, member_user_id, duration_seconds, payable_seconds, payout_id, legacy_status, ' +
        'rate_snapshot, currency_snapshot, amount_snapshot',
    );
    expect(has(call, 'eq', 'member_user_id', ME)).toBe(true);
    expect(has(call, 'gte', 'started_at', '2026-09-01')).toBe(true);
    expect(opsOf(call, 'or')).toEqual([]);
    expect(has(call, 'eq', 'task.status', 'done')).toBe(false);
    expect(summary).toEqual({
      buckets: {
        USD: {
          pendingFees: 0,
          approvedFees: 40,
          paidFees: 0,
          rejectedFees: 0,
          totalFees: 40,
        },
      },
      currencies: ['USD'],
      totalHours: 1,
      statusCounts: { pending: 0, approved: 1, paid: 0, rejected: 0 },
    });
  });

  it('summaries page through every row (1000 per page)', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      id: `e${i}`,
      member_user_id: ME,
      duration_seconds: 36,
      payable_seconds: null,
      payout_id: null,
      legacy_status: null,
    }));
    let n = 0;
    const { service, db } = await build({
      handlers: {
        time_entries: () =>
          n++ === 0 ? { data: page } : { data: page.slice(0, 3) },
      },
    });
    const summary = await service.teamMineSummary(ME, TEAM, q());
    expect(entryCalls(db.calls).map((c) => opsOf(c, 'range')[0])).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
    expect(summary.statusCounts.pending).toBe(1003);
  });

  it('#20 a manager who reads the team cost: one pass with cost; the verdict is asked with one synthetic team row', async () => {
    const { service, db, authority } = await build();
    authority.costVisible.mockResolvedValue(new Set(['team-cost-probe']));
    await service.teamSummary(ME, TEAM, q({ member_user_id: OTHER }));
    expect(authority.costVisible).toHaveBeenCalledWith(ME, [
      expect.objectContaining({
        id: 'team-cost-probe',
        member_user_id: null,
        context_kind: 'team',
        team_id: TEAM,
      }),
    ]);
    const calls = entryCalls(db.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].select).toContain('rate_snapshot');
    expect(has(calls[0], 'eq', 'member_user_id', OTHER)).toBe(true);
  });

  it('#20 a manager who may not read the team cost: hours over all rows, fees from own rows only', async () => {
    const { service, db } = await build({
      handlers: {
        time_entries: (call) =>
          call.select.includes('rate_snapshot')
            ? {
                data: [
                  {
                    id: 'e1',
                    member_user_id: ME,
                    duration_seconds: 3600,
                    payable_seconds: null,
                    payout_id: null,
                    legacy_status: null,
                    rate_snapshot: 10,
                    currency_snapshot: 'EUR',
                    amount_snapshot: null,
                  },
                ],
              }
            : {
                data: [
                  {
                    id: 'e1',
                    member_user_id: ME,
                    duration_seconds: 3600,
                    payable_seconds: null,
                    payout_id: null,
                    legacy_status: null,
                  },
                  {
                    id: 'e2',
                    member_user_id: OTHER,
                    duration_seconds: 3600,
                    payable_seconds: null,
                    payout_id: null,
                    legacy_status: null,
                  },
                ],
              },
      },
    });
    const summary = await service.teamSummary(ME, TEAM, q());
    const [base, own] = entryCalls(db.calls);
    expect(base.select).not.toContain('rate_snapshot');
    expect(own.select).toContain('rate_snapshot');
    expect(has(own, 'eq', 'member_user_id', ME)).toBe(true);
    expect(summary.totalHours).toBe(2);
    expect(summary.statusCounts.pending).toBe(2);
    expect(summary.currencies).toEqual(['EUR']);
    expect(summary.buckets.EUR.totalFees).toBe(10);
  });

  it('#20 hidden team cost filtered to someone else: no own pass, buckets {}', async () => {
    const { service, db } = await build({
      handlers: {
        time_entries: () => ({
          data: [
            {
              id: 'e2',
              member_user_id: OTHER,
              duration_seconds: 3600,
              payable_seconds: null,
              payout_id: null,
              legacy_status: null,
            },
          ],
        }),
      },
    });
    const summary = await service.teamSummary(
      ME,
      TEAM,
      q({ member_user_id: OTHER }),
    );
    expect(entryCalls(db.calls)).toHaveLength(1);
    expect(entryCalls(db.calls)[0].select).not.toContain('rate_snapshot');
    expect(summary.buckets).toEqual({});
    expect(summary.currencies).toEqual([]);
    expect(summary.statusCounts).toEqual({
      pending: 1,
      approved: 0,
      paid: 0,
      rejected: 0,
    });
  });

  it('#21 the team projects, once each', async () => {
    const { service, db } = await build({
      handlers: {
        project_teams: () => ({
          data: [
            { project: { id: PROJECT, title: 'Acme site' } },
            { project: { id: PROJECT, title: 'Acme site' } },
            { project: null },
          ],
        }),
      },
    });
    expect(await service.teamProjects(ME, TEAM)).toEqual([
      { id: PROJECT, title: 'Acme site' },
    ]);
    const call = db.calls.find((c) => c.table === 'project_teams')!;
    expect(call.select).toBe(
      'project:projects!project_teams_project_id_fkey(id, title)',
    );
  });

  it('#22 emails are selected for team managers only; avatars for everyone', async () => {
    const rows = {
      team_members: (call: Call) =>
        call.options?.head
          ? { count: 1 }
          : {
              data: [
                {
                  user: {
                    id: OTHER,
                    display_name: 'Ann',
                    avatar_url: 'https://cdn.test/ann.png',
                    email: 'ann@x.io',
                  },
                },
                { user: null },
              ],
            },
    };
    const manager = await build({ handlers: rows });
    expect(await manager.service.teamMembers(ME, TEAM)).toEqual([
      {
        id: OTHER,
        display_name: 'Ann',
        avatar_url: 'https://cdn.test/ann.png',
        email: 'ann@x.io',
      },
    ]);
    const managerCall = manager.db.calls.find(
      (c) => c.table === 'team_members' && !c.options?.head,
    )!;
    expect(managerCall.select).toBe(
      'user:profiles!team_members_user_id_fkey(id, display_name, avatar_url, email)',
    );

    const member = await build({ handlers: rows });
    member.authority.isTeamManager.mockResolvedValue(false);
    const members = await member.service.teamMembers(ME, TEAM);
    expect(members).toEqual([
      {
        id: OTHER,
        display_name: 'Ann',
        avatar_url: 'https://cdn.test/ann.png',
      },
    ]);
    expect(members[0]).not.toHaveProperty('email');
    const memberCall = member.db.calls.find(
      (c) => c.table === 'team_members' && !c.options?.head,
    )!;
    expect(memberCall.select).toBe(
      'user:profiles!team_members_user_id_fkey(id, display_name, avatar_url)',
    );
  });

  it('#22 a profile without an avatar reads avatar_url null', async () => {
    const { service } = await build({
      handlers: {
        team_members: (call: Call) =>
          call.options?.head
            ? { count: 1 }
            : { data: [{ user: { id: OTHER, display_name: null } }] },
      },
    });
    expect(await service.teamMembers(ME, TEAM)).toEqual([
      { id: OTHER, display_name: null, avatar_url: null, email: null },
    ]);
  });

  it('#18 tasks only, after the team check', async () => {
    const stranger = await build({
      handlers: { team_members: () => ({ count: 0 }) },
    });
    await notFound(stranger.service.teamTasks(ME, TEAM, PROJECT));
    expect(stranger.entries.workItems).not.toHaveBeenCalled();

    const { service, entries } = await build();
    const tasks = await service.teamTasks(ME, TEAM, PROJECT);
    expect(entries.workItems).toHaveBeenCalledWith(ME, PROJECT);
    expect(tasks).toEqual([
      {
        id: 't1',
        title: 'Logo',
        work_type: 'real_work',
        feature_id: 'f1',
        feature_title: 'Brand',
        epic_id: 'ep1',
        epic_title: 'Launch',
      },
    ]);
  });
});

// ── Project routes ────────────────────────────────────────────────────────────────────────────────────────────

describe('TeamTimeLegacyService project routes', () => {
  it('#23 project access (404), then exactly { enforcement: off, engagement_status: engaged }', async () => {
    const none = await build({
      handlers: { projects: () => ({ data: null }) },
    });
    await notFound(none.service.contractStatus(ME, PROJECT));

    const noAccess = await build();
    noAccess.projectAuth.resolvePermissions.mockResolvedValue(null);
    await notFound(noAccess.service.contractStatus(ME, PROJECT));

    const owner = await build({
      handlers: { projects: () => ({ data: { id: PROJECT, owner_id: ME } }) },
    });
    owner.projectAuth.resolvePermissions.mockResolvedValue(null);
    expect(await owner.service.contractStatus(ME, PROJECT)).toEqual({
      enforcement: 'off',
      engagement_status: 'engaged',
    });
  });

  it('a raw resolvePermissions failure is a read-copy 500 without Postgres text', async () => {
    const { service, projectAuth } = await build();
    projectAuth.resolvePermissions.mockRejectedValue(
      new Error('permission denied for table project_access'),
    );
    const call = service.contractStatus(ME, PROJECT);
    await expect(call).rejects.toBeInstanceOf(InternalServerErrorException);
    await call.catch((err: InternalServerErrorException) => {
      expect(JSON.stringify(err.getResponse())).not.toContain('project_access');
    });
  });

  it('#24 own entries on the project, personal included; cost and email (self)', async () => {
    const { service, db, authority } = await build({
      listRows: [
        authRow({
          id: 'p1',
          context_kind: 'personal',
          team_id: null,
          context_ref: null,
        }),
      ],
    });
    const result = await service.listProjectMine(
      ME,
      PROJECT,
      q({ project_id: 'ignored', member_user_id: OTHER }),
    );
    const list = listCall(db.calls)!;
    expect(opsOf(list, 'eq')).toEqual([
      ['eq', 'project_id', PROJECT],
      ['eq', 'member_user_id', ME],
    ]);
    expect(opsOf(list, 'or')).toEqual([]);
    expect(authority.hydrate).toHaveBeenCalledWith(ME, expect.any(Array), {
      withEmail: true,
    });
    expect(result.items[0]).toHaveProperty('rate_snapshot', 50);
  });

  it('#26 needs time.view_team_logs: 403 missing_permission (no access is 404)', async () => {
    const viewer = await build();
    viewer.projectAuth.resolvePermissions.mockResolvedValue(
      ROLE_DEFAULTS.viewer,
    );
    const denied = viewer.service.listProject(ME, PROJECT, q());
    await expect(denied).rejects.toBeInstanceOf(ForbiddenException);
    await denied.catch((err: ForbiddenException) => {
      expect(err.getResponse()).toMatchObject({
        code: 'missing_permission',
        path: 'time.view_team_logs',
      });
    });
    for (const call of [
      viewer.service.projectSummary(ME, PROJECT, q()),
      viewer.service.projectMembers(ME, PROJECT),
    ]) {
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(entryCalls(viewer.db.calls)).toHaveLength(0);

    const stranger = await build();
    stranger.projectAuth.resolvePermissions.mockResolvedValue(null);
    await notFound(stranger.service.listProject(ME, PROJECT, q()));
  });

  it("#26 non-personal entries plus the caller's personal ones; no cost, no email, masked rows", async () => {
    const { service, db, authority } = await build({
      listRows: [
        authRow({ id: 'e1', member_user_id: OTHER }),
        authRow({
          id: 'e2',
          member_user_id: TALENT,
          context_kind: 'assignment',
          context_ref: A1,
          team_id: null,
          engagement_assignment_id: A1,
        }),
      ],
      viewFor: (r) =>
        r.id === 'e2'
          ? view({
              id: 'e2',
              context_kind: 'assignment',
              context_ref: A1,
              identity: 'masked',
              member_user_id: null,
              member: null,
              member_display_name_snapshot: null,
              member_label: 'Delivery team',
            })
          : view({ id: r.id, member_user_id: OTHER }),
    });
    const result = await service.listProject(ME, PROJECT, q());
    const list = listCall(db.calls)!;
    expect(has(list, 'eq', 'project_id', PROJECT)).toBe(true);
    expect(opsOf(list, 'or')).toEqual([
      ['or', `context_kind.neq.personal,member_user_id.eq.${ME}`],
    ]);
    expect(authority.hydrate).toHaveBeenCalledWith(ME, expect.any(Array), {
      withEmail: false,
    });
    for (const item of result.items) {
      expect(item).not.toHaveProperty('rate_snapshot');
      expect(item).not.toHaveProperty('currency_snapshot');
    }
    expect(result.items[1]).toMatchObject({
      member_user_id: `masked:${A1}`,
      member: { display_name: 'Delivery team member', avatar_url: null },
    });
    // No person filter: no identity probe.
    expect(authority.identityVisible).not.toHaveBeenCalled();
  });

  it('#26/#27 F1: a person filter naming someone else drops the assignments the caller may not name', async () => {
    const { service, db, authority } = await build({
      handlers: {
        time_entries: (call) => {
          if (call.select === 'id, engagement_assignment_id') {
            return {
              data: [
                { id: 'x1', engagement_assignment_id: A1 },
                { id: 'x2', engagement_assignment_id: A1 },
                { id: 'x3', engagement_assignment_id: A2 },
              ],
            };
          }
          if (call.select.startsWith(ENTRY_AUTH_SELECT)) {
            return { data: [], count: 0 };
          }
          return { data: [] };
        },
      },
    });
    authority.identityVisible.mockImplementation(
      (_viewer: string, rows: EntryAuthRow[]) =>
        Promise.resolve(
          new Set(rows.filter((r) => r.id === A2).map((r) => r.id)),
        ),
    );
    await service.listProject(
      ME,
      PROJECT,
      q({ member_user_id: TALENT, status: 'paid' }),
    );
    const probe = entryCalls(db.calls).find(
      (c) => c.select === 'id, engagement_assignment_id',
    )!;
    expect(has(probe, 'eq', 'member_user_id', TALENT)).toBe(true);
    expect(has(probe, 'eq', 'context_kind', 'assignment')).toBe(true);
    expect(authority.identityVisible).toHaveBeenCalledWith(ME, [
      expect.objectContaining({
        id: A1,
        member_user_id: TALENT,
        context_kind: 'assignment',
        engagement_assignment_id: A1,
      }),
      expect.objectContaining({ id: A2, member_user_id: TALENT }),
    ]);
    const list = listCall(db.calls)!;
    expect(has(list, 'eq', 'member_user_id', TALENT)).toBe(true);
    expect(opsOf(list, 'or')).toEqual([
      [
        'or',
        `and(or(context_kind.neq.personal,member_user_id.eq.${ME}),` +
          `or(engagement_assignment_id.is.null,engagement_assignment_id.not.in.(${A1})),` +
          'or(payout_id.not.is.null,legacy_status.eq.paid_outside))',
      ],
    ]);
  });

  it('#26 a person filter naming the caller needs no probe', async () => {
    const { service, db, authority } = await build();
    await service.listProject(ME, PROJECT, q({ member_user_id: ME }));
    expect(authority.identityVisible).not.toHaveBeenCalled();
    expect(
      entryCalls(db.calls).some(
        (c) => c.select === 'id, engagement_assignment_id',
      ),
    ).toBe(false);
  });

  it('#27 never selects cost: buckets {} and currencies [] with statusCounts', async () => {
    const { service, db } = await build({
      handlers: {
        time_entries: () => ({
          data: [
            {
              id: 'e1',
              member_user_id: ME,
              duration_seconds: 1800,
              payable_seconds: null,
              payout_id: 'p1',
              legacy_status: null,
            },
          ],
        }),
      },
    });
    const summary = await service.projectSummary(ME, PROJECT, q());
    for (const call of entryCalls(db.calls)) {
      expect(call.select).not.toMatch(
        /rate_snapshot|currency_snapshot|amount_snapshot/,
      );
    }
    expect(summary).toEqual({
      buckets: {},
      currencies: [],
      totalHours: 0.5,
      statusCounts: { pending: 0, approved: 0, paid: 1, rejected: 0 },
    });
  });

  it('#28 the project members without email; a worker the caller may not name is "Delivery team member" per assignment', async () => {
    const { service, db, authority } = await build({
      handlers: {
        time_entries: () => ({
          data: [
            {
              id: 'e1',
              member_user_id: OTHER,
              context_kind: 'team',
              engagement_assignment_id: null,
            },
            {
              id: 'e2',
              member_user_id: OTHER,
              context_kind: 'team',
              engagement_assignment_id: null,
            },
            {
              id: 'e3',
              member_user_id: TALENT,
              context_kind: 'assignment',
              engagement_assignment_id: A1,
            },
            {
              id: 'e4',
              member_user_id: ME,
              context_kind: 'personal',
              engagement_assignment_id: null,
            },
          ],
        }),
        profiles: () => ({
          data: [
            {
              id: OTHER,
              display_name: 'Ann',
              avatar_url: 'https://cdn.test/ann.png',
            },
            { id: ME, display_name: 'Me', avatar_url: null },
          ],
        }),
      },
    });
    authority.identityVisible.mockResolvedValue(new Set<string>());
    const members = await service.projectMembers(ME, PROJECT);
    expect(members).toEqual([
      {
        id: OTHER,
        display_name: 'Ann',
        avatar_url: 'https://cdn.test/ann.png',
      },
      { id: ME, display_name: 'Me', avatar_url: null },
      {
        id: `masked:${A1}`,
        display_name: 'Delivery team member',
        avatar_url: null,
      },
    ]);
    for (const m of members) expect(m).not.toHaveProperty('email');
    const scan = entryCalls(db.calls)[0];
    expect(opsOf(scan, 'or')).toEqual([
      ['or', `context_kind.neq.personal,member_user_id.eq.${ME}`],
    ]);
    const profiles = db.calls.find((c) => c.table === 'profiles')!;
    expect(profiles.select).toBe('id, display_name, avatar_url');
    expect(has(profiles, 'in', 'id', [OTHER, ME])).toBe(true);
  });
});
