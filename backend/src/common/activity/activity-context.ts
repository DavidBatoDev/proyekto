import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditEntry } from '../../modules/shared/audit/audit.service';

/**
 * Per-request activity buffer.
 *
 * A single roadmap request can produce one event (most writes) or many (a bulk
 * reorder, an AI commit). Writing each one as its own detached INSERT would
 * mean 50 round-trips for one drag-reorder, and Cloud Run may freeze instance
 * CPU once the response is sent — so detached writes are exactly the ones most
 * likely to be lost. Buffering the request's events and flushing them as ONE
 * multi-row insert costs a single round-trip regardless of event count, and
 * the flush is a bounded await rather than a detached promise, mirroring the
 * decision already documented in NotificationsService.sendPush.
 */
export interface BufferedActivityEntry extends AuditEntry {
  /**
   * Generated client-side at buffer time so the flush can insert with
   * `return=minimal` and the knowledge-outbox enqueue still knows the row ids
   * without a RETURNING read.
   */
  id: string;
  /**
   * When the action actually happened, stamped at buffer time rather than left
   * to the column default.
   *
   * The flush is bounded (ACTIVITY_FLUSH_TIMEOUT_MS) so a slow insert can never
   * hold a response open — but that means an insert CAN land after a later
   * request's. Letting created_at default at insert time would then record the
   * events out of order: observed in an e2e run where a 5.8s task-create
   * flushed after the task-update that followed it. Stamping here keeps the
   * timeline honest regardless of when the row lands.
   */
  occurredAt: string;
}

/**
 * Where a request's writes came from, when that is not simply "a person in the
 * web app".
 *
 * Set once per request by the caller that knows (today: McpController). Audit
 * rows merge it into their metadata, so a connector-driven write is
 * distinguishable in the activity feed WITHOUT every domain service having to
 * grow an actor-context parameter, and without emitting a second `mcp.*` row
 * beside the service's own.
 *
 * Carries no row data — only who was driving. Anything row-derived added here
 * would leak past the per-row visibility gates (an `internal` risk's title in
 * the feed re-leaks exactly what `risks.view_internal` protects, because the
 * audit sensitivity flag is per-action, not per-row).
 */
export interface ActivityOrigin {
  via: 'mcp';
  /** The scopes the credential carried, for the audit reader. */
  scopes: string[];
}

export interface ActivityBuffer {
  entries: BufferedActivityEntry[];
  /** Events dropped after hitting `max` — surfaced in the flush log, never silent. */
  dropped: number;
  max: number;
  /** Set by the request's entry point when the writes are not user-driven. */
  origin?: ActivityOrigin;
}

export const activityStorage = new AsyncLocalStorage<ActivityBuffer>();

export const DEFAULT_MAX_EVENTS_PER_REQUEST = 100;

export function createActivityBuffer(
  max: number = DEFAULT_MAX_EVENTS_PER_REQUEST,
): ActivityBuffer {
  return { entries: [], dropped: 0, max };
}

/**
 * Tag the current request's writes with their origin.
 *
 * Returns false when there is no request context, mirroring `bufferActivity` —
 * the caller can then decide whether that matters (for MCP it does not: no
 * store means nothing is being buffered to tag).
 */
export function setActivityOrigin(origin: ActivityOrigin): boolean {
  const store = activityStorage.getStore();
  if (!store) return false;
  store.origin = origin;
  return true;
}

/** The current request's origin, if one was set. */
export function getActivityOrigin(): ActivityOrigin | undefined {
  return activityStorage.getStore()?.origin;
}

/**
 * Buffer an entry for the current request.
 *
 * Returns false when there is no request context — cron routes, module boot,
 * and unit tests — so the caller can fall back to a detached single insert
 * rather than silently dropping the event.
 */
export function bufferActivity(entry: BufferedActivityEntry): boolean {
  const store = activityStorage.getStore();
  if (!store) return false;
  if (store.entries.length >= store.max) {
    store.dropped++;
    return true;
  }
  store.entries.push(entry);
  return true;
}

/** Test/diagnostic helper: run `fn` inside a fresh buffer and return both. */
export function runWithActivityBuffer<T>(
  fn: () => T,
  max: number = DEFAULT_MAX_EVENTS_PER_REQUEST,
): { result: T; buffer: ActivityBuffer } {
  const buffer = createActivityBuffer(max);
  const result = activityStorage.run(buffer, fn);
  return { result, buffer };
}
