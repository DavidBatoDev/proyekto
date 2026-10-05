// backend/src/modules/execution/time/legacy/team-time-legacy.mapper.ts
//
// Pure mapping from the time module's shapes to the old /api/team-time shapes (blueprint §4, compat.md §3). The
// old status is derived from column predicates only (D03, rule R1): no sheet join, and never time_entries.status,
// which drops in M5 while the alias lives on. Cost keys are absent, never zero, when cost is hidden (D05).
import type {
  CapContext,
  CommentRow,
  LegacyEntryStatus,
  SegmentRow,
  TimeEntryView,
} from '../time.types';
import type {
  LegacyComment,
  LegacyLogsSummary,
  LegacyMemberEmbed,
  LegacyReviewerEmbed,
  LegacySegment,
  LegacyStatusCounts,
  LegacySummaryBucket,
  LegacyTaskTimeLog,
} from './team-time-legacy.types';

/** D32 alias copy: the masked worker's name on rows and in member lists. */
export const ALIAS_MASKED_MEMBER_NAME = 'Delivery team member';

/** D32: a masked row's `member_user_id`. The old web groups rows by this value, so it is never null. */
export function maskedMemberId(contextRef: string | null): string {
  return `masked:${contextRef ?? ''}`;
}

// ── R1 status ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The three columns the old status is derived from. */
export interface LegacyStatusInput {
  payable_seconds: number | string | null;
  payout_id: string | null;
  legacy_status: string | null;
}

/**
 * D03: `paid` = payout_id IS NOT NULL OR legacy_status = 'paid_outside'; `rejected` = legacy_status = 'rejected'
 * (and not paid); `approved` = payable_seconds IS NOT NULL AND payout_id IS NULL AND legacy_status IS NULL;
 * `pending` = the rest (open, submitted and returned sheets, running and personal entries).
 */
export function legacyStatusOf(row: LegacyStatusInput): LegacyEntryStatus {
  if (row.payout_id || row.legacy_status === 'paid_outside') return 'paid';
  if (row.legacy_status === 'rejected') return 'rejected';
  if (
    row.payable_seconds !== null &&
    row.payable_seconds !== undefined &&
    (row.legacy_status === null || row.legacy_status === undefined)
  ) {
    return 'approved';
  }
  return 'pending';
}

/** The PostgREST builder methods the status filter needs. */
export interface LegacyStatusFilterable<Q> {
  eq(column: string, value: string): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: null): Q;
  or(filters: string): Q;
}

/** R1 `paid` as one or-group. */
export const LEGACY_PAID_OR = [
  'payout_id.not.is.null',
  'legacy_status.eq.paid_outside',
] as const;

/**
 * R1 as filters, so `count: 'exact'` paging stays exact and the filter agrees with legacyStatusOf row for row.
 * `paid` is an or-group: with `orGroups` it is pushed there (the caller ANDs every group into one `.or()`),
 * otherwise it is applied with `.or()` directly.
 */
export function applyLegacyStatusFilter<Q extends LegacyStatusFilterable<Q>>(
  query: Q,
  status: LegacyEntryStatus,
  orGroups?: string[][],
): Q {
  switch (status) {
    case 'paid':
      if (orGroups) {
        orGroups.push([...LEGACY_PAID_OR]);
        return query;
      }
      return query.or(LEGACY_PAID_OR.join(','));
    case 'rejected':
      return query.eq('legacy_status', 'rejected').is('payout_id', null);
    case 'approved':
      return query
        .not('payable_seconds', 'is', null)
        .is('payout_id', null)
        .is('legacy_status', null);
    default:
      return query
        .is('payable_seconds', null)
        .is('payout_id', null)
        .is('legacy_status', null);
  }
}

// ── R2 review fields ──────────────────────────────────────────────────────────────────────────────────────────

/** One row of ENTRY_LEGACY_REVIEW_SELECT. */
export interface LegacyReviewRow {
  id: string;
  legacy_reviewed_by: string | null;
  legacy_reviewed_at: string | null;
  legacy_review_note: string | null;
  legacy_reviewer: LegacyReviewerEmbed | null;
}

const SHEET_DECISION_KINDS: ReadonlySet<string> = new Set([
  'manual',
  'auto',
  'self',
]);
const SHEET_DECIDED_STATUSES: ReadonlySet<string> = new Set([
  'approved',
  'returned',
]);

/** R2: the entry's sheet decision stands in for the old per-log review (decided by a person, auto or self). */
export function sheetDecisionApplies(view: Pick<TimeEntryView, 'timesheet'>) {
  const sheet = view.timesheet;
  return (
    sheet !== null &&
    sheet !== undefined &&
    sheet.decision_kind !== null &&
    SHEET_DECISION_KINDS.has(sheet.decision_kind) &&
    SHEET_DECIDED_STATUSES.has(sheet.status)
  );
}

export interface LegacyReviewFields {
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  reviewer: LegacyReviewerEmbed | null;
}

/** R2. `deciders` holds the sheet deciders' profiles keyed by lower-case id. */
export function legacyReviewOf(
  view: Pick<TimeEntryView, 'timesheet'>,
  review: LegacyReviewRow | null | undefined,
  deciders?: ReadonlyMap<string, LegacyReviewerEmbed>,
): LegacyReviewFields {
  if (sheetDecisionApplies(view) && view.timesheet) {
    const by = view.timesheet.decided_by;
    return {
      reviewed_by: by,
      reviewed_at: view.timesheet.decided_at,
      review_note: view.timesheet.decision_note,
      reviewer: by ? (deciders?.get(by.toLowerCase()) ?? null) : null,
    };
  }
  return {
    reviewed_by: review?.legacy_reviewed_by ?? null,
    reviewed_at: review?.legacy_reviewed_at ?? null,
    review_note: review?.legacy_review_note ?? null,
    reviewer: review?.legacy_reviewer ?? null,
  };
}

// ── R3 row ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LegacyRowExtras {
  review?: LegacyReviewRow | null;
  /** Sheet deciders' profiles keyed by lower-case id (R2). */
  deciders?: ReadonlyMap<string, LegacyReviewerEmbed>;
  /** D36: present only when a team member cap applies. */
  limitContext?: CapContext | null;
  /** The route may carry cost (R4: never on project team routes). The view's own cost class still decides. */
  cost: boolean;
}

function legacyIdentity(
  view: TimeEntryView,
): Pick<
  LegacyTaskTimeLog,
  'member_user_id' | 'member_display_name_snapshot' | 'member'
> {
  if (view.identity === 'masked') {
    // D32 alias: an opaque per-assignment id and "Delivery team member", no avatar, no email.
    const id = maskedMemberId(view.context_ref);
    return {
      member_user_id: id,
      member_display_name_snapshot: null,
      member: {
        id,
        display_name: ALIAS_MASKED_MEMBER_NAME,
        avatar_url: null,
        first_name: null,
        last_name: null,
      },
    };
  }
  const snapshot = view.member_display_name_snapshot ?? null;
  // A deleted account leaves member_user_id NULL (FK SET NULL); the old type is a string, so '' stands in.
  const memberId = view.member_user_id ?? '';
  const m = view.member;
  let member: LegacyMemberEmbed | null = null;
  if (m) {
    member = {
      id: m.id,
      // R3: the UI's last fallback is a raw UUID, so the snapshot fills a missing profile name.
      display_name: m.display_name || snapshot || null,
      avatar_url: m.avatar_url ?? null,
      first_name: m.first_name ?? null,
      last_name: m.last_name ?? null,
    };
    if (m.email !== undefined) member.email = m.email;
  } else if (snapshot) {
    member = {
      id: memberId,
      display_name: snapshot,
      avatar_url: null,
      first_name: null,
      last_name: null,
    };
  }
  return {
    member_user_id: memberId,
    member_display_name_snapshot: snapshot,
    member,
  };
}

/** R3: the old TaskTimeLog row. `contract_warning` is never sent; `limit_context` only when a cap applies. */
export function toLegacyLog(
  view: TimeEntryView,
  extras: LegacyRowExtras,
): LegacyTaskTimeLog {
  const breakSeconds = Math.max(0, Number(view.break_seconds ?? 0) || 0);
  const row: LegacyTaskTimeLog = {
    id: view.id,
    project_id: view.project_id,
    task_id: view.task_id,
    team_id: view.team_id,
    ...legacyIdentity(view),
    started_at: view.started_at,
    ended_at: view.ended_at,
    duration_seconds: view.duration_seconds,
    // D43: the minutes mirror is derived from the seconds, the source of truth.
    break_minutes: Math.round(breakSeconds / 60),
    break_seconds: breakSeconds,
    paused_at: view.paused_at ?? null,
    status: legacyStatusOf(view),
    source: view.source,
    work_type_snapshot: view.work_type_snapshot,
    flagged_reason: view.flagged_reason,
    created_at: view.created_at,
    updated_at: view.updated_at,
    ...legacyReviewOf(view, extras.review, extras.deciders),
    task: view.task
      ? {
          id: view.task.id,
          title: view.task.title,
          work_type: view.task.work_type ?? null,
          status: view.task.status ?? null,
        }
      : null,
    project: view.project
      ? { id: view.project.id, title: view.project.title }
      : null,
  };
  if (extras.cost && view.cost === 'visible') {
    row.rate_snapshot = Number(view.rate_snapshot ?? 0) || 0;
    row.rate_type_snapshot = view.rate_type_snapshot ?? 'hourly';
    row.currency_snapshot = view.currency_snapshot ?? 'USD';
  }
  if (extras.limitContext) row.limit_context = extras.limitContext;
  return row;
}

// ── Segments and comments ─────────────────────────────────────────────────────────────────────────────────────

/** Old TimeLogSegmentRow: `log_id` = entry_id. */
export function toLegacySegment(row: SegmentRow): LegacySegment {
  return {
    id: row.id,
    log_id: row.entry_id,
    kind: row.kind,
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
  };
}

/** Old TimeLogCommentRow: `log_id` = entry_id; the email key only when the source selected it. */
export function toLegacyComment(row: CommentRow): LegacyComment {
  const a = row.author;
  let author: LegacyComment['author'] = null;
  if (a) {
    author = {
      id: a.id,
      display_name: a.display_name ?? null,
      avatar_url: a.avatar_url ?? null,
      first_name: a.first_name ?? null,
      last_name: a.last_name ?? null,
    };
    if (a.email !== undefined) author.email = a.email;
  }
  return {
    id: row.id,
    log_id: row.entry_id,
    author_user_id: row.author_user_id,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author,
  };
}

// ── R9 summary ────────────────────────────────────────────────────────────────────────────────────────────────

/** One summary row. The cost keys are present only on rows whose cost the viewer may read (never selected
 *  otherwise), so a row without them adds hours and a status count but no fee. */
export interface LegacySummaryRow extends LegacyStatusInput {
  duration_seconds: number | string | null;
  rate_snapshot?: number | string | null;
  currency_snapshot?: string | null;
  amount_snapshot?: number | string | null;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** R9 fee of one row: amount_snapshot ?? round(duration/3600 × rate_snapshot, 2); null when it carries no cost. */
export function legacyFeeOf(row: LegacySummaryRow): number | null {
  if (row.rate_snapshot === undefined && row.amount_snapshot === undefined) {
    return null;
  }
  const amount = toNumber(row.amount_snapshot);
  if (amount !== null) return amount;
  const rate = toNumber(row.rate_snapshot) ?? 0;
  const seconds = Math.max(0, toNumber(row.duration_seconds) ?? 0);
  return round2((seconds / 3600) * rate);
}

const FEE_KEY: Record<LegacyEntryStatus, keyof LegacySummaryBucket> = {
  pending: 'pendingFees',
  approved: 'approvedFees',
  paid: 'paidFees',
  rejected: 'rejectedFees',
};

/**
 * R9 (port of the old logsSummary). `totalHours` = Σ duration/3600 over every row; `statusCounts` from R1 over
 * every row (running and zero-length rows count) and always present; fee buckets per currency over the rows that
 * carry cost: `feeRows` when given (the viewer's own rows when a team's cost is hidden), else `rows`. A row with
 * no positive fee opens no bucket (old behaviour). No cost-carrying row → `buckets: {}`, `currencies: []` (D05).
 */
export function legacySummary(
  rows: Iterable<LegacySummaryRow>,
  feeRows?: Iterable<LegacySummaryRow>,
): LegacyLogsSummary {
  const statusCounts: LegacyStatusCounts = {
    pending: 0,
    approved: 0,
    paid: 0,
    rejected: 0,
  };
  let totalSeconds = 0;
  for (const row of rows) {
    statusCounts[legacyStatusOf(row)] += 1;
    const seconds = toNumber(row.duration_seconds) ?? 0;
    if (seconds > 0) totalSeconds += seconds;
  }

  const buckets: Record<string, LegacySummaryBucket> = {};
  for (const row of feeRows ?? rows) {
    const fee = legacyFeeOf(row);
    if (fee === null || !(fee > 0)) continue;
    const currency = row.currency_snapshot || 'USD';
    const bucket = (buckets[currency] ??= {
      pendingFees: 0,
      approvedFees: 0,
      paidFees: 0,
      rejectedFees: 0,
      totalFees: 0,
    });
    bucket.totalFees += fee;
    bucket[FEE_KEY[legacyStatusOf(row)]] += fee;
  }
  for (const bucket of Object.values(buckets)) {
    bucket.pendingFees = round2(bucket.pendingFees);
    bucket.approvedFees = round2(bucket.approvedFees);
    bucket.paidFees = round2(bucket.paidFees);
    bucket.rejectedFees = round2(bucket.rejectedFees);
    bucket.totalFees = round2(bucket.totalFees);
  }

  return {
    buckets,
    currencies: Object.keys(buckets).sort(),
    totalHours: totalSeconds / 3600,
    statusCounts,
  };
}
