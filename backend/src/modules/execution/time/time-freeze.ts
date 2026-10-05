// backend/src/modules/execution/time/time-freeze.ts   (pure; CHANGE-4 steps 3–5)
// Order per entry: round, then cap, then amount (CHANGE-4). Totals round once (L63/L64).
import type { FreezeEntryValue, RateType } from './time.types';

/** Half-up to 2 decimals without the binary-float drift of Math.round(x * 100) / 100 (1.005 → 1.01). */
function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  // 15 significant digits drop the float noise of a product such as 5400 × 500 / 3600.
  const cleaned = Number(Math.abs(value).toPrecision(15));
  const text = String(cleaned);
  const rounded = text.includes('e')
    ? Math.round(cleaned * 100) / 100
    : Number(`${Math.round(Number(`${text}e2`))}e-2`);
  return sign * rounded;
}

/** Nearest increment, ties up (D14). 0 = unchanged. Never negative. */
export function roundSeconds(seconds: number, roundingMinutes: number): number {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (!roundingMinutes || roundingMinutes <= 0) return s;
  const increment = roundingMinutes * 60;
  return Math.max(0, Math.floor((s + increment / 2) / increment) * increment);
}

export interface CapInput {
  id: string;
  started_at: string;
  seconds: number;
} // seconds = rounded

/** Allocates the remaining allowance in started_at (then id) order. capSeconds null = no cap.
 *  approveOvertime = true → payable = rounded, over still reported. */
export function capInOrder(
  entries: CapInput[],
  capSeconds: number | null,
  alreadyApprovedSeconds: number,
  approveOvertime: boolean,
): Map<string, { payable: number; over: number }> {
  const ordered = [...entries].sort((a, b) => {
    const at = Date.parse(a.started_at);
    const bt = Date.parse(b.started_at);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const result = new Map<string, { payable: number; over: number }>();
  let remaining =
    capSeconds === null || capSeconds === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, capSeconds - Math.max(0, alreadyApprovedSeconds || 0));
  for (const entry of ordered) {
    const seconds = Math.max(0, entry.seconds);
    const allowed = Math.min(seconds, remaining);
    remaining -= allowed;
    const over = seconds - allowed;
    result.set(entry.id, {
      payable: approveOvertime ? seconds : allowed,
      over,
    });
  }
  return result;
}

/** round(payable/3600 × rate, 2) for hourly; null for fixed or !amountable. */
export function amountFor(
  payable: number,
  rate: number,
  rateType: RateType,
  amountable: boolean,
): number | null {
  if (rateType === 'fixed' || !amountable) return null;
  return round2((payable * rate) / 3600);
}

/** Display totals per currency (L64), each rounded once: Σ payable/3600 × rate over the entries that carry an
 *  amount (amount_snapshot not null), so per-entry cents never accumulate (L63). */
export function sumByCurrency(
  values: FreezeEntryValue[],
): Record<string, number> {
  const raw = new Map<string, number>();
  for (const v of values) {
    if (v.amount_snapshot === null || v.amount_snapshot === undefined) continue;
    const exact = (v.payable_seconds * v.rate_snapshot) / 3600;
    raw.set(v.currency_snapshot, (raw.get(v.currency_snapshot) ?? 0) + exact);
  }
  const out: Record<string, number> = {};
  for (const [currency, total] of raw) out[currency] = round2(total);
  return out;
}
