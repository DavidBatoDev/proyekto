/**
 * The server's clock, as seen from the browser.
 *
 * Server-stamped times (a running timer's `started_at`, `paused_at`) are
 * compared against the browser's `Date.now()` to draw live durations. When
 * the device clock is off — a Windows clock a minute slow is common — a timer
 * that just started reads as starting in the future, and the live duration
 * sits clamped at 0 until the device clock catches up.
 *
 * The fix is to count in server time: every API response carries an HTTP
 * `Date` header (exposed through CORS by the backend), and the gap between it
 * and the local clock at the midpoint of the request is the offset to apply.
 *
 * `Date` has one-second resolution, so a single sample is only accurate to
 * about ±1s. Offsets inside that noise are ignored (treated as 0), and the
 * stored offset only moves when a new sample disagrees with it by more than
 * the noise — otherwise every response would nudge live timers back and forth.
 */

const NOISE_MS = 1_500;

let offsetMs = 0;

/** Feeds one response's `Date` header into the offset estimate. */
export function recordServerDate(
	dateHeader: unknown,
	sentAtMs: number,
	receivedAtMs: number,
): void {
	if (typeof dateHeader !== "string" || !dateHeader) return;
	const serverMs = Date.parse(dateHeader);
	if (Number.isNaN(serverMs)) return;
	// The header is truncated to the second, so its true value is on average
	// half a second later than it reads.
	const sample = serverMs + 500 - (sentAtMs + receivedAtMs) / 2;
	const next = Math.abs(sample) < NOISE_MS ? 0 : Math.round(sample);
	if (Math.abs(next - offsetMs) >= NOISE_MS) offsetMs = next;
}

/** `Date.now()`, corrected to the server's clock. */
export function serverNow(): number {
	return Date.now() + offsetMs;
}
