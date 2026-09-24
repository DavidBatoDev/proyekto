/**
 * Team expense arithmetic — pure, no I/O, so the recurrence expansion and the
 * per-currency rollup are unit-testable and shared by the expenses surface and
 * the "my finance" summary.
 *
 * A recurring expense is ONE row; its occurrences are expanded here at read
 * time and never materialized. Payouts join the rollup as virtual `salary`
 * rows — they stay in the payouts table and are never copied into
 * `finance_expenses`. Currencies are never mixed or converted.
 */

import { round2 } from '../receivables';

export const EXPENSE_CATEGORIES = [
  'salary',
  'contractor',
  'software_subscription',
  'overhead',
  'tax_fees',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_RECURRENCES = ['none', 'monthly', 'yearly'] as const;
export type ExpenseRecurrence = (typeof EXPENSE_RECURRENCES)[number];

export interface FinanceExpense {
  id: string;
  team_id: string;
  book_id: string | null;
  project_id: string | null;
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  amount: number;
  currency: string;
  /** YYYY-MM-DD; the first (or only) occurrence. */
  incurred_on: string;
  recurrence: ExpenseRecurrence;
  recurrence_ends_on: string | null;
  document_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by: string | null;
}

export interface ExpenseCurrencySummary {
  currency: string;
  /** Recorded expenses (recurrences expanded) in the window. */
  expenses_total: number;
  /** Non-void payouts in the window (virtual salary rows). */
  payouts_total: number;
  /** expenses_total + payouts_total. */
  total: number;
  /** Includes payouts under `salary`. */
  by_category: Record<ExpenseCategory, number>;
}

/** One entry per currency, sorted by currency code. */
export type ExpenseSummary = ExpenseCurrencySummary[];

/** Inclusive YYYY-MM-DD bounds; null/undefined = unbounded. */
export interface DateWindow {
  from?: string | null;
  to?: string | null;
}

export type RollupExpense = Pick<
  FinanceExpense,
  | 'category'
  | 'amount'
  | 'currency'
  | 'incurred_on'
  | 'recurrence'
  | 'recurrence_ends_on'
  | 'voided_at'
>;

export interface RollupPayout {
  currency: string;
  total_amount: number | string;
  /** timestamptz or YYYY-MM-DD; only the date part is compared. */
  paid_at: string;
}

/** Hard stop on expansion: 100 years of monthly occurrences. */
const MAX_OCCURRENCES = 1200;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * `start` shifted by `months`, keeping the ORIGINAL day-of-month and clamping
 * it to the target month's length (Jan 31 -> Feb 28 -> Mar 31, never drifting
 * to Mar 28). Yearly is `months = 12 * k`, so Feb 29 lands on Feb 28.
 */
export function addMonthsClamped(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  const day = Math.min(d, daysInMonth(year, monthIndex));
  return `${pad(year, 4)}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function minDate(...dates: Array<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (out === null || date < out) out = date;
  }
  return out;
}

/**
 * The dates (YYYY-MM-DD) an expense occurs on inside `window`.
 *
 * - `none`: its `incurred_on`, when inside the window (a future-dated one-off
 *   still counts — it was entered deliberately).
 * - `monthly` / `yearly`: every occurrence from `incurred_on` up to
 *   min(recurrence_ends_on, window.to, today) — recurring charges never
 *   project into the future.
 */
export function expenseOccurrences(
  expense: Pick<
    RollupExpense,
    'incurred_on' | 'recurrence' | 'recurrence_ends_on'
  >,
  window: DateWindow,
  today: string,
): string[] {
  const from = window.from ?? null;
  const to = window.to ?? null;

  if (expense.recurrence === 'none') {
    const date = expense.incurred_on;
    if (from && date < from) return [];
    if (to && date > to) return [];
    return [date];
  }

  const step = expense.recurrence === 'yearly' ? 12 : 1;
  const upper = minDate(expense.recurrence_ends_on, to, today);
  if (upper === null) return []; // unreachable: today is always set
  const out: string[] = [];
  for (let k = 0; k < MAX_OCCURRENCES; k++) {
    const date = addMonthsClamped(expense.incurred_on, k * step);
    if (date > upper) break;
    if (from && date < from) continue;
    out.push(date);
  }
  return out;
}

/**
 * Whether an expense row belongs in a windowed LISTING: it overlaps the
 * window, ignoring `today` (so a future-dated or not-yet-due recurring row is
 * still listed where it will occur).
 */
export function expenseOverlapsWindow(
  expense: Pick<
    RollupExpense,
    'incurred_on' | 'recurrence' | 'recurrence_ends_on'
  >,
  window: DateWindow,
): boolean {
  const from = window.from ?? null;
  const to = window.to ?? null;
  if (to && expense.incurred_on > to) return false;
  if (!from) return true;
  if (expense.recurrence === 'none') return expense.incurred_on >= from;
  return !expense.recurrence_ends_on || expense.recurrence_ends_on >= from;
}

export function emptyByCategory(): Record<ExpenseCategory, number> {
  return {
    salary: 0,
    contractor: 0,
    software_subscription: 0,
    overhead: 0,
    tax_fees: 0,
    other: 0,
  };
}

/**
 * Per-currency totals over `window`. Voided expenses are skipped; payouts are
 * expected pre-filtered to non-void rows but are re-checked against the
 * window by their paid date so the function is correct on its own.
 */
export function summarizeExpenses(
  expenses: RollupExpense[],
  payouts: RollupPayout[],
  window: DateWindow,
  today: string,
): ExpenseSummary {
  const byCurrency = new Map<string, ExpenseCurrencySummary>();
  const entry = (currency: string): ExpenseCurrencySummary => {
    let found = byCurrency.get(currency);
    if (!found) {
      found = {
        currency,
        expenses_total: 0,
        payouts_total: 0,
        total: 0,
        by_category: emptyByCategory(),
      };
      byCurrency.set(currency, found);
    }
    return found;
  };

  for (const expense of expenses) {
    if (expense.voided_at) continue;
    const count = expenseOccurrences(expense, window, today).length;
    if (count === 0) continue;
    const amount = (Number(expense.amount) || 0) * count;
    const row = entry(expense.currency);
    row.expenses_total += amount;
    row.by_category[expense.category] += amount;
  }

  for (const payout of payouts) {
    const date = payout.paid_at.slice(0, 10);
    if (window.from && date < window.from) continue;
    if (window.to && date > window.to) continue;
    const amount = Number(payout.total_amount) || 0;
    const row = entry(payout.currency);
    row.payouts_total += amount;
    row.by_category.salary += amount;
  }

  return [...byCurrency.values()]
    .map((row) => {
      const by_category = emptyByCategory();
      for (const category of EXPENSE_CATEGORIES) {
        by_category[category] = round2(row.by_category[category]);
      }
      return {
        currency: row.currency,
        expenses_total: round2(row.expenses_total),
        payouts_total: round2(row.payouts_total),
        total: round2(row.expenses_total + row.payouts_total),
        by_category,
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
