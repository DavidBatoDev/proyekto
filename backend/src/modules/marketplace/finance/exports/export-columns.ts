import type { FinanceBookPermissions } from '../books/finance-book-permissions';

/**
 * Which columns an export carries, as a pure `(kind, permissions) -> columns`
 * function so the cost-redaction invariant is unit-testable without I/O.
 *
 * THE invariant: `rate_snapshot` (and anything derived from it — the rate,
 * amount, and rate-currency columns) is internal cost and must NEVER appear
 * in a file unless the caller's book permissions include `view_costs`.
 * Payout amounts are what was actually paid out, not an internal rate, so
 * they are visible to any exporter with `view_time`.
 */

export type ExportKind = 'time_logs' | 'payouts';

export interface ExportColumn {
  key: string;
  header: string;
}

const TIME_LOG_BASE_COLUMNS: ExportColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'member', header: 'Member' },
  { key: 'project', header: 'Project' },
  { key: 'task', header: 'Task' },
  { key: 'started_at', header: 'Started at' },
  { key: 'ended_at', header: 'Ended at' },
  { key: 'duration_hours', header: 'Hours' },
  { key: 'break_minutes', header: 'Break (min)' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Source' },
  { key: 'flagged_reason', header: 'Flagged reason' },
];

/** Cost-bearing columns — appended ONLY when permissions.view_costs. */
const TIME_LOG_COST_COLUMNS: ExportColumn[] = [
  { key: 'rate', header: 'Rate' },
  { key: 'currency', header: 'Currency' },
  { key: 'amount', header: 'Amount' },
];

const PAYOUT_COLUMNS: ExportColumn[] = [
  { key: 'paid_at', header: 'Paid at' },
  { key: 'member', header: 'Member' },
  { key: 'currency', header: 'Currency' },
  { key: 'total_amount', header: 'Total amount' },
  { key: 'status', header: 'Status' },
  { key: 'reference_number', header: 'Reference' },
  { key: 'method_label', header: 'Method' },
  { key: 'note', header: 'Note' },
];

export function exportColumns(
  kind: ExportKind,
  permissions: FinanceBookPermissions,
): ExportColumn[] {
  if (kind === 'payouts') return [...PAYOUT_COLUMNS];
  return permissions.view_costs
    ? [...TIME_LOG_BASE_COLUMNS, ...TIME_LOG_COST_COLUMNS]
    : [...TIME_LOG_BASE_COLUMNS];
}
