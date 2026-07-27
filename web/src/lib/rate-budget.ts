/**
 * Pure math for the rate ↔ budget calculator: turn a contract's revenue and the
 * economics split into a monthly team pool, then convert a per-member budget
 * allocation into an hourly rate or an hour cap (either direction).
 *
 * Everything is MONTHLY — hour caps are weekly/monthly, so a monthly pool is the
 * natural unit. `~4.33` is the average weeks per month (52/12).
 */

import type { BillingMode, InvoiceCadence } from "@/lib/contract-term";

export const WEEKS_PER_MONTH = 52 / 12;

/** How many billing periods fall in a month, per cadence. */
export function periodsPerMonth(cadence: InvoiceCadence): number {
	// semi-monthly bills twice a month; monthly/custom once.
	return cadence === "semi_monthly" ? 2 : 1;
}

/**
 * Monthly gross revenue the project expects, before the company/team split.
 * - retainer / hybrid: the recurring fee × periods per month.
 * - time_based: the client rate × the consultant's expected monthly billable hours.
 */
export function monthlyRevenue(input: {
	billingMode: BillingMode;
	recurringFee: number | null;
	clientHourlyRate: number | null;
	invoiceCadence: InvoiceCadence;
	/** Only used for time_based; consultant's expected billable hours per month. */
	expectedMonthlyHours?: number;
}): number {
	if (input.billingMode === "time_based") {
		const rate = Number(input.clientHourlyRate ?? 0);
		const hours = Number(input.expectedMonthlyHours ?? 0);
		return Math.max(0, rate * hours);
	}
	// retainer + hybrid baseline (overage is on top, not part of the guaranteed pool)
	const fee = Number(input.recurringFee ?? 0);
	return Math.max(0, fee * periodsPerMonth(input.invoiceCadence));
}

/** The slice of monthly revenue available to pay the team. */
export function monthlyTeamPool(revenue: number, teamPercent: number): number {
	return Math.max(0, (revenue * Math.max(0, teamPercent)) / 100);
}

/** Even split of a pool across N members (0 members → 0). */
export function evenAllocation(pool: number, memberCount: number): number {
	if (memberCount <= 0) return 0;
	return pool / memberCount;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Given a member's monthly allocation and an hourly rate, the hour caps that
 * keep their cost within the allocation. Returns null caps when the rate is 0
 * (a cap would be infinite).
 */
export function capsFromRate(
	allocation: number,
	hourlyRate: number,
): { monthly: number | null; weekly: number | null } {
	if (!(hourlyRate > 0) || !(allocation > 0)) {
		return { monthly: null, weekly: null };
	}
	const monthly = allocation / hourlyRate;
	return {
		monthly: round2(monthly),
		weekly: round2(monthly / WEEKS_PER_MONTH),
	};
}

/**
 * Given a member's monthly allocation and target monthly hours, the hourly rate
 * that spends exactly the allocation over those hours. Null when hours are 0.
 */
export function rateFromHours(
	allocation: number,
	monthlyHours: number,
): number | null {
	if (!(monthlyHours > 0) || !(allocation > 0)) return null;
	return round2(allocation / monthlyHours);
}
