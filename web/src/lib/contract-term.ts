/**
 * Contract term + billing-period maths for the UI.
 *
 * Deliberately mirrors the backend's `contracts/contract-term.ts` and
 * `contracts/billing-period.ts`. The wizard shows the derived end dates and
 * period count live, before anything is saved, so both implementations must
 * agree exactly — the unit tests on each side cover the same cases.
 *
 * All arithmetic runs on UTC-noon dates so a browser in any timezone (and a DST
 * transition) can never roll a day boundary.
 */

import type { PayPeriodConfig, PayPeriodDef } from "@/services/teams.service";

export type ContractTermUnit = "month" | "year";
export type BillingMode = "retainer" | "time_based" | "hybrid" | "fixed";
export type InvoiceCadence = "monthly" | "semi_monthly" | "custom";

export interface ContractTerm {
	serviceStartDate: string;
	serviceEndDate: string;
	contractEndDate: string;
}

export interface BillingPeriod {
	id: string;
	periodStart: string;
	periodEnd: string;
	invoiceDate: string;
	dueDate: string;
	payDate: string;
}

export const DEFAULT_PAY_PERIOD_CONFIG: PayPeriodConfig = {
	cadence: "monthly",
	periods: [
		{
			id: "h1",
			label: "1st half",
			start_day: 1,
			end_day: 15,
			pay_day: 22,
			pay_month_offset: 0,
		},
		{
			id: "h2",
			label: "2nd half",
			start_day: 16,
			end_day: "EOM",
			pay_day: 7,
			pay_month_offset: 1,
		},
	],
};

export const MONTHLY_PAY_PERIOD_CONFIG: PayPeriodConfig = {
	cadence: "monthly",
	periods: [
		{
			id: "full",
			label: "Full month",
			start_day: 1,
			end_day: "EOM",
			pay_day: 15,
			pay_month_offset: 1,
		},
	],
};

function utcDate(year: number, monthIndex: number, day: number): Date {
	return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
}

export function parseIsoDate(value: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (!match) return null;
	const parsed = utcDate(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3]),
	);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toIsoDate(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
	return utcDate(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate() + days,
	);
}

function lastDayOfMonth(year: number, monthIndex: number): number {
	return new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
}

/** Adds whole months, clamping the day so Jan 31 + 1 month is Feb 28/29. */
function addMonthsClamped(date: Date, months: number): Date {
	const monthIndex = date.getUTCMonth() + months;
	const year = date.getUTCFullYear() + Math.floor(monthIndex / 12);
	const normalizedMonth = ((monthIndex % 12) + 12) % 12;
	const day = Math.min(
		date.getUTCDate(),
		lastDayOfMonth(year, normalizedMonth),
	);
	return utcDate(year, normalizedMonth, day);
}

/**
 * Last service day = start + term − 1 day. A 12-month term from 2026-08-01
 * runs through 2027-07-31: the client is buying 12 whole months.
 */
export function computeContractTerm(input: {
	serviceStartDate: string;
	termCount: number;
	termUnit: ContractTermUnit;
	windDownDays?: number;
}): ContractTerm | null {
	const start = parseIsoDate(input.serviceStartDate);
	if (!start) return null;
	if (!Number.isInteger(input.termCount) || input.termCount <= 0) return null;

	const months =
		input.termUnit === "year" ? input.termCount * 12 : input.termCount;
	const serviceEnd = addDays(addMonthsClamped(start, months), -1);
	const windDown = input.windDownDays ?? 0;

	return {
		serviceStartDate: toIsoDate(start),
		serviceEndDate: toIsoDate(serviceEnd),
		contractEndDate: toIsoDate(
			windDown > 0 ? addDays(serviceEnd, windDown) : serviceEnd,
		),
	};
}

function resolveOne(
	def: PayPeriodDef,
	year: number,
	monthIndex: number,
	invoiceOffsetDays: number,
	dueDays: number,
): BillingPeriod {
	const eom = lastDayOfMonth(year, monthIndex);
	const startDay = Math.min(Math.max(1, def.start_day), eom);
	const endDay =
		def.end_day === "EOM" ? eom : Math.min(Math.max(1, def.end_day), eom);
	const from = utcDate(year, monthIndex, startDay);
	const to = utcDate(year, monthIndex, endDay);

	const payMonthIndex = monthIndex + (def.pay_month_offset ?? 0);
	const payYear = year + Math.floor(payMonthIndex / 12);
	const payMonth = ((payMonthIndex % 12) + 12) % 12;
	const payDate = utcDate(
		payYear,
		payMonth,
		Math.min(Math.max(1, def.pay_day), lastDayOfMonth(payYear, payMonth)),
	);

	const invoiceDate = addDays(to, invoiceOffsetDays);
	const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

	return {
		id: `${monthKey}:${def.id}`,
		periodStart: toIsoDate(from),
		periodEnd: toIsoDate(to),
		invoiceDate: toIsoDate(invoiceDate),
		dueDate: toIsoDate(addDays(invoiceDate, dueDays)),
		payDate: toIsoDate(payDate),
	};
}

/** The pay-period config a contract bills against. */
export function configForCadence(
	cadence: InvoiceCadence,
	teamConfig?: PayPeriodConfig | null,
): PayPeriodConfig {
	if (cadence === "monthly") return MONTHLY_PAY_PERIOD_CONFIG;
	if (
		teamConfig &&
		teamConfig.cadence === "monthly" &&
		Array.isArray(teamConfig.periods) &&
		teamConfig.periods.length > 0
	) {
		return teamConfig;
	}
	return DEFAULT_PAY_PERIOD_CONFIG;
}

/**
 * Billing windows overlapping the service span, clamped to it — so a contract
 * starting mid-cut-off still bills that partial period, and the client is never
 * billed for days outside the contract.
 */
export function billingPeriodsForRange(
	config: PayPeriodConfig,
	serviceStart: string,
	serviceEnd: string,
	options: { invoiceOffsetDays?: number; dueDays?: number } = {},
): BillingPeriod[] {
	const start = parseIsoDate(serviceStart);
	const end = parseIsoDate(serviceEnd);
	if (!start || !end || end < start) return [];

	const invoiceOffsetDays = options.invoiceOffsetDays ?? 0;
	const dueDays = options.dueDays ?? 0;
	const periods: BillingPeriod[] = [];

	let cursor = addMonthsClamped(
		utcDate(start.getUTCFullYear(), start.getUTCMonth(), 1),
		-1,
	);
	const limit = addMonthsClamped(
		utcDate(end.getUTCFullYear(), end.getUTCMonth(), 1),
		1,
	);

	while (cursor <= limit) {
		const year = cursor.getUTCFullYear();
		const monthIndex = cursor.getUTCMonth();
		for (const def of config.periods) {
			const period = resolveOne(
				def,
				year,
				monthIndex,
				invoiceOffsetDays,
				dueDays,
			);
			if (
				period.periodEnd >= serviceStart &&
				period.periodStart <= serviceEnd
			) {
				periods.push(period);
			}
		}
		cursor = addMonthsClamped(cursor, 1);
	}

	periods.sort((a, b) => a.periodStart.localeCompare(b.periodStart));

	return periods.map((period) => {
		const clampedStart =
			period.periodStart < serviceStart ? serviceStart : period.periodStart;
		const clampedEnd =
			period.periodEnd > serviceEnd ? serviceEnd : period.periodEnd;
		if (
			clampedStart === period.periodStart &&
			clampedEnd === period.periodEnd
		) {
			return period;
		}
		const endDate = parseIsoDate(clampedEnd);
		if (!endDate) return period;
		const invoiceDate = addDays(endDate, invoiceOffsetDays);
		return {
			...period,
			periodStart: clampedStart,
			periodEnd: clampedEnd,
			invoiceDate: toIsoDate(invoiceDate),
			dueDate: toIsoDate(addDays(invoiceDate, dueDays)),
		};
	});
}

/** e.g. "31 July 2027". Returns an em dash for an unset date. */
export function formatContractDate(value: string | null | undefined): string {
	if (!value) return "—";
	const parsed = parseIsoDate(value);
	if (!parsed) return value;
	return new Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(parsed);
}

/** e.g. "1 – 15 August 2026". */
export function formatPeriodRange(period: BillingPeriod): string {
	return `${formatContractDate(period.periodStart)} – ${formatContractDate(period.periodEnd)}`;
}

export function formatMoney(
	currency: string,
	amount: number | null | undefined,
): string {
	const value = Number(amount ?? 0);
	return `${currency} ${value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}
