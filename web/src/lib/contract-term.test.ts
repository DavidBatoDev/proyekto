import { describe, expect, it } from "vitest";
import {
	billingPeriodsForRange,
	computeContractTerm,
	configForCadence,
	DEFAULT_PAY_PERIOD_CONFIG,
	MONTHLY_PAY_PERIOD_CONFIG,
} from "./contract-term";

/**
 * These mirror backend/src/modules/contracts/{contract-term,billing-period}.spec.ts
 * case for case. The wizard computes end dates and period counts client-side
 * before anything is saved, so a divergence between the two implementations
 * would show the consultant one contract and store another.
 */

describe("computeContractTerm", () => {
	it("ends a 12-month term the day before the anniversary", () => {
		expect(
			computeContractTerm({
				serviceStartDate: "2026-08-01",
				termCount: 12,
				termUnit: "month",
			}),
		).toEqual({
			serviceStartDate: "2026-08-01",
			serviceEndDate: "2027-07-31",
			contractEndDate: "2027-07-31",
		});
	});

	it("treats a year term as 12 months", () => {
		expect(
			computeContractTerm({
				serviceStartDate: "2026-08-01",
				termCount: 1,
				termUnit: "year",
			}),
		).toEqual(
			computeContractTerm({
				serviceStartDate: "2026-08-01",
				termCount: 12,
				termUnit: "month",
			}),
		);
	});

	it("handles a mid-month start", () => {
		expect(
			computeContractTerm({
				serviceStartDate: "2026-07-16",
				termCount: 3,
				termUnit: "month",
			})?.serviceEndDate,
		).toBe("2026-10-15");
	});

	it("clamps a month-end start into a shorter month", () => {
		expect(
			computeContractTerm({
				serviceStartDate: "2027-01-31",
				termCount: 1,
				termUnit: "month",
			})?.serviceEndDate,
		).toBe("2027-02-27");
	});

	it("respects a leap year", () => {
		expect(
			computeContractTerm({
				serviceStartDate: "2028-01-31",
				termCount: 1,
				termUnit: "month",
			})?.serviceEndDate,
		).toBe("2028-02-28");
	});

	it("extends the contract end by the wind-down days", () => {
		expect(
			computeContractTerm({
				serviceStartDate: "2026-08-01",
				termCount: 6,
				termUnit: "month",
				windDownDays: 30,
			}),
		).toEqual({
			serviceStartDate: "2026-08-01",
			serviceEndDate: "2027-01-31",
			contractEndDate: "2027-03-02",
		});
	});

	it("returns null for unusable input", () => {
		expect(
			computeContractTerm({
				serviceStartDate: "not-a-date",
				termCount: 12,
				termUnit: "month",
			}),
		).toBeNull();
		expect(
			computeContractTerm({
				serviceStartDate: "2026-08-01",
				termCount: 0,
				termUnit: "month",
			}),
		).toBeNull();
	});
});

describe("billingPeriodsForRange", () => {
	it("produces the 1–15 / 16–EOM windows with their pay dates", () => {
		const periods = billingPeriodsForRange(
			DEFAULT_PAY_PERIOD_CONFIG,
			"2026-08-01",
			"2026-09-30",
			{ invoiceOffsetDays: 1, dueDays: 14 },
		);
		expect(periods.map((p) => [p.periodStart, p.periodEnd])).toEqual([
			["2026-08-01", "2026-08-15"],
			["2026-08-16", "2026-08-31"],
			["2026-09-01", "2026-09-15"],
			["2026-09-16", "2026-09-30"],
		]);
		expect(periods[0].payDate).toBe("2026-08-22");
		expect(periods[1].payDate).toBe("2026-09-07");
		expect(periods[0].invoiceDate).toBe("2026-08-16");
		expect(periods[0].dueDate).toBe("2026-08-30");
	});

	it("gives a 12-month semi-monthly contract 24 periods", () => {
		expect(
			billingPeriodsForRange(
				DEFAULT_PAY_PERIOD_CONFIG,
				"2026-08-01",
				"2027-07-31",
			),
		).toHaveLength(24);
	});

	it("gives a 12-month monthly contract 12 periods", () => {
		expect(
			billingPeriodsForRange(
				MONTHLY_PAY_PERIOD_CONFIG,
				"2026-08-01",
				"2027-07-31",
			),
		).toHaveLength(12);
	});

	it("clamps the first and last period to the service window", () => {
		const periods = billingPeriodsForRange(
			DEFAULT_PAY_PERIOD_CONFIG,
			"2026-08-05",
			"2026-09-20",
			{ invoiceOffsetDays: 0, dueDays: 15 },
		);
		expect(periods[0].periodStart).toBe("2026-08-05");
		expect(periods[periods.length - 1].periodEnd).toBe("2026-09-20");
		expect(periods[periods.length - 1].dueDate).toBe("2026-10-05");
	});

	it("rolls a pay date across the year boundary", () => {
		const periods = billingPeriodsForRange(
			DEFAULT_PAY_PERIOD_CONFIG,
			"2026-12-16",
			"2026-12-31",
		);
		expect(periods[0].payDate).toBe("2027-01-07");
	});

	it("shortens February to its real length", () => {
		expect(
			billingPeriodsForRange(
				DEFAULT_PAY_PERIOD_CONFIG,
				"2028-02-01",
				"2028-02-29",
			)[1].periodEnd,
		).toBe("2028-02-29");
	});

	it("returns nothing when the window is inverted", () => {
		expect(
			billingPeriodsForRange(
				DEFAULT_PAY_PERIOD_CONFIG,
				"2026-09-01",
				"2026-08-01",
			),
		).toEqual([]);
	});
});

describe("configForCadence", () => {
	const teamConfig = {
		cadence: "monthly" as const,
		periods: [
			{
				id: "custom",
				label: "Custom",
				start_day: 6,
				end_day: 20,
				pay_day: 25,
				pay_month_offset: 0,
			},
		],
	};

	it("ignores team cut-offs for monthly billing", () => {
		expect(configForCadence("monthly", teamConfig)).toBe(
			MONTHLY_PAY_PERIOD_CONFIG,
		);
	});

	it("defers to team cut-offs for semi-monthly billing", () => {
		expect(configForCadence("semi_monthly", teamConfig)).toBe(teamConfig);
	});

	it("falls back to the default when the team has no config", () => {
		expect(configForCadence("semi_monthly", null)).toBe(
			DEFAULT_PAY_PERIOD_CONFIG,
		);
	});
});
