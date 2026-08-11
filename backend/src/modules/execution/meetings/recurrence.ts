/**
 * Server-side recurrence expansion for meeting series.
 *
 * An RRULE is evaluated in *floating* (wall-clock) space by feeding rrule a
 * dtstart whose UTC components equal the wall-clock, then each occurrence is
 * converted to a real UTC instant in the series timezone via date-fns-tz — so
 * occurrences stay DST-correct (e.g. a 9am weekly meeting keeps landing at 9am
 * local across a DST boundary even though its UTC offset shifts).
 *
 * Pure and deterministic; the service layer owns persistence and horizon policy.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { RRule, rrulestr } from 'rrule';

export interface Occurrence {
  /** Nominal UTC slot start — the stable identity within a series. */
  recurrenceId: string;
  /** UTC start (equal to recurrenceId at materialization time). */
  scheduledAt: string;
}

export const DEFAULT_HORIZON_DAYS = 365;
export const MAX_OCCURRENCES = 200;

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** A Date whose UTC fields equal the wall-clock, for floating rrule expansion. */
function floatingFromWall(wall: string): Date {
  const m = wall.match(WALL_RE);
  if (!m) return new Date(Number.NaN);
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0));
}

/** The wall-clock string of a floating Date (inverse of floatingFromWall). */
function wallStringFromFloating(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function ruleWithTag(body: string): string {
  return body.startsWith('RRULE:') ? body : `RRULE:${body}`;
}

/** The wall-clock string ("YYYY-MM-DDTHH:MM:SS") of a UTC instant in a zone. */
export function wallFromUtc(iso: string, timezone: string): string {
  return formatInTimeZone(iso, timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

/** Normalized until/count mirrors from a rule body (informational columns). */
export function parseUntilCount(body: string): {
  until: string | null;
  count: number | null;
} {
  const opts = rrulestr(ruleWithTag(body)).origOptions;
  return {
    until: opts.until ? new Date(opts.until).toISOString() : null,
    count: typeof opts.count === 'number' ? opts.count : null,
  };
}

/**
 * Expand a rule into concrete occurrences within a horizon.
 * @param body        RFC-5545 rule body (no DTSTART line)
 * @param dtstartWall Naive wall-clock start ("YYYY-MM-DDTHH:MM:SS")
 * @param timezone    IANA zone the wall-clock is evaluated in
 * @param opts.fromWall  Only occurrences at/after this wall-clock (for horizon top-ups)
 * @param opts.horizonDays  How far past dtstart to materialize (default 365)
 * @param opts.max          Hard cap on occurrences returned (default 200)
 */
export function expandOccurrences(
  body: string,
  dtstartWall: string,
  timezone: string,
  opts: { fromWall?: string; horizonDays?: number; max?: number } = {},
): Occurrence[] {
  const dtstartFloating = floatingFromWall(dtstartWall);
  if (Number.isNaN(dtstartFloating.getTime())) return [];

  const parsed = rrulestr(ruleWithTag(body)).origOptions;
  const rule = new RRule({ ...parsed, dtstart: dtstartFloating });

  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const max = opts.max ?? MAX_OCCURRENCES;
  const start = opts.fromWall
    ? floatingFromWall(opts.fromWall)
    : dtstartFloating;
  const horizonFloating = new Date(
    dtstartFloating.getTime() + horizonDays * 86_400_000,
  );

  const floats = rule.between(start, horizonFloating, true).slice(0, max);
  return floats.map((f) => {
    const utc = fromZonedTime(wallStringFromFloating(f), timezone).toISOString();
    return { recurrenceId: utc, scheduledAt: utc };
  });
}
