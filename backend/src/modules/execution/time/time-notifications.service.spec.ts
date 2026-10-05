import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { renderNotificationEmail } from '../../shared/notifications/email/notification-email-registry';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { buildPushMessage } from '../../shared/push/notification-push';
import { teamManagerIds } from '../teams/team-authority';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  NOTIFIED_MARKER_TTL_SECONDS,
  TIME_PAYOUT_MESSAGE,
  type TimeNotificationType,
  TimeNotificationsService,
  buildTimeContent,
  formatDurationLabel,
  formatPeriodLabel,
} from './time-notifications.service';
import type { CommentRow, EntryAuthRow, TimesheetRow } from './time.types';

jest.mock('../teams/team-authority', () => ({
  teamManagerIds: jest.fn(),
}));
const mockTeamManagerIds = teamManagerIds as jest.MockedFunction<
  typeof teamManagerIds
>;

// ── fixtures ────────────────────────────────────────────────────────────────

const MEMBER = 'u-maria';
const DECIDER_A = 'u-ana';
const DECIDER_B = 'u-ben';
const TOMBSTONE = 'u-gone';
const REVIEWER = 'u-rita';
const MANAGER = 'u-mo';

const NAMES: Record<string, string> = {
  [MEMBER]: 'Maria',
  [DECIDER_A]: 'Ana',
  [DECIDER_B]: 'Ben',
  [REVIEWER]: 'Rita',
  [MANAGER]: 'Mo',
};

function sheet(over: Partial<TimesheetRow> = {}): TimesheetRow {
  return {
    id: 'sheet-1',
    member_user_id: MEMBER,
    member_display_name_snapshot: 'Maria Snapshot',
    scope_kind: 'team',
    scope_ref: 'team-1',
    team_id: 'team-1',
    workspace_id: null,
    engagement_id: null,
    scope_label_snapshot: 'Acme Team',
    policy_workspace_id: 'ws-1',
    period_kind: 'weekly',
    period_start: '2026-09-22',
    period_end: '2026-09-28',
    timezone: 'Asia/Manila',
    week_start: 1,
    status: 'submitted',
    approver_scope: 'team',
    revision: 2,
    submitted_at: '2026-09-29T01:00:00Z',
    submitted_by: MEMBER,
    submission_kind: 'manual',
    decided_at: null,
    decided_by: null,
    decision_kind: null,
    decision_note: null,
    overtime_approved: false,
    total_seconds: 137700, // 38h 15m
    payable_seconds: null,
    origin: 'app',
    created_at: '2026-09-22T00:00:00Z',
    updated_at: '2026-09-29T01:00:00Z',
    ...over,
  };
}

function entry(over: Partial<EntryAuthRow> = {}): EntryAuthRow {
  return {
    id: 'entry-1',
    member_user_id: MEMBER,
    project_id: 'project-1',
    context_kind: 'team',
    context_ref: 'team-1',
    team_id: 'team-1',
    workspace_id: null,
    engagement_assignment_id: null,
    timesheet_id: 'sheet-1',
    started_at: '2026-09-23T01:00:00Z',
    ...over,
  };
}

function comment(over: Partial<CommentRow> = {}): CommentRow {
  return {
    id: 'comment-1',
    entry_id: 'entry-1',
    author_user_id: DECIDER_A,
    body: 'Split Thursday into two entries',
    created_at: '2026-09-29T02:00:00Z',
    updated_at: '2026-09-29T02:00:00Z',
    author: null,
    ...over,
  };
}

// ── doubles ─────────────────────────────────────────────────────────────────

type Op = [string, ...unknown[]];
interface Reply {
  data: unknown;
  error: { message: string } | null;
}

interface World {
  tombstones: Set<string>;
  reviewer: string | null;
  /** can_view_timesheet(sheet, legacy reviewer). */
  reviewerCanView: boolean;
  deciders: string[];
  existing: boolean;
  profilesError: boolean;
  decidersError: boolean;
  probeError: boolean;
}

function fakeSupabase(world: World) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const reply = (table: string, ops: Op[]): Reply => {
    const arg = (name: string) => ops.find((op) => op[0] === name);
    switch (table) {
      case 'profiles': {
        if (world.profilesError)
          return { data: null, error: { message: 'boom' } };
        const ids = (arg('in')?.[2] as string[]) ?? [];
        return {
          data: ids
            .filter((id) => !world.tombstones.has(id))
            .map((id) => ({ id })),
          error: null,
        };
      }
      case 'time_entries':
        return {
          data: { legacy_reviewed_by: world.reviewer },
          error: null,
        };
      case 'notification_types':
        return {
          data: { id: `type:${String(arg('eq')?.[2])}` },
          error: null,
        };
      case 'notifications':
        if (world.probeError)
          return { data: null, error: { message: 'probe boom' } };
        return { data: world.existing ? [{ id: 'n-old' }] : [], error: null };
      default:
        return { data: null, error: { message: `unexpected ${table}` } };
    }
  };
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'is', 'limit', 'order']) {
      builder[method] = (...args: unknown[]) => {
        ops.push([method, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(reply(table, ops));
    builder.then = (
      resolve: (value: Reply) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(reply(table, ops)).then(resolve, reject);
    return builder;
  };
  const rpc = jest.fn((name: string) =>
    Promise.resolve(
      name === 'time_timesheet_deciders' && !world.decidersError
        ? { data: world.deciders, error: null }
        : name === 'can_view_timesheet'
          ? { data: world.reviewerCanView, error: null }
          : { data: null, error: { message: 'rpc boom' } },
    ),
  );
  return { sb: { from, rpc }, calls, rpc };
}

/** An Upstash stand-in for the notify-once markers. `failing` rejects every call. */
function fakeRedis(failing = false) {
  const store = new Map<string, string>();
  const down = () => Promise.reject(new Error('redis down'));
  return {
    store,
    get: jest.fn((key: string) =>
      failing ? down() : Promise.resolve(store.get(key) ?? null),
    ),
    set: jest.fn((key: string, value: string) => {
      if (failing) return down();
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((key: string) => {
      if (failing) return down();
      return Promise.resolve(store.delete(key) ? 1 : 0);
    }),
  };
}
type FakeRedis = ReturnType<typeof fakeRedis>;

interface Sent {
  user_id: string;
  type_name: string;
  actor_id?: string;
  project_id?: string;
  content: Record<string, unknown>;
  link_url: string;
}

async function setup(over: Partial<World> = {}, o: { redis?: FakeRedis } = {}) {
  const world: World = {
    tombstones: new Set([TOMBSTONE]),
    reviewer: null,
    reviewerCanView: true,
    deciders: [DECIDER_A, DECIDER_B],
    existing: false,
    profilesError: false,
    decidersError: false,
    probeError: false,
    ...over,
  };
  const { sb, calls, rpc } = fakeSupabase(world);
  const order: string[] = [];
  const notifications = {
    createNotification: jest.fn((payload: Sent) => {
      order.push(`create:${payload.type_name}:${payload.user_id}`);
      return Promise.resolve({ id: 'n-new' });
    }),
    clearForSubject: jest.fn(
      (userId: string, type: string, key: string, value: string) => {
        order.push(`clear:${type}:${userId}:${key}=${value}`);
        return Promise.resolve(0);
      },
    ),
    resolveActorName: jest.fn((id: string | null) =>
      Promise.resolve(id ? (NAMES[id] ?? null) : null),
    ),
  };
  const workspaces = {
    findSlugForTeam: jest.fn(() => Promise.resolve('acme')),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeNotificationsService,
      { provide: SUPABASE_ADMIN, useValue: sb },
      { provide: NotificationsService, useValue: notifications },
      { provide: WorkspacesService, useValue: workspaces },
      ...(o.redis
        ? [{ provide: UPSTASH_REDIS_CLIENT, useValue: o.redis }]
        : []),
    ],
  }).compile();

  const service = moduleRef.get(TimeNotificationsService);
  const sent = () =>
    notifications.createNotification.mock.calls.map(([payload]) => payload);
  const cleared = () =>
    notifications.clearForSubject.mock.calls.map(
      ([userId, type, key, value]) => ({ userId, type, key, value }),
    );
  return {
    service,
    notifications,
    workspaces,
    calls,
    rpc,
    order,
    sent,
    cleared,
    world,
  };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  mockTeamManagerIds.mockReset();
  mockTeamManagerIds.mockResolvedValue([]);
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

// ── pure helpers ────────────────────────────────────────────────────────────

describe('formatPeriodLabel', () => {
  it.each([
    ['2026-09-22', '2026-09-28', 'Sep 22–28'],
    ['2026-09-29', '2026-10-05', 'Sep 29 – Oct 5'],
    ['2025-12-29', '2026-01-04', 'Dec 29, 2025 – Jan 4, 2026'],
    ['2026-09-01', '2026-09-30', 'Sep 1–30'],
    ['2026-09-22', '2026-09-22', 'Sep 22'],
    ['bad', 'worse', 'bad – worse'],
  ])('%s .. %s → %s', (start, end, label) => {
    expect(formatPeriodLabel(start, end)).toBe(label);
  });
});

describe('formatDurationLabel', () => {
  it.each([
    [137700, '38h 15m'],
    [3600, '1h'],
    [2700, '45m'],
    [59, '1m'],
    [0, '0m'],
    [null, null],
    [-5, null],
  ])('%s → %s', (seconds, label) => {
    expect(formatDurationLabel(seconds)).toBe(label);
  });
});

// ── L43 / CHANGE-19: no money anywhere ─────────────────────────────────────

describe('no amount or currency in any time notification (L43)', () => {
  const ALL_TYPES: TimeNotificationType[] = [
    'timesheet_submitted',
    'timesheet_returned',
    'timesheet_approved',
    'timesheet_reopened',
    'timesheet_reopen_requested',
    'timesheet_reminder',
    'timer_running_long',
    'timer_auto_stopped',
    'time_payout_recorded',
    'time_log_comment_added',
  ];
  const EMAIL_TYPES = new Set<string>([
    'timesheet_submitted',
    'timesheet_returned',
    'timesheet_reminder',
    'time_payout_recorded',
  ]);

  // Money-shaped values smuggled into the inputs: none may surface.
  const moneySheet = {
    ...sheet({
      status: 'returned',
      decision_note: 'Split Thursday into two entries',
      payable_seconds: 136800,
    }),
    amount_snapshot: 4321.99,
    rate_snapshot: 87.65,
    currency_snapshot: 'USD',
  } as TimesheetRow;

  const PERIOD = formatPeriodLabel('2026-09-22', '2026-09-28');
  /** Hours, dates and fixed durations are allowed digits; strip them, then demand none remain. */
  const withoutAllowedNumbers = (text: string) =>
    text
      .split(PERIOD)
      .join(' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b\d+h(?: \d+m)?\b/g, ' ')
      .replace(/\b\d+m\b/g, ' ')
      .replace(/\b\d+ hours\b/g, ' ');
  const CURRENCY = /\b[A-Z]{3}\b|[$€£¥₱]/;

  const contentFor = (type: TimeNotificationType) =>
    buildTimeContent(type, {
      sheet: moneySheet,
      entryId: 'entry-1',
      reason: 'auto_stopped_24h',
      payoutId: 'payout-1',
      entryCount: 3,
      actorName: 'Ana',
      snippet: 'Split Thursday into two entries',
    });

  it.each(ALL_TYPES)('%s: message, push body and email', (type) => {
    const content = contentFor(type);
    const message = content.message as string;

    expect(typeof message).toBe('string');
    expect(withoutAllowedNumbers(message)).not.toMatch(/\d/);
    expect(message).not.toMatch(CURRENCY);
    expect(message).not.toContain('4321');
    for (const key of Object.keys(content)) {
      expect(key).not.toMatch(/amount|rate|currency|cost|price|fee/);
    }

    const push = buildPushMessage({
      notificationId: 'n-1',
      typeName: type,
      content,
      linkUrl: '/time',
    });
    expect(withoutAllowedNumbers(push.body)).not.toMatch(/\d/);
    expect(push.body).not.toMatch(CURRENCY);
    expect(push.title).not.toBe('Proyekto');
    expect(Object.values(push.data ?? {}).join(' ')).not.toContain('4321');

    const email = renderNotificationEmail(type, {
      content,
      linkUrl: '/time/timesheets/sheet-1',
      appUrl: 'https://www.proyekto.test',
      unsubscribeUrl: null,
      recipientName: 'Maria',
    });
    if (!EMAIL_TYPES.has(type)) {
      expect(email).toBeNull();
      return;
    }
    expect(email).not.toBeNull();
    expect(withoutAllowedNumbers(email!.subject)).not.toMatch(/\d/);
    expect(withoutAllowedNumbers(email!.text)).not.toMatch(/\d/);
    for (const part of [email!.subject, email!.html, email!.text]) {
      expect(part).not.toContain('4321');
      expect(part).not.toContain('87.65');
      expect(part).not.toMatch(/\bUSD\b|[$€£¥₱]/);
    }
  });

  it('the payout message is the fixed sentence, and content is {payout_id, entry_count}', () => {
    expect(contentFor('time_payout_recorded')).toEqual({
      payout_id: 'payout-1',
      entry_count: 3,
      message: TIME_PAYOUT_MESSAGE,
    });
    expect(TIME_PAYOUT_MESSAGE).toBe('A payment was recorded for your time');
  });
});

// ── content and copy ────────────────────────────────────────────────────────

describe('buildTimeContent', () => {
  it('sheet types carry exactly the agreed keys, plus presentation-only prose', () => {
    expect(
      buildTimeContent('timesheet_submitted', {
        sheet: sheet(),
        actorName: 'Maria',
      }),
    ).toEqual({
      timesheet_id: 'sheet-1',
      scope_kind: 'team',
      team_id: 'team-1',
      period_start: '2026-09-22',
      period_end: '2026-09-28',
      total_seconds: 137700,
      actor_name: 'Maria',
      context_title: 'Acme Team',
      message: 'Maria sent 38h 15m for Acme Team · Sep 22–28',
    });
  });

  it('includes workspace_id only when the sheet has one', () => {
    const content = buildTimeContent('timesheet_reminder', {
      sheet: sheet({
        scope_kind: 'workspace',
        team_id: null,
        workspace_id: 'ws-1',
      }),
    });
    expect(content.workspace_id).toBe('ws-1');
    expect(content).not.toHaveProperty('team_id');
  });

  it.each<[TimeNotificationType, Partial<TimesheetRow>, string | null, string]>(
    [
      [
        'timesheet_returned',
        { status: 'returned', decision_note: 'Split Thursday' },
        'Ana',
        'Ana returned Sep 22–28 for Acme Team: "Split Thursday"',
      ],
      [
        'timesheet_approved',
        { status: 'approved', payable_seconds: 136800 },
        'Ana',
        'Ana approved Sep 22–28 for Acme Team (38h)',
      ],
      [
        'timesheet_approved',
        { status: 'approved', decision_kind: 'auto' },
        null,
        'Your Acme Team timesheet for Sep 22–28 was approved (38h 15m)',
      ],
      [
        'timesheet_reopened',
        { status: 'returned', decision_note: 'Wrong project' },
        'Ana',
        'Ana reopened Sep 22–28 for Acme Team: "Wrong project"',
      ],
      [
        'timesheet_reopen_requested',
        { status: 'approved' },
        'Maria',
        'Maria asked to reopen Sep 22–28 for Acme Team',
      ],
      [
        'timesheet_reminder',
        { status: 'open', total_seconds: null },
        null,
        'Your Acme Team timesheet for Sep 22–28 is ready to submit',
      ],
      [
        'timesheet_reminder',
        { status: 'returned' },
        null,
        'Your Acme Team timesheet for Sep 22–28 is waiting for your changes',
      ],
      [
        'timesheet_submitted',
        {
          submission_kind: 'on_deletion',
          member_display_name_snapshot: 'Deleted user',
        },
        null,
        'The timesheet for Sep 22–28 (Acme Team) was sent for review when the account that logged it was deleted',
      ],
      [
        'timesheet_submitted',
        { total_seconds: null },
        null,
        'Maria Snapshot sent a timesheet for Acme Team · Sep 22–28',
      ],
    ],
  )('%s %#', (type, over, actorName, message) => {
    expect(
      buildTimeContent(type, { sheet: sheet(over), actorName }).message,
    ).toBe(message);
  });

  it('cuts a long note to 140 characters', () => {
    const message = buildTimeContent('timesheet_returned', {
      sheet: sheet({ decision_note: 'x'.repeat(400) }),
      actorName: 'Ana',
    }).message as string;
    const quoted = /"(.*)"$/.exec(message)?.[1] ?? '';
    expect(quoted).toHaveLength(140);
    expect(quoted.endsWith('...')).toBe(true);
  });

  it('timer types', () => {
    expect(
      buildTimeContent('timer_running_long', { entryId: 'entry-1' }),
    ).toEqual({
      entry_id: 'entry-1',
      message:
        "Your timer has been running for over 10 hours. Stop it if you're done.",
    });
    expect(
      buildTimeContent('timer_auto_stopped', {
        entryId: 'entry-1',
        reason: 'auto_stopped_24h',
      }),
    ).toEqual({
      entry_id: 'entry-1',
      reason: 'auto_stopped_24h',
      message: 'Your timer was stopped after 24 hours. Check the end time.',
    });
    expect(
      buildTimeContent('timer_auto_stopped', {
        entryId: 'entry-1',
        reason: 'stopped_by_assignment_end',
      }).message,
    ).toBe(
      'Your timer was stopped because the assignment it was logging to ended. Check the end time.',
    );
  });

  it('comments quote a snippet and degrade without an actor', () => {
    expect(
      buildTimeContent('time_log_comment_added', {
        entryId: 'entry-1',
        actorName: 'Ana',
        snippet: '  Split   Thursday ',
      }),
    ).toEqual({
      entry_id: 'entry-1',
      actor_name: 'Ana',
      message: 'Ana commented on a time entry: "Split Thursday"',
    });
    expect(
      buildTimeContent('time_log_comment_added', { entryId: 'entry-1' })
        .message,
    ).toBe('Someone commented on a time entry');
  });

  it('a sheet type without a sheet still yields a sentence', () => {
    expect(buildTimeContent('timesheet_approved', {})).toEqual({
      message: 'Your timesheet was approved',
    });
  });
});

// ── fan-out ─────────────────────────────────────────────────────────────────

describe('TimeNotificationsService', () => {
  describe('sheetSubmitted', () => {
    it('sends one row per decider, skipping the actor, the member and tombstones', async () => {
      const t = await setup();
      await t.service.sheetSubmitted(
        sheet(),
        [DECIDER_A, DECIDER_B, TOMBSTONE, MEMBER, DECIDER_A],
        MEMBER,
      );

      const sent = t.sent();
      expect(sent.map((n) => n.user_id).sort()).toEqual([DECIDER_A, DECIDER_B]);
      for (const n of sent) {
        expect(n).toMatchObject({
          type_name: 'timesheet_submitted',
          actor_id: MEMBER,
          link_url: '/time/timesheets/sheet-1',
        });
        expect(n).not.toHaveProperty('project_id');
        expect(n.content.message).toBe(
          'Maria sent 38h 15m for Acme Team · Sep 22–28',
        );
      }
    });

    it('replaces an older row for the same sheet and clears the member reminder', async () => {
      const t = await setup({ deciders: [] });
      await t.service.sheetSubmitted(sheet(), [DECIDER_A], MEMBER);

      expect(t.cleared()).toEqual(
        expect.arrayContaining([
          {
            userId: DECIDER_A,
            type: 'timesheet_submitted',
            key: 'timesheet_id',
            value: 'sheet-1',
          },
          {
            userId: MEMBER,
            type: 'timesheet_reminder',
            key: 'timesheet_id',
            value: 'sheet-1',
          },
        ]),
      );
      const clearAt = t.order.indexOf(
        `clear:timesheet_submitted:${DECIDER_A}:timesheet_id=sheet-1`,
      );
      expect(clearAt).toBeGreaterThanOrEqual(0);
      expect(clearAt).toBeLessThan(
        t.order.indexOf(`create:timesheet_submitted:${DECIDER_A}`),
      );
    });

    it('an on_deletion submit has no actor and names nobody', async () => {
      const t = await setup();
      await t.service.sheetSubmitted(
        sheet({ submission_kind: 'on_deletion', submitted_by: null }),
        [DECIDER_A],
        null,
      );
      const [n] = t.sent();
      expect(n.actor_id).toBeUndefined();
      expect(n.content.message).toContain(
        'when the account that logged it was deleted',
      );
      expect(t.notifications.resolveActorName).not.toHaveBeenCalled();
    });
  });

  describe('sheetDecided', () => {
    it('approve clears every decider’s submitted row and tells the member', async () => {
      const t = await setup();
      await t.service.sheetDecided(
        sheet({
          status: 'approved',
          payable_seconds: 137700,
          decision_kind: 'manual',
        }),
        'approve',
        DECIDER_A,
        [DECIDER_A, DECIDER_B],
      );

      expect(
        t
          .cleared()
          .filter((c) => c.type === 'timesheet_submitted')
          .map((c) => c.userId)
          .sort(),
      ).toEqual([DECIDER_A, DECIDER_B]);
      expect(t.sent()).toEqual([
        expect.objectContaining({
          user_id: MEMBER,
          type_name: 'timesheet_approved',
          actor_id: DECIDER_A,
          link_url: '/time/timesheets/sheet-1',
          content: expect.objectContaining({
            message: 'Ana approved Sep 22–28 for Acme Team (38h 15m)',
          }),
        }),
      ]);
    });

    it('clears for the actor even when the caller’s decider list is empty', async () => {
      const t = await setup();
      await t.service.sheetDecided(sheet(), 'approve', DECIDER_A, []);
      expect(t.cleared()).toContainEqual({
        userId: DECIDER_A,
        type: 'timesheet_submitted',
        key: 'timesheet_id',
        value: 'sheet-1',
      });
    });

    it('a self-approved sheet does not notify the member', async () => {
      const t = await setup();
      await t.service.sheetDecided(
        sheet({
          status: 'approved',
          approver_scope: 'self',
          decision_kind: 'self',
        }),
        'approve',
        null,
        [],
      );
      expect(t.notifications.createNotification).not.toHaveBeenCalled();
    });

    it('an auto approval (no actor) still tells the member', async () => {
      const t = await setup();
      await t.service.sheetDecided(
        sheet({
          status: 'approved',
          approver_scope: 'auto',
          decision_kind: 'auto',
        }),
        'approve',
        null,
        [],
      );
      const [n] = t.sent();
      expect(n.user_id).toBe(MEMBER);
      expect(n.actor_id).toBeUndefined();
      expect(n.content.message).toBe(
        'Your Acme Team timesheet for Sep 22–28 was approved (38h 15m)',
      );
    });

    it('return replaces the member’s older return notice and quotes the note', async () => {
      const t = await setup();
      await t.service.sheetDecided(
        sheet({ status: 'returned', decision_note: 'Split Thursday' }),
        'return',
        DECIDER_A,
        [DECIDER_A, DECIDER_B],
      );

      const clearAt = t.order.indexOf(
        `clear:timesheet_returned:${MEMBER}:timesheet_id=sheet-1`,
      );
      expect(clearAt).toBeGreaterThanOrEqual(0);
      expect(clearAt).toBeLessThan(
        t.order.indexOf(`create:timesheet_returned:${MEMBER}`),
      );
      expect(
        t.cleared().filter((c) => c.type === 'timesheet_submitted'),
      ).toHaveLength(2);
      expect(t.sent()).toEqual([
        expect.objectContaining({
          user_id: MEMBER,
          type_name: 'timesheet_returned',
          content: expect.objectContaining({
            message: 'Ana returned Sep 22–28 for Acme Team: "Split Thursday"',
          }),
        }),
      ]);
    });

    it('withdraw only clears the deciders’ rows', async () => {
      const t = await setup();
      await t.service.sheetDecided(
        sheet({ status: 'open' }),
        'withdraw',
        MEMBER,
        [DECIDER_A, DECIDER_B],
      );
      expect(t.notifications.createNotification).not.toHaveBeenCalled();
      expect(
        t
          .cleared()
          .filter((c) => c.type === 'timesheet_submitted')
          .map((c) => c.userId)
          .sort(),
      ).toEqual([DECIDER_A, DECIDER_B, MEMBER].sort());
    });

    it('reopen clears the reopen requests and tells the member, unless the member reopened', async () => {
      const t = await setup();
      await t.service.sheetDecided(
        sheet({ status: 'returned', decision_note: 'Wrong project' }),
        'reopen',
        DECIDER_A,
        [DECIDER_A, DECIDER_B],
      );
      expect(
        t
          .cleared()
          .filter((c) => c.type === 'timesheet_reopen_requested')
          .map((c) => c.userId)
          .sort(),
      ).toEqual([DECIDER_A, DECIDER_B]);
      expect(t.sent().map((n) => [n.user_id, n.type_name])).toEqual([
        [MEMBER, 'timesheet_reopened'],
      ]);

      const own = await setup();
      await own.service.sheetDecided(
        sheet({ status: 'open', approver_scope: 'self' }),
        'reopen',
        MEMBER,
        [],
      );
      expect(own.notifications.createNotification).not.toHaveBeenCalled();
    });

    it('a tombstoned member gets nothing', async () => {
      const t = await setup({ tombstones: new Set([MEMBER]) });
      await t.service.sheetDecided(
        sheet({ status: 'returned', decision_note: 'x' }),
        'return',
        DECIDER_A,
        [DECIDER_A],
      );
      expect(t.notifications.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('reopenRequested', () => {
    it('goes to the deciders, minus the actor and tombstones, one live row each', async () => {
      const t = await setup();
      await t.service.reopenRequested(
        sheet({ status: 'approved' }),
        [DECIDER_A, TOMBSTONE, MEMBER],
        MEMBER,
      );
      expect(t.sent()).toEqual([
        expect.objectContaining({
          user_id: DECIDER_A,
          type_name: 'timesheet_reopen_requested',
          actor_id: MEMBER,
          link_url: '/time/timesheets/sheet-1',
          content: expect.objectContaining({
            message: 'Maria asked to reopen Sep 22–28 for Acme Team',
          }),
        }),
      ]);
      expect(t.cleared()).toEqual([
        {
          userId: DECIDER_A,
          type: 'timesheet_reopen_requested',
          key: 'timesheet_id',
          value: 'sheet-1',
        },
      ]);
    });
  });

  describe('reminder', () => {
    it('goes to the member with the sheet link', async () => {
      const t = await setup();
      await t.service.reminder(sheet({ status: 'open' }));
      expect(t.sent()).toEqual([
        expect.objectContaining({
          user_id: MEMBER,
          type_name: 'timesheet_reminder',
          link_url: '/time/timesheets/sheet-1',
        }),
      ]);
    });

    it('skips a tombstoned member', async () => {
      const t = await setup({ tombstones: new Set([MEMBER]) });
      await t.service.reminder(sheet({ status: 'open' }));
      expect(t.notifications.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('timer notifications (D29 links)', () => {
    const teamEntry = {
      id: 'entry-1',
      member_user_id: MEMBER,
      context_kind: 'team' as const,
      team_id: 'team-1',
      started_at: '2026-09-23T01:00:00Z',
    };

    it('a team-context entry keeps the team page link', async () => {
      const t = await setup();
      await t.service.timerRunningLong(teamEntry);
      expect(t.sent()).toEqual([
        expect.objectContaining({
          user_id: MEMBER,
          type_name: 'timer_running_long',
          content: expect.objectContaining({ entry_id: 'entry-1' }),
          link_url: '/w/acme/teams/team-1/time/my-logs?log=entry-1',
        }),
      ]);
    });

    it('any other context links to /time?entry=', async () => {
      const t = await setup();
      await t.service.timerRunningLong({
        ...teamEntry,
        context_kind: 'personal',
        team_id: null,
      });
      expect(t.sent()[0].link_url).toBe('/time?entry=entry-1');
      expect(t.workspaces.findSlugForTeam).not.toHaveBeenCalled();
    });

    it('falls back to the bare team path when the slug lookup fails', async () => {
      const t = await setup();
      t.workspaces.findSlugForTeam.mockRejectedValueOnce(new Error('db'));
      await t.service.timerRunningLong(teamEntry);
      expect(t.sent()[0].link_url).toBe(
        '/teams/team-1/time/my-logs?log=entry-1',
      );
    });

    it('auto-stop carries {entry_id, reason} and clears the running-long notice', async () => {
      const t = await setup();
      await t.service.timerAutoStopped(
        { ...teamEntry, context_kind: 'assignment', team_id: null },
        'stopped_by_assignment_end',
      );
      expect(t.sent()).toEqual([
        expect.objectContaining({
          type_name: 'timer_auto_stopped',
          content: expect.objectContaining({
            entry_id: 'entry-1',
            reason: 'stopped_by_assignment_end',
          }),
          link_url: '/time?entry=entry-1',
        }),
      ]);
      expect(t.cleared()).toEqual([
        {
          userId: MEMBER,
          type: 'timer_running_long',
          key: 'entry_id',
          value: 'entry-1',
        },
      ]);
    });

    it('timerStopped clears the running-long notice only', async () => {
      const t = await setup();
      await t.service.timerStopped({ id: 'entry-1', member_user_id: MEMBER });
      expect(t.notifications.createNotification).not.toHaveBeenCalled();
      expect(t.cleared()).toEqual([
        {
          userId: MEMBER,
          type: 'timer_running_long',
          key: 'entry_id',
          value: 'entry-1',
        },
      ]);
    });
  });

  describe('payoutRecorded', () => {
    it('tells the member with no amount, linking their team time page', async () => {
      const t = await setup();
      const payout = {
        id: 'payout-1',
        member_user_id: MEMBER,
        team_id: 'team-1',
        total_amount: 4321.99,
        currency: 'USD',
      };
      await t.service.payoutRecorded(payout, 3, DECIDER_A);
      expect(t.sent()).toEqual([
        {
          user_id: MEMBER,
          type_name: 'time_payout_recorded',
          actor_id: DECIDER_A,
          content: {
            payout_id: 'payout-1',
            entry_count: 3,
            message: 'A payment was recorded for your time',
          },
          link_url: '/w/acme/teams/team-1/time/my-logs',
        },
      ]);
    });

    it('never notifies a member who recorded their own payout', async () => {
      const t = await setup();
      await t.service.payoutRecorded(
        { id: 'payout-1', member_user_id: MEMBER, team_id: 'team-1' },
        3,
        MEMBER,
      );
      expect(t.notifications.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('commentAdded', () => {
    it('member + sheet deciders + legacy reviewer + team managers, minus actor and tombstones', async () => {
      const t = await setup({
        deciders: [DECIDER_A, DECIDER_B, TOMBSTONE],
        reviewer: REVIEWER,
      });
      mockTeamManagerIds.mockResolvedValue([MANAGER, DECIDER_B]);
      await t.service.commentAdded(entry(), comment(), DECIDER_A);

      expect(t.rpc).toHaveBeenCalledWith('time_timesheet_deciders', {
        p_timesheet_id: 'sheet-1',
      });
      expect(t.rpc).toHaveBeenCalledWith('can_view_timesheet', {
        p_timesheet_id: 'sheet-1',
        p_user_id: REVIEWER,
      });
      const byUser = new Map(t.sent().map((n) => [n.user_id, n]));
      expect([...byUser.keys()].sort()).toEqual(
        [MEMBER, DECIDER_B, REVIEWER, MANAGER].sort(),
      );
      expect(t.sent()).toHaveLength(4);
      expect(byUser.get(MEMBER)?.link_url).toBe(
        '/w/acme/teams/team-1/time/my-logs?log=entry-1',
      );
      expect(byUser.get(DECIDER_B)?.link_url).toBe(
        '/w/acme/teams/team-1/time/team-logs?log=entry-1',
      );
      expect(byUser.get(MEMBER)?.content).toEqual({
        entry_id: 'entry-1',
        comment_id: 'comment-1',
        actor_name: 'Ana',
        message:
          'Ana commented on a time entry: "Split Thursday into two entries"',
      });
      expect(byUser.get(MEMBER)?.actor_id).toBe(DECIDER_A);
    });

    it('a personal entry notifies the member only, and never the commenting member', async () => {
      const t = await setup({ reviewer: REVIEWER });
      const personal = entry({
        context_kind: 'personal',
        context_ref: null,
        team_id: null,
        timesheet_id: null,
      });
      await t.service.commentAdded(personal, comment(), DECIDER_A);
      expect(t.sent().map((n) => [n.user_id, n.link_url])).toEqual([
        [MEMBER, '/time?entry=entry-1'],
      ]);
      expect(t.rpc).not.toHaveBeenCalled();
      expect(mockTeamManagerIds).not.toHaveBeenCalled();

      const own = await setup();
      await own.service.commentAdded(personal, comment(), MEMBER);
      expect(own.notifications.createNotification).not.toHaveBeenCalled();
    });

    it('an assignment entry asks no team for managers and links to /time', async () => {
      const t = await setup({ deciders: [DECIDER_B] });
      await t.service.commentAdded(
        entry({
          context_kind: 'assignment',
          context_ref: 'asg-1',
          team_id: null,
          engagement_assignment_id: 'asg-1',
        }),
        comment(),
        MEMBER,
      );
      expect(mockTeamManagerIds).not.toHaveBeenCalled();
      expect(t.sent().map((n) => [n.user_id, n.link_url])).toEqual([
        [DECIDER_B, '/time?entry=entry-1'],
      ]);
    });

    it('a legacy reviewer who can no longer open the sheet gets no comment text (W1 review Q4)', async () => {
      const t = await setup({
        deciders: [DECIDER_B],
        reviewer: REVIEWER,
        reviewerCanView: false,
      });
      await t.service.commentAdded(entry(), comment(), DECIDER_A);
      expect(
        t
          .sent()
          .map((n) => n.user_id)
          .sort(),
      ).toEqual([MEMBER, DECIDER_B].sort());
      expect(t.rpc).toHaveBeenCalledWith('can_view_timesheet', {
        p_timesheet_id: 'sheet-1',
        p_user_id: REVIEWER,
      });
    });

    it('a sheetless entry looks up no legacy reviewer', async () => {
      const t = await setup({ deciders: [], reviewer: REVIEWER });
      await t.service.commentAdded(
        entry({ timesheet_id: null }),
        comment(),
        DECIDER_A,
      );
      expect(t.calls.some((c) => c.table === 'time_entries')).toBe(false);
      expect(t.sent().map((n) => n.user_id)).toEqual([MEMBER]);
    });

    it('a failed decider lookup still notifies everyone else', async () => {
      const t = await setup({ decidersError: true });
      await t.service.commentAdded(entry(), comment(), DECIDER_A);
      expect(t.sent().map((n) => n.user_id)).toEqual([MEMBER]);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('D51: a notification never fails the caller', () => {
    it('one failed insert does not stop the others, and the method resolves', async () => {
      const t = await setup();
      t.notifications.createNotification.mockImplementation((p: Sent) =>
        p.user_id === DECIDER_A
          ? Promise.reject(new Error('Unknown notification type'))
          : Promise.resolve({ id: 'n' }),
      );
      await expect(
        t.service.sheetSubmitted(sheet(), [DECIDER_A, DECIDER_B], MEMBER),
      ).resolves.toBeUndefined();
      expect(t.notifications.createNotification).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('time_notify_send_failed'),
      );
    });

    it('a failed profiles read drops the fan-out with a warning, but still clears', async () => {
      const t = await setup({ profilesError: true });
      await expect(
        t.service.sheetDecided(sheet(), 'approve', DECIDER_A, [DECIDER_A]),
      ).resolves.toBeUndefined();
      expect(t.notifications.createNotification).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('time_notify_failed op=timesheet_approve'),
      );
      expect(t.cleared()).toEqual([
        {
          userId: DECIDER_A,
          type: 'timesheet_submitted',
          key: 'timesheet_id',
          value: 'sheet-1',
        },
      ]);

      const submitted = await setup({ profilesError: true });
      await submitted.service.sheetSubmitted(sheet(), [DECIDER_A], MEMBER);
      expect(submitted.cleared()).toEqual([
        {
          userId: MEMBER,
          type: 'timesheet_reminder',
          key: 'timesheet_id',
          value: 'sheet-1',
        },
      ]);
    });

    it('a throwing clear is swallowed', async () => {
      const t = await setup();
      t.notifications.clearForSubject.mockRejectedValue(new Error('gone'));
      await expect(
        t.service.sheetDecided(sheet(), 'withdraw', MEMBER, [DECIDER_A]),
      ).resolves.toBeUndefined();
    });

    it('every public sender resolves even when every collaborator throws', async () => {
      const t = await setup();
      t.notifications.createNotification.mockRejectedValue(new Error('x'));
      t.notifications.clearForSubject.mockRejectedValue(new Error('x'));
      t.notifications.resolveActorName.mockRejectedValue(new Error('x'));
      t.workspaces.findSlugForTeam.mockRejectedValue(new Error('x'));
      mockTeamManagerIds.mockRejectedValue(new Error('x'));
      const s = sheet();
      const e = {
        id: 'entry-1',
        member_user_id: MEMBER,
        context_kind: 'team' as const,
        team_id: 'team-1',
        started_at: s.created_at,
      };
      await expect(
        Promise.all([
          t.service.sheetSubmitted(s, [DECIDER_A], MEMBER),
          t.service.sheetDecided(s, 'approve', DECIDER_A, [DECIDER_A]),
          t.service.sheetDecided(s, 'return', DECIDER_A, [DECIDER_A]),
          t.service.sheetDecided(s, 'reopen', DECIDER_A, [DECIDER_A]),
          t.service.sheetDecided(s, 'withdraw', MEMBER, [DECIDER_A]),
          t.service.reopenRequested(s, [DECIDER_A], MEMBER),
          t.service.reminder(s),
          t.service.timerRunningLong(e),
          t.service.timerAutoStopped(e, 'auto_stopped_24h'),
          t.service.timerStopped(e),
          t.service.payoutRecorded(
            { id: 'p', member_user_id: MEMBER, team_id: 'team-1' },
            1,
            DECIDER_A,
          ),
          t.service.commentAdded(entry(), comment(), DECIDER_A),
        ]),
      ).resolves.toHaveLength(12);
    });
  });

  describe('hasNotified', () => {
    it('probes by user, type and content key', async () => {
      const t = await setup({ existing: true });
      await expect(
        t.service.hasNotified(
          MEMBER,
          'timer_running_long',
          'entry_id',
          'entry-1',
        ),
      ).resolves.toBe(true);
      const probe = t.calls.find((c) => c.table === 'notifications');
      expect(probe?.ops).toEqual([
        ['select', 'id'],
        ['eq', 'user_id', MEMBER],
        ['eq', 'type_id', 'type:timer_running_long'],
        ['eq', 'content->>entry_id', 'entry-1'],
        ['limit', 1],
      ]);
    });

    it('is false when nothing matches, and caches the type id', async () => {
      const t = await setup({ existing: false });
      await expect(
        t.service.hasNotified(
          MEMBER,
          'timesheet_reminder',
          'timesheet_id',
          's',
        ),
      ).resolves.toBe(false);
      await t.service.hasNotified(
        MEMBER,
        'timesheet_reminder',
        'timesheet_id',
        's',
      );
      expect(
        t.calls.filter((c) => c.table === 'notification_types'),
      ).toHaveLength(1);
    });

    it('throws on a failed probe (the cron counts it) and on a bad key', async () => {
      const t = await setup({ probeError: true });
      await expect(
        t.service.hasNotified(
          MEMBER,
          'timesheet_reminder',
          'timesheet_id',
          's',
        ),
      ).rejects.toThrow("Couldn't check notifications.");
      await expect(
        t.service.hasNotified(MEMBER, 'timesheet_reminder', 'id); drop', 's'),
      ).rejects.toThrow('invalid content key');
    });
  });

  describe('notify-once markers (W1 review F1)', () => {
    const REMINDER_KEY = `time:notified:timesheet_reminder:${MEMBER}:timesheet_id:sheet-1`;
    const LONG_KEY = `time:notified:timer_running_long:${MEMBER}:entry_id:entry-1`;
    const teamEntry = {
      id: 'entry-1',
      member_user_id: MEMBER,
      context_kind: 'team' as const,
      team_id: 'team-1',
      started_at: '2026-09-23T01:00:00Z',
    };

    it('a sent reminder still counts after the member deletes the bell row', async () => {
      const redis = fakeRedis();
      const t = await setup({ existing: false }, { redis });
      await t.service.reminder(sheet({ status: 'open' }));
      expect(redis.set).toHaveBeenCalledWith(REMINDER_KEY, '1', {
        ex: NOTIFIED_MARKER_TTL_SECONDS,
      });

      await expect(
        t.service.hasNotified(
          MEMBER,
          'timesheet_reminder',
          'timesheet_id',
          'sheet-1',
        ),
      ).resolves.toBe(true);
      // The marker answered: no bell-row probe.
      expect(t.calls.some((c) => c.table === 'notifications')).toBe(false);
    });

    it('a long-running timer notice is marked by entry_id, and a stop clears the marker', async () => {
      const redis = fakeRedis();
      const t = await setup({ existing: false }, { redis });
      await t.service.timerRunningLong(teamEntry);
      expect(redis.store.has(LONG_KEY)).toBe(true);
      await expect(
        t.service.hasNotified(
          MEMBER,
          'timer_running_long',
          'entry_id',
          'entry-1',
        ),
      ).resolves.toBe(true);

      await t.service.timerStopped(teamEntry);
      expect(redis.del).toHaveBeenCalledWith(LONG_KEY);
      await expect(
        t.service.hasNotified(
          MEMBER,
          'timer_running_long',
          'entry_id',
          'entry-1',
        ),
      ).resolves.toBe(false);
    });

    it('submitting clears the reminder marker, so a returned sheet can be reminded again', async () => {
      const redis = fakeRedis();
      const t = await setup({ existing: false }, { redis });
      await t.service.reminder(sheet({ status: 'open' }));
      await t.service.sheetSubmitted(sheet(), [DECIDER_A], MEMBER);
      expect(redis.del).toHaveBeenCalledWith(REMINDER_KEY);
      expect(redis.store.has(REMINDER_KEY)).toBe(false);
      await expect(
        t.service.hasNotified(
          MEMBER,
          'timesheet_reminder',
          'timesheet_id',
          'sheet-1',
        ),
      ).resolves.toBe(false);
    });

    it('a failed send leaves no marker, so the next run retries', async () => {
      const redis = fakeRedis();
      const t = await setup({}, { redis });
      t.notifications.createNotification.mockRejectedValue(new Error('x'));
      await t.service.reminder(sheet({ status: 'open' }));
      await t.service.timerRunningLong(teamEntry);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('other types and other keys never touch Redis', async () => {
      const redis = fakeRedis();
      const t = await setup({ existing: false }, { redis });
      await t.service.hasNotified(
        MEMBER,
        'timesheet_submitted',
        'timesheet_id',
        'sheet-1',
      );
      await t.service.hasNotified(
        MEMBER,
        'timesheet_reminder',
        'entry_id',
        'sheet-1',
      );
      await t.service.sheetDecided(
        sheet({ status: 'returned', decision_note: 'x' }),
        'return',
        DECIDER_A,
        [DECIDER_A],
      );
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('a failing Redis falls back to the bell-row probe and never fails a send', async () => {
      const redis = fakeRedis(true);
      const t = await setup({ existing: true }, { redis });
      await expect(
        t.service.reminder(sheet({ status: 'open' })),
      ).resolves.toBeUndefined();
      expect(t.sent()).toHaveLength(1);
      await expect(
        t.service.hasNotified(
          MEMBER,
          'timesheet_reminder',
          'timesheet_id',
          'sheet-1',
        ),
      ).resolves.toBe(true);
      expect(t.calls.some((c) => c.table === 'notifications')).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('time_notify_marker_write_failed'),
      );

      const empty = await setup({ existing: false }, { redis });
      await expect(
        empty.service.hasNotified(
          MEMBER,
          'timesheet_reminder',
          'timesheet_id',
          'sheet-1',
        ),
      ).resolves.toBe(false);
    });
  });
});
