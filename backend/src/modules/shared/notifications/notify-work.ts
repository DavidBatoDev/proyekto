/**
 * Bounded, awaited execution of best-effort notification work.
 *
 * Two properties, both deliberate. It is AWAITED, so the work cannot be frozen
 * by Cloud Run's post-response CPU throttling — the failure this exists to
 * prevent is a notification that silently never happened. And it is BOUNDED, so
 * a slow database or push provider degrades to exactly the old behaviour
 * (the write succeeded, the notification was skipped) instead of making the
 * caller wait.
 *
 * Why detaching is not an option. A `notifications` row is the ONLY delivery
 * signal there is: no row means no bell entry, no push, AND no email, since the
 * email outbox is fed by an AFTER INSERT trigger on `notifications`. Cloud Run
 * throttles CPU once the response flushes and scales to zero, so a detached
 * tail can be frozen and killed with no trace that the mention ever happened.
 *
 * Lives here rather than on a service because it has no dependencies — making
 * it injectable would force every consuming module to register a provider for a
 * `Promise.race`. Both current consumers (chat and roadmap comments) already
 * import notification vocabulary from this directory.
 *
 * The timer is cleared when the work wins, so a fast path leaves no handle
 * behind.
 */

/**
 * Ceiling on the notification work a write will wait for.
 *
 * Generous enough for a probe, an insert, and the push inside
 * `createNotification` — itself capped at PUSH_SEND_TIMEOUT_MS, default 1500ms —
 * while recipients are processed concurrently.
 */
export const DEFAULT_NOTIFY_DEADLINE_MS = 2_500;

export async function runNotifyWork(
  work: Promise<unknown>,
  deadlineMs: number = DEFAULT_NOTIFY_DEADLINE_MS,
): Promise<void> {
  let deadline: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, deadlineMs);
      }),
    ]);
  } catch {
    // Notifications are non-critical; the originating write is already committed.
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}
