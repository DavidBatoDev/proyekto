import type { FinanceBookOverview } from "@/services/financeBooks.service";

/** Statuses that count as billed: drafts and voids never reach the client's books. */
const BILLED = new Set(["issued", "partially_paid", "paid"]);

export interface ProjectMoneyIn {
	currency: string;
	billed: number;
	collected: number;
	outstanding: number;
	count: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Billed, collected and outstanding for one project, per currency. Mixed
 * currencies are never summed together: each gets its own row.
 */
export function summariseProjectMoneyIn(
	invoices: FinanceBookOverview["invoices"],
): ProjectMoneyIn[] {
	const byCurrency = new Map<string, ProjectMoneyIn>();
	for (const invoice of invoices ?? []) {
		if (!BILLED.has(invoice.status)) continue;
		const currency = invoice.currency ?? "—";
		const row = byCurrency.get(currency) ?? {
			currency,
			billed: 0,
			collected: 0,
			outstanding: 0,
			count: 0,
		};
		const total = Number(invoice.total ?? 0);
		const paid = Math.min(Number(invoice.amount_paid ?? 0), total);
		row.billed = round2(row.billed + total);
		row.collected = round2(row.collected + paid);
		row.outstanding = round2(row.billed - row.collected);
		row.count += 1;
		byCurrency.set(currency, row);
	}
	return [...byCurrency.values()].sort((a, b) => b.billed - a.billed);
}
