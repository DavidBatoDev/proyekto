import { ConflictException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  TIME_CRON_BATCH,
  TIME_CRON_BUDGET_MS,
  TimeCronService,
} from './time-cron.service';
import { TimeEntriesService } from './time-entries.service';
import { timeError } from './time-errors';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimesheetsService } from './timesheets.service';

// TimeCronService (backend.md › Cron, D52). The file name follows the blueprint's P11 ownership.

const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const MEMBER = uid(1);
const WS = uid(10);
const TEAM = uid(20);

/** The run's clock: Wednesday 2026-09-23 12:00 UTC. */
const NOW = new Date('2026-09-23T12:00:00.000Z');
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

type Row = Record<string, unknown>;

// ── a PostgREST stand-in ─────────────────────────────────────────────────────
function fakeDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Row) => { data?: unknown; error?: unknown }>,
) {
  const failures: Record<string, unknown> = {};
  const from = jest.fn((table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let lim: number | null = null;
    let rng: [number, number] | null = null;
    const str = (v: unknown): string | null =>
      v === null || v === undefined
        ? null
        : String(v as string | number | boolean);
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        preds.push((r) => r[c] === v);
        return chain;
      },
      in: (c: string, vs: unknown[]) => {
        preds.push((r) => vs.includes(r[c]));
        return chain;
      },
      is: (c: string, v: unknown) => {
        preds.push((r) =>
          v === null ? r[c] === null || r[c] === undefined : r[c] === v,
        );
        return chain;
      },
      gte: (c: string, v: string) => {
        preds.push((r) => (str(r[c]) ?? '') >= v);
        return chain;
      },
      gt: (c: string, v: string) => {
        preds.push((r) => (str(r[c]) ?? '') > v);
        return chain;
      },
      lte: (c: string, v: string) => {
        preds.push((r) => str(r[c]) !== null && (str(r[c]) ?? '') <= v);
        return chain;
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        orders.push({ col: c, asc: o?.ascending !== false });
        return chain;
      },
      limit: (n: number) => {
        lim = n;
        return chain;
      },
      range: (a: number, b: number) => {
        rng = [a, b];
        return chain;
      },
    };
    const exec = () => {
      if (failures[table]) return { data: null, error: failures[table] };
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      rows = [...rows].sort((a, b) => {
        for (const o of orders) {
          const av = str(a[o.col]) ?? '';
          const bv = str(b[o.col]) ?? '';
          if (av !== bv) return (av < bv ? -1 : 1) * (o.asc ? 1 : -1);
        }
        return 0;
      });
      if (rng) rows = rows.slice(rng[0], rng[1] + 1);
      if (lim !== null) rows = rows.slice(0, lim);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(exec()).then(ok, ko);
    return chain;
  });
  const rpc = jest.fn((name: string, args: Row) => {
    const handler = rpcs[name];
    const out = handler ? handler(args) : { data: null };
    return Promise.resolve({
      data: out.data ?? null,
      error: out.error ?? null,
    });
  });
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, failures };
}

function running(id: number, startedAt: string, over: Row = {}): Row {
  return {
    id: uid(id),
    member_user_id: MEMBER,
    context_kind: 'team',
    team_id: TEAM,
    timesheet_id: uid(900),
    started_at: startedAt,
    ended_at: null,
    ...over,
  };
}

function sheetRow(id: number, over: Row = {}): Row {
  return {
    id: uid(id),
    member_user_id: MEMBER,
    scope_kind: 'workspace',
    scope_ref: WS,
    team_id: null,
    workspace_id: WS,
    engagement_id: null,
    policy_workspace_id: WS,
    period_kind: 'weekly',
    period_start: '2026-09-14',
    period_end: '2026-09-20',
    timezone: 'UTC',
    week_start: 1,
    status: 'open',
    approver_scope: null,
    revision: 1,
    submitted_at: null,
    decided_at: null,
    ...over,
  };
}

/** A stopped entry on a sheet (the sheet has entries, none running). */
function stopped(id: number, sheetId: string): Row {
  return {
    id: uid(id),
    member_user_id: MEMBER,
    context_kind: 'workspace',
    team_id: null,
    timesheet_id: sheetId,
    started_at: '2026-09-15T09:00:00.000Z',
    ended_at: '2026-09-15T10:00:00.000Z',
  };
}

interface World {
  tables: Record<string, Row[]>;
  routes?: Record<string, string>;
  reminderDays?: number;
}

async function setup(world: World) {
  const tables = world.tables;
  const routes = world.routes ?? {};
  const db = fakeDb(tables, {
    time_sheet_routing_preview: (args) => {
      const scope = routes[args.p_timesheet_id as string];
      return {
        data: scope ? { approver_scope: scope, routing: {} } : null,
      };
    },
  });
  const entries = {
    // A system stop really stops the row, so a second run finds nothing to do.
    stop: jest.fn((_actor: string | null, id: string) => {
      const row = tables.time_entries.find((r) => r.id === id);
      if (row) row.ended_at = NOW.toISOString();
      return Promise.resolve({ id });
    }),
  };
  const timesheets = {
    act: jest.fn((_actor: string | null, action: string, ids: string[]) => {
      for (const id of ids) {
        const row = (tables.timesheets ?? []).find((r) => r.id === id);
        if (!row) continue;
        row.status = 'approved';
        if (action === 'approve') row.decided_at = NOW.toISOString();
      }
      return Promise.resolve([]);
    }),
  };
  const policy = {
    resolve: jest.fn(() =>
      Promise.resolve({ reminder_days: world.reminderDays ?? 1 }),
    ),
  };
  const sent = new Set<string>();
  const notifications = {
    timerAutoStopped: jest.fn(() => Promise.resolve(undefined)),
    timerRunningLong: jest.fn((e: Row) => {
      sent.add(`timer_running_long|${e.id as string}`);
      return Promise.resolve(undefined);
    }),
    reminder: jest.fn((s: Row) => {
      sent.add(`timesheet_reminder|${s.id as string}`);
      return Promise.resolve(undefined);
    }),
    hasNotified: jest.fn(
      (_user: string, type: string, _key: string, value: string) =>
        Promise.resolve(sent.has(`${type}|${value}`)),
    ),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeCronService,
      { provide: SUPABASE_ADMIN, useValue: db.client },
      { provide: TimeEntriesService, useValue: entries },
      { provide: TimesheetsService, useValue: timesheets },
      { provide: TimePolicyService, useValue: policy },
      { provide: TimeNotificationsService, useValue: notifications },
    ],
  }).compile();
  return {
    cron: moduleRef.get(TimeCronService),
    db,
    entries,
    timesheets,
    policy,
    notifications,
    tables,
  };
}

const EMPTY = {
  auto_stopped: 0,
  long_notified: 0,
  auto_submitted: 0,
  finished: 0,
  reminders: 0,
  errors: [],
  truncated: false,
};

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('TimeCronService.run', () => {
  it('an empty database answers zero counts', async () => {
    const { cron } = await setup({
      tables: { time_entries: [], timesheets: [] },
    });
    expect(await cron.run(NOW)).toEqual(EMPTY);
  });

  describe('job 1: 24 h auto-stop', () => {
    it('stops at started_at + 24h with the flag, notifies once, and is idempotent', async () => {
      const t = setup({
        tables: {
          time_entries: [
            running(1, hoursAgo(30)),
            running(2, hoursAgo(23)), // under 24 h: left alone
          ],
          timesheets: [],
        },
      });
      const { cron, entries, notifications } = await t;
      const first = await cron.run(NOW);
      expect(first.auto_stopped).toBe(1);
      expect(entries.stop).toHaveBeenCalledTimes(1);
      expect(entries.stop).toHaveBeenCalledWith(null, uid(1), {
        system: true,
        endedAt: new Date(NOW.getTime() - 6 * 3_600_000).toISOString(),
        flaggedReason: 'auto_stopped_24h',
      });
      expect(notifications.timerAutoStopped).toHaveBeenCalledTimes(1);
      expect(
        (notifications.timerAutoStopped.mock.calls[0] as unknown[])[1],
      ).toBe('auto_stopped_24h');

      const second = await cron.run(NOW);
      expect(second.auto_stopped).toBe(0);
      expect(entries.stop).toHaveBeenCalledTimes(1);
    });

    it('a timer its member stopped meanwhile is skipped; any other failure is an error without Postgres text', async () => {
      const { cron, entries, notifications } = await setup({
        tables: {
          time_entries: [running(1, hoursAgo(40)), running(2, hoursAgo(30))],
          timesheets: [],
        },
      });
      entries.stop
        .mockRejectedValueOnce(timeError('TIMER_NOT_RUNNING'))
        .mockRejectedValueOnce(new Error('connection reset by peer'));
      const r = await cron.run(NOW);
      expect(r.auto_stopped).toBe(0);
      expect(r.errors).toEqual([`auto_stop:${uid(2)}: UNEXPECTED`]);
      expect(notifications.timerAutoStopped).not.toHaveBeenCalled();
    });

    it('takes at most the batch cap per run and reports truncated', async () => {
      const rows = Array.from({ length: TIME_CRON_BATCH + 1 }, (_, i) =>
        running(1000 + i, hoursAgo(30 + i / 100)),
      );
      const { cron, entries } = await setup({
        tables: { time_entries: rows, timesheets: [] },
      });
      const r = await cron.run(NOW);
      expect(entries.stop).toHaveBeenCalledTimes(TIME_CRON_BATCH);
      expect(r.auto_stopped).toBe(TIME_CRON_BATCH);
      expect(r.truncated).toBe(true);
      // Oldest first.
      expect((entries.stop.mock.calls[0] as unknown[])[1]).toBe(
        uid(1000 + TIME_CRON_BATCH),
      );
    });
  });

  describe('job 2: the 10 h notice', () => {
    it('notifies once per entry between 10 h and 24 h, skipping deleted members', async () => {
      const { cron, notifications } = await setup({
        tables: {
          time_entries: [
            running(1, hoursAgo(11)),
            running(2, hoursAgo(9)), // too young
            running(3, hoursAgo(12), { member_user_id: null }),
          ],
          timesheets: [],
        },
      });
      const first = await cron.run(NOW);
      expect(first.long_notified).toBe(1);
      expect(notifications.timerRunningLong).toHaveBeenCalledTimes(1);
      expect(
        (notifications.timerRunningLong.mock.calls[0] as unknown[])[0],
      ).toMatchObject({ id: uid(1), member_user_id: MEMBER });
      expect(notifications.hasNotified).toHaveBeenCalledWith(
        MEMBER,
        'timer_running_long',
        'entry_id',
        uid(1),
      );

      const second = await cron.run(NOW);
      expect(second.long_notified).toBe(0);
      expect(notifications.timerRunningLong).toHaveBeenCalledTimes(1);
    });

    it('a failed probe is an error for that entry only', async () => {
      const { cron, notifications } = await setup({
        tables: {
          time_entries: [running(1, hoursAgo(11)), running(2, hoursAgo(12))],
          timesheets: [],
        },
      });
      notifications.hasNotified.mockRejectedValueOnce(new Error('redis down'));
      const r = await cron.run(NOW);
      expect(r.long_notified).toBe(1);
      expect(r.errors).toEqual([`long_notice:${uid(2)}: UNEXPECTED`]);
    });
  });

  describe('job 3: auto-submit', () => {
    it('submits due auto/self sheets with nothing running; manual routes are never frozen', async () => {
      const AUTO = uid(100);
      const SELF = uid(101);
      const MANUAL = uid(102);
      const RUNNING = uid(103);
      const EMPTY_SHEET = uid(104);
      const { cron, timesheets, db } = await setup({
        tables: {
          timesheets: [
            sheetRow(100),
            sheetRow(101),
            sheetRow(102),
            sheetRow(103),
            sheetRow(104),
          ],
          time_entries: [
            stopped(1, AUTO),
            stopped(2, SELF),
            stopped(3, MANUAL),
            stopped(4, RUNNING),
            running(5, hoursAgo(2), {
              timesheet_id: RUNNING,
              context_kind: 'workspace',
            }),
          ],
        },
        routes: {
          [AUTO]: 'auto',
          [SELF]: 'self',
          [MANUAL]: 'workspace',
          [RUNNING]: 'self',
          [EMPTY_SHEET]: 'self',
        },
      });
      const r = await cron.run(NOW);
      expect(r.auto_submitted).toBe(2);
      const submitted = timesheets.act.mock.calls
        .filter((c) => c[1] === 'auto_submit')
        .map((c) => c[2]);
      expect(submitted).toEqual([[AUTO], [SELF]]);
      for (const c of timesheets.act.mock.calls.filter(
        (x) => x[1] === 'auto_submit',
      )) {
        expect(c).toEqual([null, 'auto_submit', c[2], null]);
      }
      // The pre-filter: one routing preview per candidate that reached it.
      const previews = db.rpc.mock.calls
        .filter((c) => c[0] === 'time_sheet_routing_preview')
        .map((c) => c[1].p_timesheet_id);
      expect(previews).toEqual(expect.arrayContaining([AUTO, SELF, MANUAL]));
      // A sheet without entries never reaches the preview; each sheet is previewed once per run (jobs 3 and 5).
      expect(previews).not.toContain(EMPTY_SHEET);
      expect(new Set(previews).size).toBe(previews.length);
      expect(submitted).not.toContainEqual([RUNNING]);
    });

    it('waits for period_end + max(reminder_days, 1), resolving reminder_days at period start', async () => {
      const notDue = await setup({
        tables: {
          timesheets: [sheetRow(100)],
          time_entries: [stopped(1, uid(100))],
        },
        routes: { [uid(100)]: 'self' },
        reminderDays: 5, // due 2026-09-25
      });
      expect((await notDue.cron.run(NOW)).auto_submitted).toBe(0);
      expect(notDue.policy.resolve).toHaveBeenCalledWith(
        { kind: 'workspace', ref: WS },
        WS,
        new Date('2026-09-14T00:00:00.000Z'),
      );

      const due = await setup({
        tables: {
          timesheets: [sheetRow(100)],
          time_entries: [stopped(1, uid(100))],
        },
        routes: { [uid(100)]: 'self' },
        reminderDays: 0, // max(0, 1) = 1: due 2026-09-21
      });
      expect((await due.cron.run(NOW)).auto_submitted).toBe(1);
    });

    it('a sheet whose period has not ended a day ago is never examined further', async () => {
      const { cron, db, policy } = await setup({
        tables: {
          timesheets: [
            sheetRow(100, {
              period_start: '2026-09-21',
              period_end: '2026-09-27',
            }),
          ],
          time_entries: [stopped(1, uid(100))],
        },
        routes: { [uid(100)]: 'self' },
      });
      expect((await cron.run(NOW)).auto_submitted).toBe(0);
      expect(policy.resolve).not.toHaveBeenCalled();
      expect(db.rpc).not.toHaveBeenCalled();
    });

    it('a race refusal (not_auto, too_early) is skipped, not an error; another failure is an error', async () => {
      const { cron, timesheets } = await setup({
        tables: {
          timesheets: [sheetRow(100), sheetRow(101)],
          time_entries: [stopped(1, uid(100)), stopped(2, uid(101))],
        },
        routes: { [uid(100)]: 'self', [uid(101)]: 'auto' },
      });
      timesheets.act
        .mockRejectedValueOnce(
          timeError('TIMESHEET_TRANSITION_INVALID', undefined, {
            reason: 'not_auto',
          }),
        )
        .mockRejectedValueOnce(
          timeError('STALE_REVISION', undefined, { reason: 'entry_set' }),
        );
      const r = await cron.run(NOW);
      expect(r.auto_submitted).toBe(0);
      expect(r.errors).toEqual([
        `auto_submit:${uid(101)}: STALE_REVISION:entry_set`,
      ]);
    });
  });

  describe('job 4: finish auto/self sheets', () => {
    it('approves undecided submitted auto/self sheets with a NULL actor', async () => {
      const { cron, timesheets } = await setup({
        tables: {
          timesheets: [
            sheetRow(200, {
              status: 'submitted',
              approver_scope: 'auto',
              submitted_at: '2026-09-21T00:00:00.000Z',
            }),
            sheetRow(201, {
              status: 'submitted',
              approver_scope: 'self',
              submitted_at: '2026-09-20T00:00:00.000Z',
            }),
            sheetRow(202, {
              status: 'submitted',
              approver_scope: 'workspace',
              submitted_at: '2026-09-19T00:00:00.000Z',
            }),
          ],
          time_entries: [],
        },
      });
      const r = await cron.run(NOW);
      expect(r.finished).toBe(2);
      const approved = timesheets.act.mock.calls.filter(
        (c) => c[1] === 'approve',
      );
      expect(approved).toEqual([
        [null, 'approve', [uid(201)], null],
        [null, 'approve', [uid(200)], null],
      ]);
      // Idempotent: the approved sheets no longer match.
      expect((await cron.run(NOW)).finished).toBe(0);
    });

    it('a state refusal is skipped', async () => {
      const { cron, timesheets } = await setup({
        tables: {
          timesheets: [
            sheetRow(200, { status: 'submitted', approver_scope: 'auto' }),
          ],
          time_entries: [],
        },
      });
      timesheets.act.mockRejectedValueOnce(
        new ConflictException({
          code: 'TIMESHEET_TRANSITION_INVALID',
          message: 'x',
          reason: 'state',
        }),
      );
      const r = await cron.run(NOW);
      expect(r).toMatchObject({ finished: 0, errors: [] });
    });
  });

  describe('job 5: reminders', () => {
    it('reminds manual-route open and returned sheets once, from period_end + reminder_days', async () => {
      const MANUAL = uid(300);
      const RETURNED = uid(301);
      const AUTO = uid(302);
      const EMPTY_SHEET = uid(303);
      const { cron, notifications } = await setup({
        tables: {
          timesheets: [
            sheetRow(300),
            sheetRow(301, { status: 'returned', approver_scope: 'workspace' }),
            sheetRow(302),
            sheetRow(303),
          ],
          time_entries: [
            stopped(1, MANUAL),
            stopped(2, RETURNED),
            stopped(3, AUTO),
          ],
        },
        routes: {
          [MANUAL]: 'workspace',
          [AUTO]: 'auto',
          [EMPTY_SHEET]: 'team',
        },
        reminderDays: 2,
      });
      // job 3 submits AUTO; job 5 reminds the two manual ones.
      const first = await cron.run(NOW);
      expect(first.reminders).toBe(2);
      expect(notifications.reminder.mock.calls.map((c) => c[0].id)).toEqual([
        MANUAL,
        RETURNED,
      ]);
      expect(notifications.hasNotified).toHaveBeenCalledWith(
        MEMBER,
        'timesheet_reminder',
        'timesheet_id',
        MANUAL,
      );

      const second = await cron.run(NOW);
      expect(second.reminders).toBe(0);
      expect(notifications.reminder).toHaveBeenCalledTimes(2);
    });

    it('reminder_days = 0 never reminds; before period_end + reminder_days waits', async () => {
      const off = await setup({
        tables: {
          timesheets: [sheetRow(300)],
          time_entries: [stopped(1, uid(300))],
        },
        routes: { [uid(300)]: 'workspace' },
        reminderDays: 0,
      });
      expect((await off.cron.run(NOW)).reminders).toBe(0);

      const early = await setup({
        tables: {
          timesheets: [sheetRow(300)],
          time_entries: [stopped(1, uid(300))],
        },
        routes: { [uid(300)]: 'workspace' },
        reminderDays: 4, // from 2026-09-24
      });
      expect((await early.cron.run(NOW)).reminders).toBe(0);
    });

    it('shares the routing preview with job 3 (one RPC per sheet per run)', async () => {
      const { cron, db } = await setup({
        tables: {
          timesheets: [sheetRow(300)],
          time_entries: [stopped(1, uid(300))],
        },
        routes: { [uid(300)]: 'workspace' },
      });
      await cron.run(NOW);
      expect(
        db.rpc.mock.calls.filter((c) => c[0] === 'time_sheet_routing_preview'),
      ).toHaveLength(1);
    });

    it('sheets outside the lookback window are not scanned', async () => {
      const { cron, notifications } = await setup({
        tables: {
          timesheets: [
            sheetRow(300, {
              period_start: '2026-07-27',
              period_end: '2026-08-02',
            }),
          ],
          time_entries: [stopped(1, uid(300))],
        },
        routes: { [uid(300)]: 'workspace' },
      });
      expect((await cron.run(NOW)).reminders).toBe(0);
      expect(notifications.hasNotified).not.toHaveBeenCalled();
    });
  });

  describe('isolation and budget (D52)', () => {
    it('a failing job is reported and the later jobs still run', async () => {
      const { cron, db, notifications } = await setup({
        tables: {
          time_entries: [stopped(1, uid(300))],
          timesheets: [sheetRow(300)],
        },
        routes: { [uid(300)]: 'workspace' },
      });
      // Jobs 1 and 2 read running entries; make their table read fail only for them.
      const realFrom = db.client.from.bind(db.client);
      let calls = 0;
      (db.client as unknown as { from: jest.Mock }).from = jest.fn(
        (table: string) => {
          if (table === 'time_entries' && calls++ < 2) {
            const failing: any = {};
            for (const k of ['select', 'is', 'lte', 'gt', 'order', 'limit']) {
              failing[k] = () => failing;
            }
            failing.then = (ok: (v: unknown) => unknown) =>
              Promise.resolve({
                data: null,
                error: { code: 'XX000', message: 'disk on fire' },
              }).then(ok);
            return failing;
          }
          return realFrom(table);
        },
      );
      const r = await cron.run(NOW);
      expect(r.errors).toEqual([
        'auto_stop: TIME_CRON_DB:XX000',
        'long_notice: TIME_CRON_DB:XX000',
      ]);
      expect(JSON.stringify(r)).not.toContain('disk on fire');
      expect(r.reminders).toBe(1);
      expect(notifications.reminder).toHaveBeenCalledTimes(1);
    });

    it('stops starting new work after the soft budget and reports truncated', async () => {
      let clock = 1_000_000;
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
      try {
        const { cron, entries, timesheets } = await setup({
          tables: {
            time_entries: [running(1, hoursAgo(30)), running(2, hoursAgo(29))],
            timesheets: [
              sheetRow(200, { status: 'submitted', approver_scope: 'auto' }),
            ],
          },
        });
        entries.stop.mockImplementation(() => {
          clock += TIME_CRON_BUDGET_MS + 1;
          return Promise.resolve({ id: '' });
        });
        const r = await cron.run(NOW);
        expect(entries.stop).toHaveBeenCalledTimes(1);
        expect(timesheets.act).not.toHaveBeenCalled();
        expect(r.truncated).toBe(true);
        expect(r.auto_stopped).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('each job gets a fair share of the budget, so a slow job cannot starve the next ones', async () => {
      let clock = 1_000_000;
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
      try {
        const { cron, entries, timesheets } = await setup({
          tables: {
            time_entries: Array.from({ length: 10 }, (_, i) =>
              running(500 + i, hoursAgo(30 + i)),
            ),
            timesheets: [
              sheetRow(200, { status: 'submitted', approver_scope: 'auto' }),
            ],
          },
        });
        // Each stop costs 1.5 s: job 1's share is 20 s / 5 = 4 s, so it stops after 3 timers.
        entries.stop.mockImplementation(() => {
          clock += 1500;
          return Promise.resolve({ id: '' });
        });
        const r = await cron.run(NOW);
        expect(entries.stop).toHaveBeenCalledTimes(3);
        expect(r.truncated).toBe(true);
        // Job 4 still ran.
        expect(timesheets.act).toHaveBeenCalledWith(
          null,
          'approve',
          [uid(200)],
          null,
        );
        expect(r.finished).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
