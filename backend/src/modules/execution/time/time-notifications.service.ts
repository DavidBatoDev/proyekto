import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { NotificationsService } from '../../shared/notifications/notifications.service';
import { teamManagerIds } from '../teams/team-authority';
import { timePath } from '../workspaces/workspace-paths';
import type {
  CommentRow,
  EntryAuthRow,
  FlaggedReason,
  TimeEntryView,
  TimesheetRow,
} from './time.types';

/**
 * Time notifications: one row per transition per recipient.
 *
 * Rules every method follows (backend.md › Notifications, blueprint D29/D51):
 * - The actor is never notified, and neither is a deleted account
 *   (`profiles.deleted_at` set, L39).
 * - No message, push or email carries an amount, a rate or a currency
 *   (CHANGE-19). Hours and dates are fine; money never is. The spec pins it.
 * - `notifications.project_id` stays null: a timesheet spans projects.
 * - Links go to the Time pages (D79, replacing the D29 gap links): timesheet
 *   types to `/time/timesheets/<id>`; entry notices (comment, timer still
 *   running, timer stopped) to `/time?entry=<id>` for every context and every
 *   recipient; a recorded payout to `/time`. Links stored before D79 point at
 *   the team time pages, which the web keeps as redirect stubs.
 * - D51: a notification goes out after a committed RPC, payout or comment, so
 *   it must never turn that success into an error. Every method except
 *   `hasNotified` catches and logs at `warn`. Callers `await` it (Cloud Run
 *   freezes the CPU once the response is sent, so a detached promise may never
 *   finish). Fan-out uses `Promise.all`, and each recipient is isolated: one
 *   failed insert does not stop the others.
 */

export type TimeNotificationType =
  | 'timesheet_submitted'
  | 'timesheet_returned'
  | 'timesheet_approved'
  | 'timesheet_reopened'
  | 'timesheet_reopen_requested'
  | 'timesheet_reminder'
  | 'timer_running_long'
  | 'timer_auto_stopped'
  | 'time_payout_recorded'
  | 'time_log_comment_added';

type SheetNotificationType = Extract<
  TimeNotificationType,
  `timesheet_${string}`
>;

/** The payout copy, verbatim (E67). It never names the amount. */
export const TIME_PAYOUT_MESSAGE = 'A payment was recorded for your time';

/** Longest decision note or comment quoted into a bell row. */
export const TIME_SNIPPET_MAX_CHARS = 140;

/** Cron job 2's threshold for "Timer still running" (blueprint P11). */
const LONG_TIMER_HOURS = 10;

/** Cron job 1 stops a timer after this long (`auto_stopped_24h`). */
const AUTO_STOP_HOURS = 24;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A `content` key usable in a PostgREST `content->>key` filter. */
const CONTENT_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * The cron "notify once" types and the content key their idempotency probe
 * uses (cron jobs 2 and 5). The owner can hard-delete a bell row
 * (`DELETE /api/notifications/:id`), so these sends also leave a Redis marker
 * that `hasNotified` honours. A marker lives as long as the row would: it is
 * set after a successful send and removed wherever the row is cleared, so
 * only a deletion by the user leaves a marker without a row.
 */
const NOTIFY_ONCE_KEYS: Partial<Record<TimeNotificationType, string>> = {
  timesheet_reminder: 'timesheet_id',
  timer_running_long: 'entry_id',
};

/** A marker outlives any sensible reminder cycle, then expires by itself. */
export const NOTIFIED_MARKER_TTL_SECONDS = 40 * 24 * 3600;

export function notifiedMarkerKey(
  type: TimeNotificationType,
  userId: string,
  key: string,
  value: string,
): string {
  return `time:notified:${type}:${userId}:${key}:${value}`;
}

/** Redis marker failures are logged at warn at most once a minute per process. */
const MARKER_WARN_INTERVAL_MS = 60_000;

function parseLocalDate(
  d: string,
): { y: number; m: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
  if (!match) return null;
  const [y, m, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || day < 1 || day > 31) return null;
  return { y, m, day };
}

/**
 * A period as people say it: `Sep 22–28`, `Sep 29 – Oct 5`,
 * `Dec 29, 2025 – Jan 4, 2026`, or `Sep 22` for one day. Inputs are local
 * `YYYY-MM-DD` dates (the sheet's own calendar), so no timezone math happens.
 */
export function formatPeriodLabel(start: string, end: string): string {
  const a = parseLocalDate(start);
  const b = parseLocalDate(end);
  if (!a || !b) return start === end ? start : `${start} – ${end}`;
  const ma = MONTHS[a.m - 1];
  const mb = MONTHS[b.m - 1];
  if (a.y !== b.y) return `${ma} ${a.day}, ${a.y} – ${mb} ${b.day}, ${b.y}`;
  if (a.m !== b.m) return `${ma} ${a.day} – ${mb} ${b.day}`;
  if (a.day === b.day) return `${ma} ${a.day}`;
  return `${ma} ${a.day}–${b.day}`;
}

/** Hours as the time page shows them: `38h 15m`, `38h`, `45m`. Null when unknown. */
export function formatDurationLabel(
  seconds: number | null | undefined,
): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0)
    return null;
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** One line of user text, cut to TIME_SNIPPET_MAX_CHARS. */
function snippetOf(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  return text.length > TIME_SNIPPET_MAX_CHARS
    ? `${text.slice(0, TIME_SNIPPET_MAX_CHARS - 3)}...`
    : text;
}

/** `{timesheet_id, scope_kind, team_id?, workspace_id?, period_start, period_end, total_seconds}`. */
function sheetKeys(sheet: TimesheetRow): Record<string, unknown> {
  return {
    timesheet_id: sheet.id,
    scope_kind: sheet.scope_kind,
    ...(sheet.team_id ? { team_id: sheet.team_id } : {}),
    ...(sheet.workspace_id ? { workspace_id: sheet.workspace_id } : {}),
    period_start: sheet.period_start,
    period_end: sheet.period_end,
    total_seconds: sheet.total_seconds ?? null,
  };
}

function sheetMessage(
  type: SheetNotificationType,
  sheet: TimesheetRow,
  actor: string | null,
): string {
  const period = formatPeriodLabel(sheet.period_start, sheet.period_end);
  const scope = clean(sheet.scope_label_snapshot);
  const forScope = scope ? ` for ${scope}` : '';
  const yourSheet = scope
    ? `Your ${scope} timesheet for ${period}`
    : `Your timesheet for ${period}`;
  const note = snippetOf(sheet.decision_note);
  const withNote = note ? `: "${note}"` : '';
  const member =
    actor ?? clean(sheet.member_display_name_snapshot) ?? 'A teammate';

  switch (type) {
    case 'timesheet_submitted': {
      if (sheet.submission_kind === 'on_deletion') {
        return `The timesheet for ${period}${scope ? ` (${scope})` : ''} was sent for review when the account that logged it was deleted`;
      }
      const hours = formatDurationLabel(sheet.total_seconds);
      return hours
        ? `${member} sent ${hours}${forScope} · ${period}`
        : `${member} sent a timesheet${forScope} · ${period}`;
    }
    case 'timesheet_returned':
      return `${actor ?? 'Your approver'} returned ${period}${forScope}${withNote}`;
    case 'timesheet_approved': {
      const hours = formatDurationLabel(
        sheet.payable_seconds ?? sheet.total_seconds,
      );
      const suffix = hours ? ` (${hours})` : '';
      return actor
        ? `${actor} approved ${period}${forScope}${suffix}`
        : `${yourSheet} was approved${suffix}`;
    }
    case 'timesheet_reopened':
      return actor
        ? `${actor} reopened ${period}${forScope}${withNote}`
        : `${yourSheet} was reopened${withNote}`;
    case 'timesheet_reopen_requested':
      return `${member} asked to reopen ${period}${forScope}`;
    case 'timesheet_reminder':
      return sheet.status === 'returned'
        ? `${yourSheet} is waiting for your changes`
        : `${yourSheet} is ready to submit`;
  }
}

const SHEET_FALLBACK: Record<SheetNotificationType, string> = {
  timesheet_submitted: 'A timesheet was sent to you for review',
  timesheet_returned: 'Your timesheet was returned',
  timesheet_approved: 'Your timesheet was approved',
  timesheet_reopened: 'Your timesheet was reopened',
  timesheet_reopen_requested: 'Someone asked to reopen a timesheet',
  timesheet_reminder: 'Your timesheet is ready to submit',
};

/**
 * Pure; exported for the no-money spec. Never puts a digit-bearing amount or a
 * currency in message.
 *
 * Inputs by type: timesheet types read `sheet` (its `decision_note` is the
 * quoted note on return and reopen) and `actorName` (the member's name for
 * `timesheet_submitted` and `timesheet_reopen_requested`, the decider's name
 * otherwise); timer types read `entryId` and `reason`; `time_payout_recorded`
 * reads `payoutId` and `entryCount`; `time_log_comment_added` reads `entryId`,
 * `actorName` and `snippet` (the comment body).
 *
 * Besides the identifying keys, content carries the presentation-only keys
 * `message`, `actor_name` and `context_title` (the sheet's scope label), which
 * the FCM data map skips (PRESENTATION_ONLY_CONTENT_KEYS).
 */
export function buildTimeContent(
  type: TimeNotificationType,
  i: {
    sheet?: TimesheetRow;
    entryId?: string;
    reason?: FlaggedReason;
    payoutId?: string;
    entryCount?: number;
    actorName?: string | null;
    snippet?: string;
  },
): Record<string, unknown> {
  const actor = clean(i.actorName);
  const entryKey = i.entryId ? { entry_id: i.entryId } : {};

  switch (type) {
    case 'timer_running_long':
      return {
        ...entryKey,
        message: `Your timer has been running for over ${LONG_TIMER_HOURS} hours. Stop it if you're done.`,
      };
    case 'timer_auto_stopped':
      return {
        ...entryKey,
        ...(i.reason ? { reason: i.reason } : {}),
        message:
          i.reason === 'stopped_by_assignment_end'
            ? 'Your timer was stopped because the assignment it was logging to ended. Check the end time.'
            : `Your timer was stopped after ${AUTO_STOP_HOURS} hours. Check the end time.`,
      };
    case 'time_payout_recorded':
      return {
        ...(i.payoutId ? { payout_id: i.payoutId } : {}),
        entry_count: i.entryCount ?? null,
        message: TIME_PAYOUT_MESSAGE,
      };
    case 'time_log_comment_added': {
      const quote = snippetOf(i.snippet);
      const who = actor ?? 'Someone';
      return {
        ...entryKey,
        ...(actor ? { actor_name: actor } : {}),
        message: quote
          ? `${who} commented on a time entry: "${quote}"`
          : `${who} commented on a time entry`,
      };
    }
    default: {
      if (!i.sheet) return { message: SHEET_FALLBACK[type] };
      const scope = clean(i.sheet.scope_label_snapshot);
      return {
        ...sheetKeys(i.sheet),
        ...(actor ? { actor_name: actor } : {}),
        ...(scope ? { context_title: scope } : {}),
        message: sheetMessage(type, i.sheet, actor),
      };
    }
  }
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** `RETURNS SETOF uuid` through PostgREST: an array of ids (or of one-key rows). */
function idsFrom(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row: unknown) =>
      typeof row === 'string'
        ? row
        : row && typeof row === 'object'
          ? Object.values(row as Record<string, unknown>).find(isId)
          : undefined,
    )
    .filter(isId);
}

interface Outgoing {
  actorId: string | null;
  content: Record<string, unknown>;
  link: string;
}

@Injectable()
export class TimeNotificationsService {
  private readonly logger = new Logger(TimeNotificationsService.name);
  /** notification_types ids are seed data; cache them per process for hasNotified. */
  private readonly typeIds = new Map<string, string>();
  private lastMarkerWarnAt = 0;

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly notifications: NotificationsService,
    // Optional (W1 review F1), so harnesses keep compiling. Null
    // (no Upstash credentials) means hasNotified probes the bell rows only.
    @Optional()
    @Inject(UPSTASH_REDIS_CLIENT)
    private readonly redis: Redis | null = null,
  ) {}
  // D51: every method below except hasNotified never throws (catch + warn), is awaited by callers, and fans out
  // with Promise.all; a failed notification must never turn a committed transition, payout or comment into an error.

  /**
   * `timesheet_submitted` to each decider (60-minute email). Replaces any older
   * row for the same sheet, and clears the member's `timesheet_reminder`.
   */
  async sheetSubmitted(
    sheet: TimesheetRow,
    deciderIds: string[],
    actorId: string | null,
  ): Promise<void> {
    await this.guard('timesheet_submitted', sheet.id, async () => {
      const member = sheet.member_user_id;
      // Independent of the fan-out below, so it runs (and is awaited) even if
      // the recipient lookup fails.
      const clearReminder = member
        ? this.clear(member, 'timesheet_reminder', 'timesheet_id', sheet.id)
        : Promise.resolve();
      try {
        const [recipients, memberName] = await Promise.all([
          this.liveRecipients(deciderIds, [actorId, member]),
          sheet.submission_kind === 'on_deletion'
            ? Promise.resolve(null)
            : this.nameOf(member),
        ]);
        const out: Outgoing = {
          actorId,
          content: buildTimeContent('timesheet_submitted', {
            sheet,
            actorName: memberName,
          }),
          link: timePath({ timesheetId: sheet.id }),
        };
        await Promise.all(
          recipients.map((userId) =>
            this.replace(userId, 'timesheet_submitted', sheet.id, out),
          ),
        );
      } finally {
        await clearReminder;
      }
    });
  }

  /**
   * After a decision:
   * - approve / return / withdraw clear every decider's `timesheet_submitted`
   *   (and the actor's, should the caller's list be stale);
   * - reopen clears every decider's `timesheet_reopen_requested`;
   * - approve tells the member (never for a `self` sheet), return tells the
   *   member (replacing an older return notice for the sheet), reopen tells the
   *   member, withdraw tells nobody.
   *
   * Pass the deciders as they were BEFORE the transition: a sheet back in
   * `open` has no approver scope, so `time_timesheet_deciders` is empty then.
   */
  async sheetDecided(
    sheet: TimesheetRow,
    action: 'approve' | 'return' | 'reopen' | 'withdraw',
    actorId: string | null,
    deciderIds: string[],
  ): Promise<void> {
    await this.guard(`timesheet_${action}`, sheet.id, async () => {
      const clearType =
        action === 'reopen'
          ? 'timesheet_reopen_requested'
          : 'timesheet_submitted';
      // clear() never rejects; awaited in `finally` so a failed fan-out below
      // cannot leave them running after the response.
      const clears = Promise.all(
        [...new Set([...deciderIds, actorId].filter(isId))].map((userId) =>
          this.clear(userId, clearType, 'timesheet_id', sheet.id),
        ),
      );
      try {
        if (action === 'withdraw') return;

        const type: SheetNotificationType =
          action === 'approve'
            ? 'timesheet_approved'
            : action === 'return'
              ? 'timesheet_returned'
              : 'timesheet_reopened';
        const selfDecided =
          action === 'approve' &&
          (sheet.approver_scope === 'self' || sheet.decision_kind === 'self');
        const [recipients, actorName] = await Promise.all([
          selfDecided
            ? Promise.resolve([] as string[])
            : this.liveRecipients([sheet.member_user_id], [actorId]),
          this.nameOf(actorId),
        ]);
        const out: Outgoing = {
          actorId,
          content: buildTimeContent(type, { sheet, actorName }),
          link: timePath({ timesheetId: sheet.id }),
        };
        await Promise.all(
          recipients.map((userId) =>
            action === 'return'
              ? this.replace(userId, type, sheet.id, out)
              : this.send(userId, type, out),
          ),
        );
      } finally {
        await clears;
      }
    });
  }

  /** `timesheet_reopen_requested` to each decider; one live row per sheet. */
  async reopenRequested(
    sheet: TimesheetRow,
    deciderIds: string[],
    actorId: string,
  ): Promise<void> {
    await this.guard('timesheet_reopen_requested', sheet.id, async () => {
      const [recipients, actorName] = await Promise.all([
        this.liveRecipients(deciderIds, [actorId, sheet.member_user_id]),
        this.nameOf(actorId),
      ]);
      const out: Outgoing = {
        actorId,
        content: buildTimeContent('timesheet_reopen_requested', {
          sheet,
          actorName,
        }),
        link: timePath({ timesheetId: sheet.id }),
      };
      await Promise.all(
        recipients.map((userId) =>
          this.replace(userId, 'timesheet_reopen_requested', sheet.id, out),
        ),
      );
    });
  }

  /**
   * `timesheet_reminder` to the member. Cron idempotency is the caller's
   * (`hasNotified`); a successful send leaves the marker it reads.
   */
  async reminder(sheet: TimesheetRow): Promise<void> {
    await this.guard('timesheet_reminder', sheet.id, async () => {
      const recipients = await this.liveRecipients([sheet.member_user_id], []);
      const out: Outgoing = {
        actorId: null,
        content: buildTimeContent('timesheet_reminder', { sheet }),
        link: timePath({ timesheetId: sheet.id }),
      };
      await Promise.all(
        recipients.map((userId) =>
          this.sendOnce(userId, 'timesheet_reminder', sheet.id, out),
        ),
      );
    });
  }

  /**
   * `timer_running_long` to the member; content `{entry_id}` (cron job 2 keys
   * on it, and a successful send leaves the marker `hasNotified` reads).
   */
  async timerRunningLong(
    entry: Pick<
      TimeEntryView,
      'id' | 'member_user_id' | 'context_kind' | 'team_id' | 'started_at'
    >,
  ): Promise<void> {
    await this.guard('timer_running_long', entry.id, async () => {
      const recipients = await this.liveRecipients([entry.member_user_id], []);
      if (recipients.length === 0) return;
      const out: Outgoing = {
        actorId: null,
        content: buildTimeContent('timer_running_long', { entryId: entry.id }),
        link: timePath({ entryId: entry.id }),
      };
      await Promise.all(
        recipients.map((userId) =>
          this.sendOnce(userId, 'timer_running_long', entry.id, out),
        ),
      );
    });
  }

  /**
   * `timer_auto_stopped` to the member, content `{entry_id, reason}`. A stop
   * also clears that entry's `timer_running_long` notice.
   */
  async timerAutoStopped(
    entry: Pick<
      TimeEntryView,
      'id' | 'member_user_id' | 'context_kind' | 'team_id'
    >,
    reason: FlaggedReason,
  ): Promise<void> {
    await this.guard('timer_auto_stopped', entry.id, async () => {
      const recipients = await this.liveRecipients([entry.member_user_id], []);
      if (recipients.length === 0) return;
      const out: Outgoing = {
        actorId: null,
        content: buildTimeContent('timer_auto_stopped', {
          entryId: entry.id,
          reason,
        }),
        link: timePath({ entryId: entry.id }),
      };
      await Promise.all(
        recipients.flatMap((userId) => [
          this.clear(userId, 'timer_running_long', 'entry_id', entry.id),
          this.send(userId, 'timer_auto_stopped', out),
        ]),
      );
    });
  }

  /**
   * Clears the member's `timer_running_long` notice for a stopped entry
   * ("clears on stop"). Additive to the §2.8 contract: the entries service's
   * stop path calls it; cron job 1 does not need to (`timerAutoStopped` clears).
   */
  async timerStopped(
    entry: Pick<TimeEntryView, 'id' | 'member_user_id'>,
  ): Promise<void> {
    await this.guard('timer_stopped', entry.id, async () => {
      if (!isId(entry.member_user_id)) return;
      await this.clear(
        entry.member_user_id,
        'timer_running_long',
        'entry_id',
        entry.id,
      );
    });
  }

  /**
   * `time_payout_recorded` to the member: "A payment was recorded for your
   * time", content `{payout_id, entry_count}`, no amount and no currency (E67).
   * The link is the bare Time page (D79): no amount, and no payout page on
   * native.
   */
  async payoutRecorded(
    p: { id: string; member_user_id: string; team_id: string },
    entryCount: number,
    actorId: string,
  ): Promise<void> {
    await this.guard('time_payout_recorded', p.id, async () => {
      const recipients = await this.liveRecipients(
        [p.member_user_id],
        [actorId],
      );
      if (recipients.length === 0) return;
      const out: Outgoing = {
        actorId,
        content: buildTimeContent('time_payout_recorded', {
          payoutId: p.id,
          entryCount,
        }),
        link: timePath(),
      };
      await Promise.all(
        recipients.map((userId) =>
          this.send(userId, 'time_payout_recorded', out),
        ),
      );
    });
  }

  /**
   * `time_log_comment_added`. Recipients are computed here: the member; for
   * non-personal entries also the sheet's deciders (`time_timesheet_deciders`),
   * the legacy reviewer while they can still view the sheet, and for
   * team-context entries the team's managers
   * (`teamManagerIds`, the D49 viewers); minus the actor and deleted accounts.
   * Personal entries notify the member only. A recipient lookup that fails
   * drops only its own recipients.
   */
  async commentAdded(
    entry: EntryAuthRow,
    comment: CommentRow,
    actorId: string,
  ): Promise<void> {
    await this.guard('time_log_comment_added', entry.id, async () => {
      const member = entry.member_user_id;
      const candidates: Array<string | null> = [member];
      if (entry.context_kind !== 'personal') {
        const teamId = entry.context_kind === 'team' ? entry.team_id : null;
        const sheetId = entry.timesheet_id;
        const groups = await Promise.all([
          sheetId
            ? this.soft('deciders', entry.id, () => this.sheetDeciders(sheetId))
            : Promise.resolve([] as string[]),
          this.soft('legacy_reviewer', entry.id, () =>
            this.legacyReviewer(entry.id, sheetId),
          ),
          teamId
            ? this.soft('team_managers', entry.id, () =>
                teamManagerIds(this.sb, teamId),
              )
            : Promise.resolve([] as string[]),
        ]);
        for (const group of groups) candidates.push(...group);
      }

      const [recipients, actorName] = await Promise.all([
        this.liveRecipients(candidates, [actorId]),
        this.nameOf(actorId),
      ]);
      if (recipients.length === 0) return;

      const content = {
        ...buildTimeContent('time_log_comment_added', {
          entryId: entry.id,
          actorName,
          snippet: comment.body,
        }),
        comment_id: comment.id,
      };
      // D79: one link for every recipient; the entry detail opens over /time.
      const link = timePath({ entryId: entry.id });
      await Promise.all(
        recipients.map((userId) =>
          this.send(userId, 'time_log_comment_added', {
            actorId,
            content,
            link,
          }),
        ),
      );
    });
  }

  /**
   * Cron idempotency: a notification of `type` for `userId` whose
   * content->>key = value exists. For the notify-once types
   * (`timesheet_reminder` by `timesheet_id`, `timer_running_long` by
   * `entry_id`) the Redis marker counts too, so a bell row the user deleted
   * is not sent again every hour. A marker read that fails falls back to the
   * row probe.
   */
  async hasNotified(
    userId: string,
    type: TimeNotificationType,
    key: string,
    value: string,
  ): Promise<boolean> {
    if (!CONTENT_KEY.test(key)) {
      throw new InternalServerErrorException(
        `hasNotified: invalid content key "${key}"`,
      );
    }
    if (await this.isMarked(userId, type, key, value)) return true;
    const typeId = await this.typeId(type);
    if (!typeId) return false;
    const { data, error } = await this.sb
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('type_id', typeId)
      .eq(`content->>${key}`, value)
      .limit(1);
    if (error) {
      this.logger.warn(
        `time_notify_probe_failed type=${type} key=${key}: ${errorText(error)}`,
      );
      throw new InternalServerErrorException("Couldn't check notifications.");
    }
    return Array.isArray(data) && data.length > 0;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** D51: the method-level catch. Logs, never rethrows. */
  private async guard(
    op: string,
    ref: string,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.warn(
        `time_notify_failed op=${op} ref=${ref}: ${errorText(err)}`,
      );
    }
  }

  /** A recipient lookup that degrades to "nobody from this source". */
  private async soft(
    source: string,
    ref: string,
    run: () => Promise<string[]>,
  ): Promise<string[]> {
    try {
      return await run();
    } catch (err) {
      this.logger.warn(
        `time_notify_recipients_failed source=${source} ref=${ref}: ${errorText(err)}`,
      );
      return [];
    }
  }

  /**
   * Distinct ids minus `exclude` (the actor, and the member where the member
   * must not get the row), minus deleted accounts. A failed profiles read
   * throws, so the method's guard drops the whole fan-out rather than guess.
   */
  private async liveRecipients(
    ids: ReadonlyArray<string | null | undefined>,
    exclude: ReadonlyArray<string | null | undefined>,
  ): Promise<string[]> {
    const skip = new Set(exclude.filter(isId));
    const candidates = [...new Set(ids.filter(isId))].filter(
      (id) => !skip.has(id),
    );
    if (candidates.length === 0) return [];
    const { data, error } = await this.sb
      .from('profiles')
      .select('id')
      .in('id', candidates)
      .is('deleted_at', null);
    if (error) throw new Error(`profiles read failed: ${errorText(error)}`);
    const live = new Set(
      ((data as Array<{ id: string }> | null) ?? []).map((row) => row.id),
    );
    return candidates.filter((id) => live.has(id));
  }

  private async nameOf(
    userId: string | null | undefined,
  ): Promise<string | null> {
    if (!isId(userId)) return null;
    try {
      return await this.notifications.resolveActorName(userId);
    } catch {
      return null;
    }
  }

  private async sheetDeciders(sheetId: string): Promise<string[]> {
    const { data, error } = (await this.sb.rpc('time_timesheet_deciders', {
      p_timesheet_id: sheetId,
    })) as { data: unknown; error: { message: string } | null };
    if (error) throw new Error(errorText(error));
    return idsFrom(data);
  }

  /**
   * The person who reviewed the entry under the old per-log flow, only while
   * they can still open its sheet (`can_view_timesheet`). Someone who lost
   * access would get a 404 on the entry, so they get no comment text either
   * (W1 review Q4). A current team manager comes in through `teamManagerIds`,
   * and a sheetless entry has no sheet to check, so it adds nobody here.
   */
  private async legacyReviewer(
    entryId: string,
    sheetId: string | null,
  ): Promise<string[]> {
    if (!sheetId) return [];
    const { data, error } = await this.sb
      .from('time_entries')
      .select('legacy_reviewed_by')
      .eq('id', entryId)
      .maybeSingle();
    if (error) throw new Error(errorText(error));
    const reviewer = (data as { legacy_reviewed_by?: string | null } | null)
      ?.legacy_reviewed_by;
    if (!isId(reviewer)) return [];
    const { data: canView, error: viewError } = (await this.sb.rpc(
      'can_view_timesheet',
      { p_timesheet_id: sheetId, p_user_id: reviewer },
    )) as { data: unknown; error: { message: string } | null };
    if (viewError) throw new Error(errorText(viewError));
    return canView === true ? [reviewer] : [];
  }

  private async typeId(name: string): Promise<string | null> {
    const cached = this.typeIds.get(name);
    if (cached) return cached;
    const { data, error } = await this.sb
      .from('notification_types')
      .select('id')
      .eq('name', name)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `time_notify_type_lookup_failed type=${name}: ${errorText(error)}`,
      );
      throw new InternalServerErrorException("Couldn't check notifications.");
    }
    const id = (data as { id?: string } | null)?.id ?? null;
    if (id) this.typeIds.set(name, id);
    return id;
  }

  /** One row per recipient per sheet: drop the older row of this type, then send. */
  private async replace(
    userId: string,
    type: TimeNotificationType,
    sheetId: string,
    out: Outgoing,
  ): Promise<void> {
    await this.clear(userId, type, 'timesheet_id', sheetId);
    await this.send(userId, type, out);
  }

  /** Clears the bell rows, and for a notify-once type its marker too. Never rejects. */
  private async clear(
    userId: string,
    type: TimeNotificationType,
    key: string,
    value: string,
  ): Promise<void> {
    await Promise.all([
      (async () => {
        try {
          await this.notifications.clearForSubject(userId, type, key, value);
        } catch (err) {
          this.logger.warn(
            `time_notify_clear_failed type=${type} ${key}=${value}: ${errorText(err)}`,
          );
        }
      })(),
      this.unmark(userId, type, key, value),
    ]);
  }

  /** project_id stays null: sheets span projects, and entry rows follow suit. True when the row was created. */
  private async send(
    userId: string,
    type: TimeNotificationType,
    out: Outgoing,
  ): Promise<boolean> {
    try {
      await this.notifications.createNotification({
        user_id: userId,
        type_name: type,
        actor_id: out.actorId ?? undefined,
        content: out.content,
        link_url: out.link,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `time_notify_send_failed type=${type} user=${userId}: ${errorText(err)}`,
      );
      return false;
    }
  }

  /** A notify-once send: the marker is left only after the row was created, so a failed send is retried. */
  private async sendOnce(
    userId: string,
    type: TimeNotificationType,
    value: string,
    out: Outgoing,
  ): Promise<void> {
    const key = NOTIFY_ONCE_KEYS[type];
    if (!(await this.send(userId, type, out)) || !key) return;
    await this.mark(userId, type, key, value);
  }

  /** The marker applies only to the notify-once type with its own content key. */
  private markerKey(
    userId: string,
    type: TimeNotificationType,
    key: string,
    value: string,
  ): string | null {
    if (!this.redis || NOTIFY_ONCE_KEYS[type] !== key) return null;
    return notifiedMarkerKey(type, userId, key, value);
  }

  private async isMarked(
    userId: string,
    type: TimeNotificationType,
    key: string,
    value: string,
  ): Promise<boolean> {
    const marker = this.markerKey(userId, type, key, value);
    if (!marker || !this.redis) return false;
    try {
      const found = await this.redis.get(marker);
      return found !== null && found !== undefined;
    } catch (err) {
      this.warnMarker('read', type, err);
      return false;
    }
  }

  private async mark(
    userId: string,
    type: TimeNotificationType,
    key: string,
    value: string,
  ): Promise<void> {
    const marker = this.markerKey(userId, type, key, value);
    if (!marker || !this.redis) return;
    try {
      await this.redis.set(marker, '1', { ex: NOTIFIED_MARKER_TTL_SECONDS });
    } catch (err) {
      this.warnMarker('write', type, err);
    }
  }

  private async unmark(
    userId: string,
    type: TimeNotificationType,
    key: string,
    value: string,
  ): Promise<void> {
    const marker = this.markerKey(userId, type, key, value);
    if (!marker || !this.redis) return;
    try {
      await this.redis.del(marker);
    } catch (err) {
      this.warnMarker('clear', type, err);
    }
  }

  private warnMarker(
    op: 'read' | 'write' | 'clear',
    type: TimeNotificationType,
    err: unknown,
  ): void {
    const now = Date.now();
    if (now - this.lastMarkerWarnAt < MARKER_WARN_INTERVAL_MS) return;
    this.lastMarkerWarnAt = now;
    this.logger.warn(
      `time_notify_marker_${op}_failed type=${type}: ${errorText(err)}`,
    );
  }
}
