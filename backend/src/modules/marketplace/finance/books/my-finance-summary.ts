/**
 * "My finance" summary — the cross-team money picture for one caller. Pure
 * helpers (scope decision, per-team rows, totals) so the arithmetic is
 * unit-tested without I/O. Currencies are never mixed or converted.
 */

import type { ExpenseSummary } from '../expenses/expense-rollup';
import { round2 } from '../receivables';
import type { FinanceBookRole } from './finance-book-permissions';

export type MyTeamRole = 'owner' | 'admin' | 'member';
export type MyFinanceScope = 'team' | 'self';

export interface HoursBreakdown {
  total_seconds: number;
  month_seconds: number;
  pending_seconds: number;
}

export interface MoneyInRow {
  currency: string;
  invoiced: number;
  collected: number;
  outstanding: number;
}

export interface MoneyOutRow {
  currency: string;
  payouts: number;
  expenses: number;
  total: number;
}

export interface PaidToMeRow {
  currency: string;
  amount: number;
}

export interface MyFinanceTeam {
  team_id: string;
  team_name: string;
  is_owner: boolean;
  team_role: MyTeamRole;
  finance_role: FinanceBookRole | null;
  scope: MyFinanceScope;
  /** The caller's own logs in this team. */
  hours: HoursBreakdown;
  /** Empty for scope 'self'. */
  money_in: MoneyInRow[];
  /** Empty for scope 'self'. */
  money_out: MoneyOutRow[];
  /** Payouts this team recorded to the caller. */
  paid_to_me: PaidToMeRow[];
}

export interface MyFinanceSummary {
  hours: HoursBreakdown & {
    approved_seconds: number;
    paid_seconds: number;
  };
  teams: MyFinanceTeam[];
  totals: {
    money_in: Array<MoneyInRow & { paid_to_me: number }>;
    money_out: MoneyOutRow[];
    net: Array<{ currency: string; amount: number }>;
  };
}

/** Finance roles that see the whole team's money. */
const TEAM_SCOPE_ROLES: ReadonlySet<FinanceBookRole> = new Set([
  'owner',
  'manager',
  'accountant',
]);

/**
 * `team` for the team owner or an owner/manager/accountant on the team's F2
 * book; everyone else only sees what was paid to them.
 */
export function decideTeamScope(input: {
  isTeamOwner: boolean;
  financeRole: FinanceBookRole | null;
}): MyFinanceScope {
  if (input.isTeamOwner) return 'team';
  if (input.financeRole && TEAM_SCOPE_ROLES.has(input.financeRole)) {
    return 'team';
  }
  return 'self';
}

const byCurrency = <T extends { currency: string }>(a: T, b: T) =>
  a.currency.localeCompare(b.currency);

/** Money in from billed invoices and their collected amounts. */
export function summarizeMoneyIn(
  invoices: Array<{
    id: string;
    currency: string | null;
    total: number | string;
  }>,
  collectedByInvoice: Map<string, number>,
  fallbackCurrency = 'USD',
): MoneyInRow[] {
  const rows = new Map<string, { invoiced: number; collected: number }>();
  for (const invoice of invoices) {
    const currency = invoice.currency ?? fallbackCurrency;
    const row = rows.get(currency) ?? { invoiced: 0, collected: 0 };
    row.invoiced += Number(invoice.total) || 0;
    row.collected += collectedByInvoice.get(invoice.id) ?? 0;
    rows.set(currency, row);
  }
  return [...rows.entries()]
    .map(([currency, row]) => ({
      currency,
      invoiced: round2(row.invoiced),
      collected: round2(row.collected),
      outstanding: round2(Math.max(0, row.invoiced - row.collected)),
    }))
    .sort(byCurrency);
}

export function moneyOutFromExpenseSummary(
  summary: ExpenseSummary,
): MoneyOutRow[] {
  return summary
    .map((row) => ({
      currency: row.currency,
      payouts: row.payouts_total,
      expenses: row.expenses_total,
      total: row.total,
    }))
    .sort(byCurrency);
}

export function summarizePaidToMe(
  payouts: Array<{ currency: string; total_amount: number | string }>,
): PaidToMeRow[] {
  const totals = new Map<string, number>();
  for (const payout of payouts) {
    totals.set(
      payout.currency,
      (totals.get(payout.currency) ?? 0) + (Number(payout.total_amount) || 0),
    );
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
    .sort(byCurrency);
}

/**
 * Cross-team totals, per currency:
 * - money_in = team-scope money_in + paid_to_me from SELF-scope teams (a
 *   team-scope caller's own pay is already inside that team's money_out);
 * - money_out = team-scope money_out;
 * - net = (collected + paid_to_me) - money_out.total.
 *
 * `teamMoneyIn`, when given, replaces the summed team-scope money_in — the
 * service passes an invoice-deduplicated figure so a project linked to two
 * of the caller's teams is not counted twice.
 */
export function buildMyFinanceTotals(
  teams: MyFinanceTeam[],
  teamMoneyIn?: MoneyInRow[],
): MyFinanceSummary['totals'] {
  const moneyIn = new Map<
    string,
    { invoiced: number; collected: number; outstanding: number; paid: number }
  >();
  const inRow = (currency: string) => {
    let row = moneyIn.get(currency);
    if (!row) {
      row = { invoiced: 0, collected: 0, outstanding: 0, paid: 0 };
      moneyIn.set(currency, row);
    }
    return row;
  };
  const moneyOut = new Map<string, { payouts: number; expenses: number }>();

  const teamScoped = teams.filter((team) => team.scope === 'team');
  const moneyInSource =
    teamMoneyIn ?? teamScoped.flatMap((team) => team.money_in);
  for (const row of moneyInSource) {
    const target = inRow(row.currency);
    target.invoiced += row.invoiced;
    target.collected += row.collected;
    target.outstanding += row.outstanding;
  }
  for (const team of teams) {
    if (team.scope === 'self') {
      for (const paid of team.paid_to_me) {
        inRow(paid.currency).paid += paid.amount;
      }
    }
  }
  for (const team of teamScoped) {
    for (const row of team.money_out) {
      const target = moneyOut.get(row.currency) ?? { payouts: 0, expenses: 0 };
      target.payouts += row.payouts;
      target.expenses += row.expenses;
      moneyOut.set(row.currency, target);
    }
  }

  const money_in = [...moneyIn.entries()]
    .map(([currency, row]) => ({
      currency,
      invoiced: round2(row.invoiced),
      collected: round2(row.collected),
      outstanding: round2(row.outstanding),
      paid_to_me: round2(row.paid),
    }))
    .sort(byCurrency);
  const money_out = [...moneyOut.entries()]
    .map(([currency, row]) => ({
      currency,
      payouts: round2(row.payouts),
      expenses: round2(row.expenses),
      total: round2(row.payouts + row.expenses),
    }))
    .sort(byCurrency);

  const currencies = new Set([
    ...money_in.map((row) => row.currency),
    ...money_out.map((row) => row.currency),
  ]);
  const net = [...currencies]
    .map((currency) => {
      const incoming = money_in.find((row) => row.currency === currency);
      const outgoing = money_out.find((row) => row.currency === currency);
      return {
        currency,
        amount: round2(
          (incoming?.collected ?? 0) +
            (incoming?.paid_to_me ?? 0) -
            (outgoing?.total ?? 0),
        ),
      };
    })
    .sort(byCurrency);

  return { money_in, money_out, net };
}
