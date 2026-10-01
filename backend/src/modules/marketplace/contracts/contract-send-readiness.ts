/**
 * What a contract still needs before it can be sent (decision 2026-10-01):
 * whatever signing needs, so a counterparty is never asked to sign something
 * that cannot be signed. The web mirrors this list in
 * web/src/lib/contractSendGate.ts to disable Send and name what is missing.
 */
export interface SendReadinessInput {
  service_start_date: string | null;
  term_count: number | null;
  term_unit: string | null;
  service_end_date: string | null;
  billing_mode: string;
  fixed_fee: number | null;
  recurring_fee: number | null;
  client_hourly_rate: number | null;
}

/** The missing items, in the order the editor shows them. Empty = ready. */
export function missingForSend(contract: SendReadinessInput): string[] {
  const missing: string[] = [];
  if (!contract.service_start_date) missing.push('the service start date');
  if (
    !contract.term_count ||
    !contract.term_unit ||
    !contract.service_end_date
  ) {
    missing.push('the term (how long the service runs)');
  }
  if (contract.billing_mode === 'fixed' && contract.fixed_fee == null) {
    missing.push('the fixed contract amount');
  }
  if (
    ['retainer', 'hybrid'].includes(contract.billing_mode) &&
    contract.recurring_fee == null
  ) {
    missing.push('the monthly contract rate');
  }
  if (
    ['time_based', 'hybrid'].includes(contract.billing_mode) &&
    contract.client_hourly_rate == null
  ) {
    missing.push('the hourly contract rate');
  }
  return missing;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The refusal shown when Send is pressed too early, or null when ready. */
export function sendBlockedMessage(
  contract: SendReadinessInput,
): string | null {
  const missing = missingForSend(contract);
  if (missing.length === 0) return null;
  return `This contract cannot be sent yet. Add ${joinList(missing)}, then send it.`;
}
