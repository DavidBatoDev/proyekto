import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Receivable arithmetic shared by the portfolio and the per-project financials.
 *
 * Both surfaces answer "how much is owed, and how late is it" and must agree to
 * the peso. They previously did not even agree on which invoices count as
 * revenue, so a project's headline moved the moment a client part-paid.
 */

/** Invoice statuses that represent money actually billed to a client. */
export const BILLED_STATUSES = ['issued', 'partially_paid', 'paid'];

/**
 * Receivables ageing bands, in days past due. `current` holds everything that is
 * not yet overdue — including invoices with no due date, which can never age.
 */
export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_plus';

export type Aging = Record<AgingBucket, number>;

export const emptyAging = (): Aging => ({
  current: 0,
  d1_30: 0,
  d31_60: 0,
  d61_plus: 0,
});

export interface ReceivableInvoice {
  id: string;
  total: string | number;
  status: string;
  due_date?: string | null;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function marginPercent(revenue: number, margin: number): number | null {
  if (!(revenue > 0)) return null;
  return Math.round((margin / revenue) * 1000) / 10;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The last instant of a calendar day, for comparing a date-only filter bound
 * against a timestamptz column. `lte('2026-08-18')` on its own resolves to
 * midnight and silently drops everything that happened on the day picked.
 */
export function endOfDay(date: string): string {
  return `${date}T23:59:59.999Z`;
}

export function daysOverdue(dueDate: string | null, asOf: string): number {
  if (!dueDate || dueDate >= asOf) return 0;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return 0;
  return Math.floor((now - due) / 86_400_000);
}

export function agingBucket(
  dueDate: string | null | undefined,
  asOf: string,
  balance: number,
): AgingBucket {
  if (balance <= 0) return 'current';
  const days = daysOverdue(dueDate ?? null, asOf);
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  return 'd61_plus';
}

/**
 * Money received, per invoice.
 *
 * `invoice_payments` is the ledger, and a reversal is stored as an ordinary row
 * pointing at what it undoes — so it subtracts. When an invoice is marked `paid`
 * but carries no ledger rows at all (the pre-receivables path, and anything
 * reconciled outside Proyekto) its status is the only evidence there is; reading
 * that as collected 0 reported settled money as still owed.
 */
export async function collectedByInvoice(
  supabase: SupabaseClient,
  invoices: ReceivableInvoice[],
): Promise<Map<string, number>> {
  const paidByInvoice = new Map<string, number>();
  if (invoices.length === 0) return paidByInvoice;

  const { data, error } = await supabase
    .from('invoice_payments')
    .select('invoice_id, amount, reverses_payment_id')
    .in(
      'invoice_id',
      invoices.map((invoice) => invoice.id),
    );
  // The receivables migration can be deployed after the API during a staged
  // rollout. Existing reads must remain available until its table reaches
  // PostgREST's schema cache.
  if (error && !isMissingReceivablesSchema(error)) {
    throw new Error(error.message);
  }

  const ledgered = new Set<string>();
  for (const payment of (data ?? []) as Array<{
    invoice_id: string;
    amount: string | number;
    reverses_payment_id: string | null;
  }>) {
    ledgered.add(payment.invoice_id);
    paidByInvoice.set(
      payment.invoice_id,
      (paidByInvoice.get(payment.invoice_id) ?? 0) +
        (payment.reverses_payment_id
          ? -Number(payment.amount)
          : Number(payment.amount)),
    );
  }

  for (const invoice of invoices) {
    if (!ledgered.has(invoice.id) && invoice.status === 'paid') {
      paidByInvoice.set(invoice.id, Number(invoice.total ?? 0));
      continue;
    }
    paidByInvoice.set(
      invoice.id,
      Math.max(0, paidByInvoice.get(invoice.id) ?? 0),
    );
  }
  return paidByInvoice;
}

export function isMissingReceivablesSchema(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === 'PGRST205' ||
    error.message?.includes(
      "Could not find the table 'public.invoice_payments'",
    ) === true
  );
}
