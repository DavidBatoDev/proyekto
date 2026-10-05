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
 *
 * Time exports read the time module's `time_entries` (time rebuild, PR-1):
 * `kind` stays `time_logs` for the web, the file adds the For label, the
 * timesheet and its period, and approved (payable) hours, and never carries
 * an email address.
 */

export type ExportKind = 'time_logs' | 'payouts';

export interface ExportColumn {
  key: string;
  header: string;
}

const TIME_LOG_BASE_COLUMNS: ExportColumn[] = [
  { key: 'date', header: 'Date' },
  { key: 'member', header: 'Member' },
  { key: 'logging_for', header: 'For' },
  { key: 'project', header: 'Project' },
  { key: 'task', header: 'Task' },
  { key: 'started_at', header: 'Started at' },
  { key: 'ended_at', header: 'Ended at' },
  { key: 'duration_hours', header: 'Hours' },
  { key: 'payable_hours', header: 'Approved hours' },
  { key: 'break_minutes', header: 'Break (min)' },
  { key: 'status', header: 'Status' },
  { key: 'timesheet_status', header: 'Timesheet' },
  { key: 'period_start', header: 'Period start' },
  { key: 'period_end', header: 'Period end' },
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

/**
 * A time entry's status as the file shows it, from the CHANGE-5 predicates
 * (blueprint D03) — never from `time_entries.status`, which drops in M5:
 * Paid → `paid`, legacy rejected → `rejected`, Approved → `approved`, else
 * `pending`.
 */
export function timeEntryStatus(entry: {
  payable_seconds: number | null;
  payout_id: string | null;
  legacy_status: string | null;
}): 'paid' | 'rejected' | 'approved' | 'pending' {
  if (entry.payout_id !== null || entry.legacy_status === 'paid_outside') {
    return 'paid';
  }
  if (entry.legacy_status === 'rejected') return 'rejected';
  if (entry.payable_seconds !== null && entry.legacy_status === null) {
    return 'approved';
  }
  return 'pending';
}
