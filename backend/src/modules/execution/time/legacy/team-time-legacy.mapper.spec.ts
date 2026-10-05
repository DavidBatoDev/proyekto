import type { CommentRow, SegmentRow, TimeEntryView } from '../time.types';
import {
  ALIAS_MASKED_MEMBER_NAME,
  applyLegacyStatusFilter,
  LEGACY_PAID_OR,
  legacyFeeOf,
  legacyReviewOf,
  legacyStatusOf,
  type LegacyReviewRow,
  legacySummary,
  type LegacySummaryRow,
  maskedMemberId,
  sheetDecisionApplies,
  toLegacyComment,
  toLegacyLog,
  toLegacySegment,
} from './team-time-legacy.mapper';

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DECIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LEGACY_REVIEWER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TEAM = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ASSIGNMENT = '55555555-5555-4555-8555-555555555555';

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
    duration_seconds: 6600,
    break_seconds: 600,
    break_minutes: 10,
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
    member_display_name_snapshot: 'Ann Member',
    member: {
      id: ME,
      display_name: 'Ann',
      avatar_url: 'https://cdn/ann.png',
      first_name: 'Ann',
      last_name: 'Member',
      email: 'ann@example.com',
    },
    member_label: null,
    content: 'visible',
    task_id: 't1',
    note: 'Logo pass',
    task: { id: 't1', title: 'Logo', work_type: 'real_work', status: 'done' },
    project: { id: PROJECT, title: 'Acme site' },
    content_label: null,
    cost: 'visible',
    rate_snapshot: 25,
    rate_type_snapshot: 'hourly',
    currency_snapshot: 'PHP',
    amount_snapshot: null,
    ...partial,
  };
}

/** The Row fields the old web reads (compat.md §1 "Row"). */
const CORE_KEYS = [
  'id',
  'project_id',
  'task_id',
  'team_id',
  'member_user_id',
  'started_at',
  'ended_at',
  'duration_seconds',
  'break_seconds',
  'break_minutes',
  'paused_at',
  'status',
  'source',
  'work_type_snapshot',
  'member_display_name_snapshot',
  'flagged_reason',
  'created_at',
  'updated_at',
  'reviewed_by',
  'reviewed_at',
  'review_note',
  'task',
  'project',
  'member',
  'reviewer',
];

// ── R1 ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('legacyStatusOf (D03, every column combination)', () => {
  // [payable_seconds, payout_id, legacy_status, expected]
  const matrix: Array<[number | null, string | null, string | null, string]> = [
    [null, null, null, 'pending'],
    [3600, null, null, 'approved'],
    [0, null, null, 'approved'],
    [null, 'p1', null, 'paid'],
    [3600, 'p1', null, 'paid'],
    [null, null, 'rejected', 'rejected'],
    [3600, null, 'rejected', 'rejected'],
    [null, 'p1', 'rejected', 'paid'],
    [3600, 'p1', 'rejected', 'paid'],
    [null, null, 'paid_outside', 'paid'],
    [3600, null, 'paid_outside', 'paid'],
    [null, 'p1', 'paid_outside', 'paid'],
    [3600, 'p1', 'paid_outside', 'paid'],
  ];
  it.each(matrix)(
    'payable=%s payout=%s legacy=%s → %s',
    (payable, payout, legacy, expected) => {
      expect(
        legacyStatusOf({
          payable_seconds: payable,
          payout_id: payout,
          legacy_status: legacy,
        }),
      ).toBe(expected);
    },
  );

  it('never reads a `status` column', () => {
    const row = {
      payable_seconds: null,
      payout_id: null,
      legacy_status: null,
      status: 'approved',
    };
    expect(legacyStatusOf(row)).toBe('pending');
  });
});

describe('applyLegacyStatusFilter (R1 filters agree with legacyStatusOf)', () => {
  function recorder() {
    const ops: unknown[][] = [];
    const q = {
      eq: (...a: unknown[]) => (ops.push(['eq', ...a]), q),
      is: (...a: unknown[]) => (ops.push(['is', ...a]), q),
      not: (...a: unknown[]) => (ops.push(['not', ...a]), q),
      or: (...a: unknown[]) => (ops.push(['or', ...a]), q),
    };
    return { q, ops };
  }

  it('pending: no payable, no payout, no marker', () => {
    const { q, ops } = recorder();
    applyLegacyStatusFilter(q, 'pending');
    expect(ops).toEqual([
      ['is', 'payable_seconds', null],
      ['is', 'payout_id', null],
      ['is', 'legacy_status', null],
    ]);
  });

  it('approved: frozen, unpaid, no marker', () => {
    const { q, ops } = recorder();
    applyLegacyStatusFilter(q, 'approved');
    expect(ops).toEqual([
      ['not', 'payable_seconds', 'is', null],
      ['is', 'payout_id', null],
      ['is', 'legacy_status', null],
    ]);
  });

  it('rejected: the marker and not paid', () => {
    const { q, ops } = recorder();
    applyLegacyStatusFilter(q, 'rejected');
    expect(ops).toEqual([
      ['eq', 'legacy_status', 'rejected'],
      ['is', 'payout_id', null],
    ]);
  });

  it('paid: one or-group, applied directly or pushed for the caller to AND', () => {
    const direct = recorder();
    applyLegacyStatusFilter(direct.q, 'paid');
    expect(direct.ops).toEqual([
      ['or', 'payout_id.not.is.null,legacy_status.eq.paid_outside'],
    ]);

    const grouped = recorder();
    const groups: string[][] = [['context_kind.neq.personal']];
    applyLegacyStatusFilter(grouped.q, 'paid', groups);
    expect(grouped.ops).toEqual([]);
    expect(groups).toEqual([
      ['context_kind.neq.personal'],
      [...LEGACY_PAID_OR],
    ]);
  });

  it('never filters on time_entries.status', () => {
    for (const status of ['pending', 'approved', 'paid', 'rejected'] as const) {
      const { q, ops } = recorder();
      applyLegacyStatusFilter(q, status);
      expect(JSON.stringify(ops)).not.toMatch(/"status"/);
    }
  });
});

// ── R2 ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('legacyReviewOf (R2)', () => {
  const legacy: LegacyReviewRow = {
    id: 'e1',
    legacy_reviewed_by: LEGACY_REVIEWER,
    legacy_reviewed_at: '2026-08-01T00:00:00.000Z',
    legacy_review_note: 'ok (old)',
    legacy_reviewer: {
      id: LEGACY_REVIEWER,
      display_name: 'Old Admin',
      avatar_url: null,
    },
  };
  const deciders = new Map([
    [
      DECIDER.toLowerCase(),
      { id: DECIDER, display_name: 'Dee Cider', avatar_url: null },
    ],
  ]);
  const sheet = (
    status: 'open' | 'submitted' | 'returned' | 'approved',
    kind: 'manual' | 'auto' | 'self' | 'legacy' | null,
  ) =>
    view({
      timesheet: {
        id: 's1',
        status,
        period_start: '2026-08-31',
        period_end: '2026-09-06',
        decision_kind: kind,
        decided_by: kind === 'manual' ? DECIDER.toUpperCase() : null,
        decided_at: '2026-09-07T00:00:00.000Z',
        decision_note: 'Fix Tuesday',
        scope_label_snapshot: 'Acme',
      },
    });

  it.each([
    ['approved', 'manual'],
    ['returned', 'manual'],
    ['approved', 'auto'],
    ['approved', 'self'],
  ] as const)('a %s sheet decided %s stands in for the review', (s, k) => {
    const v = sheet(s, k);
    expect(sheetDecisionApplies(v)).toBe(true);
    const r = legacyReviewOf(v, legacy, deciders);
    expect(r.reviewed_at).toBe('2026-09-07T00:00:00.000Z');
    expect(r.review_note).toBe('Fix Tuesday');
    if (k === 'manual') {
      expect(r.reviewed_by).toBe(DECIDER.toUpperCase());
      expect(r.reviewer).toEqual({
        id: DECIDER,
        display_name: 'Dee Cider',
        avatar_url: null,
      });
    } else {
      expect(r.reviewed_by).toBeNull();
      expect(r.reviewer).toBeNull();
    }
  });

  it.each([
    ['approved', 'legacy'],
    ['submitted', 'manual'],
    ['open', null],
  ] as const)(
    'a %s sheet decided %s falls back to legacy_reviewed_*',
    (s, k) => {
      const v = sheet(s, k);
      expect(sheetDecisionApplies(v)).toBe(false);
      expect(legacyReviewOf(v, legacy, deciders)).toEqual({
        reviewed_by: LEGACY_REVIEWER,
        reviewed_at: '2026-08-01T00:00:00.000Z',
        review_note: 'ok (old)',
        reviewer: {
          id: LEGACY_REVIEWER,
          display_name: 'Old Admin',
          avatar_url: null,
        },
      });
    },
  );

  it('no sheet and no legacy review: all null', () => {
    expect(legacyReviewOf(view({ timesheet: null }), null)).toEqual({
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      reviewer: null,
    });
  });
});

// ── R3 / R4 ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('toLegacyLog', () => {
  it('carries every Row field the old web reads, status derived from columns', () => {
    const row = toLegacyLog(view({ payable_seconds: 6600 }), { cost: true });
    for (const key of CORE_KEYS) expect(row).toHaveProperty(key);
    expect(row.status).toBe('approved');
    expect(row.task).toEqual({
      id: 't1',
      title: 'Logo',
      work_type: 'real_work',
      status: 'done',
    });
    expect(row.project).toEqual({ id: PROJECT, title: 'Acme site' });
    expect(row).not.toHaveProperty('contract_warning');
    expect(row).not.toHaveProperty('limit_context');
    // New-API keys never leak into the old shape.
    for (const key of [
      'context_kind',
      'timesheet',
      'locked_reason',
      'identity',
      'cost',
      'note',
      'warnings',
    ]) {
      expect(row).not.toHaveProperty(key);
    }
  });

  it('cost keys only when the route allows cost and the view carries it (D05)', () => {
    const visible = toLegacyLog(view(), { cost: true });
    expect(visible).toMatchObject({
      rate_snapshot: 25,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
    });

    const route = toLegacyLog(view(), { cost: false });
    const hidden = toLegacyLog(
      view({
        cost: 'hidden',
        rate_snapshot: undefined,
        rate_type_snapshot: undefined,
        currency_snapshot: undefined,
        amount_snapshot: undefined,
      }),
      { cost: true },
    );
    for (const row of [route, hidden]) {
      expect(row).not.toHaveProperty('rate_snapshot');
      expect(row).not.toHaveProperty('rate_type_snapshot');
      expect(row).not.toHaveProperty('currency_snapshot');
      expect(row).not.toHaveProperty('amount_snapshot');
    }
  });

  it('break_minutes mirrors round(break_seconds / 60) (D43)', () => {
    expect(
      toLegacyLog(view({ break_seconds: 89, break_minutes: 0 }), {
        cost: true,
      }),
    ).toMatchObject({ break_seconds: 89, break_minutes: 1 });
  });

  it('a masked row: masked:<context_ref>, "Delivery team member", no avatar or email (D32)', () => {
    const row = toLegacyLog(
      view({
        context_kind: 'assignment',
        context_ref: ASSIGNMENT,
        identity: 'masked',
        member_user_id: null,
        member_display_name_snapshot: null,
        member: null,
        member_label: 'Delivery team',
        cost: 'hidden',
      }),
      { cost: false },
    );
    expect(row.member_user_id).toBe(maskedMemberId(ASSIGNMENT));
    expect(row.member_user_id).toBe(`masked:${ASSIGNMENT}`);
    expect(row.member).toEqual({
      id: `masked:${ASSIGNMENT}`,
      display_name: ALIAS_MASKED_MEMBER_NAME,
      avatar_url: null,
      first_name: null,
      last_name: null,
    });
    expect(row.member_display_name_snapshot).toBeNull();
  });

  it('member.display_name falls back to the snapshot; email only when selected', () => {
    const row = toLegacyLog(
      view({
        member: {
          id: ME,
          display_name: null,
          avatar_url: null,
          first_name: null,
          last_name: null,
        },
      }),
      { cost: true },
    );
    expect(row.member?.display_name).toBe('Ann Member');
    expect(row.member).not.toHaveProperty('email');

    const withEmail = toLegacyLog(view(), { cost: true });
    expect(withEmail.member?.email).toBe('ann@example.com');
  });

  it('a deleted profile keeps the snapshot name and a string member id', () => {
    const row = toLegacyLog(view({ member_user_id: null, member: null }), {
      cost: true,
    });
    expect(row.member_user_id).toBe('');
    expect(row.member).toEqual({
      id: '',
      display_name: 'Ann Member',
      avatar_url: null,
      first_name: null,
      last_name: null,
    });
    expect(
      toLegacyLog(
        view({
          member_user_id: null,
          member: null,
          member_display_name_snapshot: null,
        }),
        { cost: true },
      ).member,
    ).toBeNull();
  });

  it('hidden content keeps project_id but no task, task_id or project embed', () => {
    const row = toLegacyLog(
      view({
        content: 'hidden',
        task_id: null,
        note: null,
        task: null,
        project: null,
        content_label: "A project you can't open",
      }),
      { cost: false },
    );
    expect(row).toMatchObject({
      project_id: PROJECT,
      task_id: null,
      task: null,
      project: null,
    });
  });

  it('limit_context only when a cap applies (D36)', () => {
    const cap = {
      over_limit: true,
      limit_window: 'weekly' as const,
      limit_hours: 40,
      logged_hours_in_window: 41.5,
      overtime_requires_approval: true,
      window_start: '2026-08-31',
      window_end: '2026-09-06',
    };
    expect(
      toLegacyLog(view(), { cost: true, limitContext: cap }),
    ).toMatchObject({ limit_context: cap });
    expect(
      toLegacyLog(view(), { cost: true, limitContext: null }),
    ).not.toHaveProperty('limit_context');
  });
});

describe('toLegacySegment / toLegacyComment', () => {
  it('segment: entry_id → log_id', () => {
    const seg: SegmentRow = {
      id: 'g1',
      entry_id: 'e1',
      kind: 'break',
      started_at: '2026-09-02T02:00:00.000Z',
      ended_at: null,
      created_at: '2026-09-02T02:00:00.000Z',
    };
    expect(toLegacySegment(seg)).toEqual({
      id: 'g1',
      log_id: 'e1',
      kind: 'break',
      started_at: '2026-09-02T02:00:00.000Z',
      ended_at: null,
      created_at: '2026-09-02T02:00:00.000Z',
    });
  });

  it('comment: entry_id → log_id; email only when the source selected it; masked byline stays null', () => {
    const base: CommentRow = {
      id: 'c1',
      entry_id: 'e1',
      author_user_id: ME,
      body: 'Looks right',
      created_at: '2026-09-02T04:00:00.000Z',
      updated_at: '2026-09-02T04:00:00.000Z',
      author: { id: ME, display_name: 'Ann', avatar_url: null },
    };
    expect(toLegacyComment(base)).toEqual({
      id: 'c1',
      log_id: 'e1',
      author_user_id: ME,
      body: 'Looks right',
      created_at: '2026-09-02T04:00:00.000Z',
      updated_at: '2026-09-02T04:00:00.000Z',
      author: {
        id: ME,
        display_name: 'Ann',
        avatar_url: null,
        first_name: null,
        last_name: null,
      },
    });
    expect(
      toLegacyComment({
        ...base,
        author: { ...base.author!, email: 'ann@example.com' },
      }).author?.email,
    ).toBe('ann@example.com');
    expect(
      toLegacyComment({ ...base, author_user_id: null, author: null }),
    ).toMatchObject({ author_user_id: null, author: null });
  });
});

// ── R9 ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('legacySummary (R9)', () => {
  const costed = (
    partial: Partial<LegacySummaryRow> = {},
  ): LegacySummaryRow => ({
    duration_seconds: 3600,
    payable_seconds: null,
    payout_id: null,
    legacy_status: null,
    rate_snapshot: 100,
    currency_snapshot: 'USD',
    amount_snapshot: null,
    ...partial,
  });

  it('fee = amount_snapshot ?? round(duration/3600 × rate, 2); none without cost keys', () => {
    expect(legacyFeeOf(costed())).toBe(100);
    expect(legacyFeeOf(costed({ amount_snapshot: '87.5' }))).toBe(87.5);
    expect(
      legacyFeeOf(costed({ duration_seconds: 100, rate_snapshot: 10 })),
    ).toBe(0.28);
    expect(
      legacyFeeOf({
        duration_seconds: 3600,
        payable_seconds: null,
        payout_id: null,
        legacy_status: null,
      }),
    ).toBeNull();
  });

  it('buckets by currency and status; totalHours and statusCounts over every row', () => {
    const summary = legacySummary([
      costed(),
      costed({ payable_seconds: 3600 }),
      costed({ payout_id: 'p1', currency_snapshot: 'PHP', rate_snapshot: 50 }),
      costed({ legacy_status: 'rejected', duration_seconds: 1800 }),
      costed({ duration_seconds: null, rate_snapshot: 100 }), // running: counts, no fee
      costed({ rate_snapshot: 0 }), // zero rate: counts, no bucket entry
    ]);
    expect(summary.statusCounts).toEqual({
      pending: 3,
      approved: 1,
      paid: 1,
      rejected: 1,
    });
    // 3600 × 4 + 1800; the running row adds nothing.
    expect(summary.totalHours).toBeCloseTo(4.5, 6);
    expect(summary.currencies).toEqual(['PHP', 'USD']);
    expect(summary.buckets.USD).toEqual({
      pendingFees: 100,
      approvedFees: 100,
      paidFees: 0,
      rejectedFees: 50,
      totalFees: 250,
    });
    expect(summary.buckets.PHP).toEqual({
      pendingFees: 0,
      approvedFees: 0,
      paidFees: 50,
      rejectedFees: 0,
      totalFees: 50,
    });
  });

  it('hidden cost: buckets {} and currencies [], hours and statusCounts kept (D05)', () => {
    const summary = legacySummary([
      {
        duration_seconds: 7200,
        payable_seconds: 7200,
        payout_id: null,
        legacy_status: null,
      },
      {
        duration_seconds: 3600,
        payable_seconds: null,
        payout_id: null,
        legacy_status: null,
      },
    ]);
    expect(summary).toEqual({
      buckets: {},
      currencies: [],
      totalHours: 3,
      statusCounts: { pending: 1, approved: 1, paid: 0, rejected: 0 },
    });
  });

  it('an empty set still answers statusCounts', () => {
    expect(legacySummary([])).toEqual({
      buckets: {},
      currencies: [],
      totalHours: 0,
      statusCounts: { pending: 0, approved: 0, paid: 0, rejected: 0 },
    });
  });

  it('feeRows: counts from every row, fees only from the given rows', () => {
    const all: LegacySummaryRow[] = [
      {
        duration_seconds: 3600,
        payable_seconds: null,
        payout_id: null,
        legacy_status: null,
      },
      {
        duration_seconds: 3600,
        payable_seconds: null,
        payout_id: null,
        legacy_status: null,
      },
    ];
    const summary = legacySummary(all, [costed({ rate_snapshot: 30 })]);
    expect(summary.statusCounts.pending).toBe(2);
    expect(summary.totalHours).toBe(2);
    expect(summary.buckets).toEqual({
      USD: {
        pendingFees: 30,
        approvedFees: 0,
        paidFees: 0,
        rejectedFees: 0,
        totalFees: 30,
      },
    });
  });
});
