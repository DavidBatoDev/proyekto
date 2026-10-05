// backend/src/modules/execution/time/time-errors.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export type TimeErrorCode =
  // 403
  | 'NO_LOGGING_CONTEXT'
  | 'MANUAL_ENTRIES_DISABLED'
  | 'TIME_ENTRY_NO_PROJECT_ACCESS'
  | 'TIME_ENTRY_NOT_ON_PROJECT_TEAM'
  | 'TIME_ENTRY_NOT_WORKSPACE_MEMBER'
  | 'PAYOUT_SELF_NOT_ALLOWED'
  // 404
  | 'TIME_NOT_FOUND'
  | 'TIMESHEET_NOT_FOUND'
  // 409
  | 'LOGGING_FOR_REQUIRED'
  | 'TIMESHEET_LOCKED'
  | 'TIMER_ALREADY_RUNNING'
  | 'TIMER_NOT_RUNNING'
  | 'TIMESHEET_HAS_SETTLED_ENTRIES'
  | 'STALE_REVISION'
  | 'TIMESHEET_TRANSITION_INVALID'
  | 'LEGACY_CONTRACT_AMBIGUOUS'
  | 'APPROVED_TIME_ASSIGNMENT_LOCKED'
  | 'INVOICE_TIME_ENTRY_NOT_BILLABLE'
  // 410
  | 'TIMESHEETS_REPLACED_REVIEW'
  | 'APP_UPDATE_REQUIRED'
  // 422
  | 'LOGGING_FOR_INVALID'
  | 'RETROACTIVE_WINDOW'
  | 'HOUR_CAP_EXCEEDED'
  | 'TEAM_RATES_REQUIRE_APPROVAL'
  | 'FIXED_RATE_NOT_PAYABLE_BY_ENTRY'
  | 'ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED'
  | 'ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER'
  | 'TIME_POLICY_INVALID'
  | 'WORK_ITEM_INVALID'
  | 'TIME_LOG_ASSIGNMENT_INVALID'
  | 'TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW';
// DB codes TIME_LOG_ASSIGNMENT_NOT_FOUND / _PROJECT_MISMATCH / _WORKER_MISMATCH (trg_20, 20260814021000:441-487)
// map to 422 TIME_LOG_ASSIGNMENT_INVALID with { detail: <original code> }. ENGAGEMENT_ASSIGNMENT_HAS_RUNNING_TIMER
// disappears in M3 (A3 stops instead of raising).

export const TIME_ERROR_STATUS: Record<
  TimeErrorCode,
  403 | 404 | 409 | 410 | 422
> = {
  NO_LOGGING_CONTEXT: 403,
  MANUAL_ENTRIES_DISABLED: 403,
  TIME_ENTRY_NO_PROJECT_ACCESS: 403,
  TIME_ENTRY_NOT_ON_PROJECT_TEAM: 403,
  TIME_ENTRY_NOT_WORKSPACE_MEMBER: 403,
  PAYOUT_SELF_NOT_ALLOWED: 403,
  TIME_NOT_FOUND: 404,
  TIMESHEET_NOT_FOUND: 404,
  LOGGING_FOR_REQUIRED: 409,
  TIMESHEET_LOCKED: 409,
  TIMER_ALREADY_RUNNING: 409,
  TIMER_NOT_RUNNING: 409,
  TIMESHEET_HAS_SETTLED_ENTRIES: 409,
  STALE_REVISION: 409,
  TIMESHEET_TRANSITION_INVALID: 409,
  LEGACY_CONTRACT_AMBIGUOUS: 409,
  APPROVED_TIME_ASSIGNMENT_LOCKED: 409,
  INVOICE_TIME_ENTRY_NOT_BILLABLE: 409,
  TIMESHEETS_REPLACED_REVIEW: 410,
  APP_UPDATE_REQUIRED: 410,
  LOGGING_FOR_INVALID: 422,
  RETROACTIVE_WINDOW: 422,
  HOUR_CAP_EXCEEDED: 422,
  TEAM_RATES_REQUIRE_APPROVAL: 422,
  FIXED_RATE_NOT_PAYABLE_BY_ENTRY: 422,
  ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED: 422,
  ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER: 422,
  TIME_POLICY_INVALID: 422,
  WORK_ITEM_INVALID: 422,
  TIME_LOG_ASSIGNMENT_INVALID: 422,
  TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW: 422,
};

// Declared before TIME_ERROR_MESSAGE, which reads ALIAS_REVIEW_GONE_MESSAGE at module load.
export const RUNNING_TIMER_MESSAGE =
  'You already have a running timer. Stop it before starting a new one.';
export const ALIAS_LOCKED_MESSAGE = (native: boolean): string =>
  "This week was sent for approval, so it can't be changed here. " +
  (native
    ? 'Update the app to see timesheets.'
    : 'Reload Proyekto to see timesheets.');
export const ALIAS_REVIEW_GONE_MESSAGE = (native: boolean): string =>
  native
    ? 'Update the app to approve timesheets.'
    : 'Approvals now happen by timesheet. Reload Proyekto.';

/** Default copy (ux.md "Error codes as shown to people"); callers may pass a sharper message.
 *  A full Record (critic CC8): DB-raised sentinels have no caller message, so a missing key would toast the bare
 *  code. TIMESHEET_LOCKED {period} uses "This week's <label> timesheet is submitted. Withdraw it to add time."
 *  when the caller knows the label (mapTimeDbError does not, see PERIOD_LOCKED_MESSAGE). */
export const TIME_ERROR_MESSAGE: Record<TimeErrorCode, string> = {
  NO_LOGGING_CONTEXT: "You can't log time on this project.",
  LOGGING_FOR_INVALID: "That choice isn't available any more. Pick again.",
  LOGGING_FOR_REQUIRED: 'Choose who this time is for.',
  TIME_ENTRY_NO_PROJECT_ACCESS: "You don't have access to this project.",
  TIMESHEET_LOCKED: 'This entry is on a submitted or approved timesheet.',
  TIMER_ALREADY_RUNNING: RUNNING_TIMER_MESSAGE,
  TIMER_NOT_RUNNING: 'This timer is not running.',
  STALE_REVISION: 'This timesheet changed. Reload to see the latest version.',
  TIME_NOT_FOUND: "This time entry doesn't exist or you can't open it.",
  TIMESHEET_NOT_FOUND: "This timesheet doesn't exist or you can't open it.",
  PAYOUT_SELF_NOT_ALLOWED:
    'Someone else on the team has to record your payment.',
  FIXED_RATE_NOT_PAYABLE_BY_ENTRY:
    'Fixed-fee time is paid as a manual payment, not by entry.',
  LEGACY_CONTRACT_AMBIGUOUS:
    "More than one team could bill hours on this contract. Set the provider's team on the contract first.",
  ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER:
    "This agreement's hirer doesn't deliver the client agreement on this project.",
  TIMESHEET_HAS_SETTLED_ENTRIES:
    'This timesheet has time that was already paid or billed, so it cannot be reopened.',
  TIME_ENTRY_NOT_ON_PROJECT_TEAM: "You're not on this team for this project.",
  TIME_ENTRY_NOT_WORKSPACE_MEMBER:
    'You need a seat in this workspace to log time for it.',
  MANUAL_ENTRIES_DISABLED: 'Manual time is off here.',
  RETROACTIVE_WINDOW: 'This is further back than time can be added here.',
  HOUR_CAP_EXCEEDED: 'This goes past your hour limit for this team.',
  TEAM_RATES_REQUIRE_APPROVAL: 'Teams that pay member rates must approve time.',
  TIME_POLICY_INVALID: "Those time settings aren't valid.",
  WORK_ITEM_INVALID: 'Pick a task or a work item.',
  TIME_LOG_ASSIGNMENT_INVALID: "This time is outside the agreement's dates.",
  TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW:
    "This time is outside the agreement's dates.",
  APPROVED_TIME_ASSIGNMENT_LOCKED: 'This agreement has approved time.',
  INVOICE_TIME_ENTRY_NOT_BILLABLE: "This time can't be billed.",
  TIMESHEET_TRANSITION_INVALID: "This timesheet can't do that right now.",
  ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED:
    'Choose the client agreement this work belongs to.',
  TIMESHEETS_REPLACED_REVIEW: ALIAS_REVIEW_GONE_MESSAGE(false),
  APP_UPDATE_REQUIRED: 'Update the app to keep tracking time.',
};

/** TIMESHEET_LOCKED {period} when the sheet label is unknown (mapTimeDbError). */
const PERIOD_LOCKED_MESSAGE = {
  submitted: "This period's timesheet is submitted. Withdraw it to add time.",
  other: "This period's timesheet is approved, so its time can't change.",
} as const;

/** The 404 copy for a scope miss (report scope, team, workspace, guest). */
const SCOPE_NOT_FOUND_MESSAGE = "This doesn't exist or you can't open it.";

/**
 * The unique indexes behind the running-timer rule: one per person (M1) and the
 * older one per (project, member). Two concurrent starts on the same project hit
 * the older one first. M5 renames it with the other index names.
 */
const RUNNING_TIMER_INDEXES = [
  'uq_time_entries_one_running_per_member',
  'uq_task_time_logs_one_active_per_member_project',
  'uq_time_entries_one_active_per_member_project',
];

/**
 * Keys an extras object must never carry. HttpExceptionFilter writes `message`, `status`, `path` and
 * `timestamp` over the extras (D50) and drops `statusCode`; `code` is the error's own code.
 */
const RESERVED_EXTRA_KEYS = new Set([
  'code',
  'message',
  'status',
  'statusCode',
  'path',
  'timestamp',
]);

function safeExtras(
  extras: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!extras) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extras)) {
    if (!RESERVED_EXTRA_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/** HttpException whose body is { code, message, ...extras } (HttpExceptionFilter keeps extras).
 *  The instance is the Nest subclass for the status (ForbiddenException, NotFoundException, ConflictException,
 *  GoneException, UnprocessableEntityException). Reserved keys in `extras` are dropped (D50). */
export function timeError(
  code: TimeErrorCode,
  message?: string,
  extras?: Record<string, unknown>,
): HttpException {
  const body = {
    code,
    message: message ?? TIME_ERROR_MESSAGE[code],
    ...safeExtras(extras),
  };
  switch (TIME_ERROR_STATUS[code]) {
    case 403:
      return new ForbiddenException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    case 410:
      return new GoneException(body);
    default:
      return new UnprocessableEntityException(body);
  }
}

/** TIME_NOT_FOUND / TIMESHEET_NOT_FOUND. */
export function timeNotFound(
  kind: 'entry' | 'timesheet' | 'scope' = 'entry',
): HttpException {
  if (kind === 'timesheet') return timeError('TIMESHEET_NOT_FOUND');
  if (kind === 'scope')
    return timeError('TIME_NOT_FOUND', SCOPE_NOT_FOUND_MESSAGE);
  return timeError('TIME_NOT_FOUND');
}

/** A PostgREST error as returned by supabase-js. */
export interface PgErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

export interface MapContext {
  /** Alias call: running-timer conflict → 400 RUNNING_TIMER_MESSAGE; locked → origin-aware copy. */
  alias?: { native: boolean };
}

interface ParsedDetail {
  /** DETAIL parsed as a JSON object. */
  json?: Record<string, unknown>;
  /** DETAIL that is not a JSON object, verbatim. */
  text?: string;
}

function parseDetail(details: string | null | undefined): ParsedDetail {
  if (typeof details !== 'string' || details.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return { json: parsed as Record<string, unknown> };
    }
  } catch {
    // not JSON: carried as text
  }
  return { text: details };
}

/** The leading sentinel token of a Postgres message: `TIME_ENTRY_LOCKED`, never `M1` of "M1 precheck: …". */
const SENTINEL_RE = /^\s*([A-Z][A-Z0-9_]+)(?![A-Za-z0-9_])/;

function leadingSentinel(message: string | undefined): string | null {
  const match = SENTINEL_RE.exec(message ?? '');
  return match ? match[1] : null;
}

/** JSON DETAIL as extras; the sheet `status` becomes `sheet_status` (D50); text DETAIL as { detail }. */
function detailExtras(detail: ParsedDetail): Record<string, unknown> {
  if (detail.json) {
    const { status, ...rest } = detail.json;
    return status === undefined ? rest : { ...rest, sheet_status: status };
  }
  if (detail.text !== undefined) return { detail: detail.text };
  return {};
}

const TIME_LOG_ASSIGNMENT_CODES = new Set([
  'TIME_LOG_ASSIGNMENT_INVALID',
  'TIME_LOG_ASSIGNMENT_NOT_FOUND',
  'TIME_LOG_ASSIGNMENT_PROJECT_MISMATCH',
  'TIME_LOG_ASSIGNMENT_WORKER_MISMATCH',
]);

function isTimeErrorCode(code: string): code is TimeErrorCode {
  return Object.hasOwn(TIME_ERROR_STATUS, code);
}

/**
 * Maps DB sentinels to HTTP. Recognises:
 *   23505 on a running-timer index (RUNNING_TIMER_INDEXES) → 409 TIMER_ALREADY_RUNNING (alias: 400, RUNNING_TIMER_MESSAGE)
 *   TIME_ENTRY_LOCKED   → 409 TIMESHEET_LOCKED { reason: 'entry', lock: <db reason>, entry_id }
 *   TIME_PERIOD_LOCKED  → 409 TIMESHEET_LOCKED { reason: 'period', timesheet_id, sheet_status }   (never `status`:
 *                          HttpExceptionFilter overwrites it with the HTTP code, D50)
 *   TIMESHEET_NOT_FOUND → 404; TIMESHEET_DECIDER_INVALID → 409 TIMESHEET_TRANSITION_INVALID { reason: 'not_allowed' }
 *   TIMESHEET_IMMUTABLE, TIMESHEET_DELETE_FORBIDDEN (tg_timesheets_guard) → 409 TIMESHEET_TRANSITION_INVALID { reason: 'state' }
 *   TIMESHEET_TRANSITION_INVALID with a non-JSON DETAIL (the guard's 'open -> approved') → 409 { reason: 'state', detail }
 *   TIMESHEET_SCOPE_REQUIRED (trg_30, time_ensure_timesheet) → 422 LOGGING_FOR_INVALID { detail }
 *   TIMESHEET_ENSURE_FAILED → null (a logged 500: invariant failure)
 *   STALE_REVISION, TIMESHEET_TRANSITION_INVALID, TIMESHEET_HAS_SETTLED_ENTRIES → 409 with DETAIL json as extras
 *   TIME_ENTRY_NO_PROJECT_ACCESS / _NOT_ON_PROJECT_TEAM / _NOT_WORKSPACE_MEMBER → 403
 *   LOGGING_FOR_INVALID, TIME_LOG_ASSIGNMENT_*, TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW, TIME_POLICY_INVALID,
 *   TEAM_RATES_REQUIRE_APPROVAL, FIXED_RATE_NOT_PAYABLE_BY_ENTRY, ASSIGNMENT_* → 422
 *   APPROVED_TIME_ASSIGNMENT_LOCKED, INVOICE_TIME_ENTRY_NOT_BILLABLE → 409
 *   PAYOUT_SELF_NOT_ALLOWED → 403
 * The sentinel is the leading [A-Z][A-Z0-9_]+ token of `message`. DETAIL is parsed as JSON when it is JSON,
 * else carried as { detail: string }. Returns null when the error is not a time sentinel.
 * `ASSIGNMENT_*` covers the two codes in TimeErrorCode; the engagement-assignment guard's other codes are
 * not time sentinels (null).
 */
export function mapTimeDbError(
  err: PgErrorLike | null | undefined,
  ctx?: MapContext,
): HttpException | null {
  if (!err) return null;

  if (err.code === '23505') {
    const text = `${err.message ?? ''} ${err.details ?? ''}`;
    if (!RUNNING_TIMER_INDEXES.some((index) => text.includes(index)))
      return null;
    return ctx?.alias
      ? new BadRequestException(RUNNING_TIMER_MESSAGE)
      : timeError('TIMER_ALREADY_RUNNING');
  }

  const sentinel = leadingSentinel(err.message);
  if (!sentinel) return null;
  const detail = parseDetail(err.details);
  const json = detail.json ?? {};

  switch (sentinel) {
    case 'TIME_ENTRY_LOCKED':
      return timeError(
        'TIMESHEET_LOCKED',
        ctx?.alias ? ALIAS_LOCKED_MESSAGE(ctx.alias.native) : undefined,
        {
          reason: 'entry',
          lock: json.reason ?? null,
          entry_id: json.entry_id ?? null,
        },
      );
    case 'TIME_PERIOD_LOCKED': {
      const sheetStatus = json.status ?? null;
      const message = ctx?.alias
        ? ALIAS_LOCKED_MESSAGE(ctx.alias.native)
        : sheetStatus === 'submitted'
          ? PERIOD_LOCKED_MESSAGE.submitted
          : PERIOD_LOCKED_MESSAGE.other;
      return timeError('TIMESHEET_LOCKED', message, {
        reason: 'period',
        timesheet_id: json.timesheet_id ?? null,
        sheet_status: sheetStatus,
      });
    }
    case 'TIMESHEET_NOT_FOUND':
      return timeNotFound('timesheet');
    case 'TIMESHEET_DECIDER_INVALID':
      return timeError('TIMESHEET_TRANSITION_INVALID', undefined, {
        reason: 'not_allowed',
      });
    case 'TIMESHEET_IMMUTABLE':
    case 'TIMESHEET_DELETE_FORBIDDEN':
      return timeError('TIMESHEET_TRANSITION_INVALID', undefined, {
        reason: 'state',
      });
    case 'TIMESHEET_TRANSITION_INVALID': {
      if (detail.json) {
        const extras = detailExtras(detail);
        return timeError('TIMESHEET_TRANSITION_INVALID', undefined, {
          ...extras,
          reason: typeof extras.reason === 'string' ? extras.reason : 'state',
        });
      }
      return timeError(
        'TIMESHEET_TRANSITION_INVALID',
        undefined,
        detail.text !== undefined
          ? { reason: 'state', detail: detail.text }
          : { reason: 'state' },
      );
    }
    case 'TIMESHEET_SCOPE_REQUIRED':
      return timeError(
        'LOGGING_FOR_INVALID',
        undefined,
        detail.json
          ? { detail: detail.json }
          : detail.text !== undefined
            ? { detail: detail.text }
            : {},
      );
    case 'TIMESHEET_ENSURE_FAILED':
      return null;
    default:
      break;
  }

  if (TIME_LOG_ASSIGNMENT_CODES.has(sentinel)) {
    return timeError('TIME_LOG_ASSIGNMENT_INVALID', undefined, {
      detail: sentinel,
    });
  }
  if (isTimeErrorCode(sentinel)) {
    return timeError(sentinel, undefined, detailExtras(detail));
  }
  return null;
}

/** The body code of an unmapped database failure (D55). Not a TimeErrorCode: it is always a 500. */
export const TIME_INTERNAL_CODE = 'TIME_INTERNAL';
export const TIME_INTERNAL_MESSAGE =
  "Proyekto couldn't save this time. Try again.";

const dbLogger = new Logger('TimeDb');

/**
 * mapTimeDbError, else a logged 500 (D55). The Postgres code, message, detail and hint go to the log at error
 * level and never into the response: the body is { code: 'TIME_INTERNAL', message: TIME_INTERNAL_MESSAGE }.
 * (A plain `Error` would reach HttpExceptionFilter, which puts `exception.message` into the body.)
 */
export function throwTimeDb(err: PgErrorLike, ctx?: MapContext): never {
  const mapped = mapTimeDbError(err, ctx);
  if (mapped) throw mapped;
  dbLogger.error(
    `Unmapped database error: ${JSON.stringify({
      code: err?.code ?? null,
      message: err?.message ?? null,
      detail: err?.details ?? null,
      hint: err?.hint ?? null,
    })}`,
  );
  throw new InternalServerErrorException({
    code: TIME_INTERNAL_CODE,
    message: TIME_INTERNAL_MESSAGE,
  });
}

/** True for Postgres deadlock (40P01) — callers retry the statement once. */
export function isDeadlock(err: PgErrorLike | null | undefined): boolean {
  return err?.code === '40P01';
}
