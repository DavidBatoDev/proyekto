import { describe, expect, it } from "vitest";
import {
	capsFromRate,
	evenAllocation,
	monthlyRevenue,
	monthlyTeamPool,
	periodsPerMonth,
	rateFromHours,
	WEEKS_PER_MONTH,
} from "./rate-budget";

describe("periodsPerMonth", () => {
	it("counts semi-monthly as two, everything else as one", () => {
		expect(periodsPerMonth("semi_monthly")).toBe(2);
		expect(periodsPerMonth("monthly")).toBe(1);
		expect(periodsPerMonth("custom")).toBe(1);
	});
});

describe("monthlyRevenue", () => {
	it("retainer monthly = the fee", () => {
		expect(
			monthlyRevenue({
				billingMode: "retainer",
				recurringFee: 15000,
				clientHourlyRate: null,
				invoiceCadence: "monthly",
			}),
		).toBe(15000);
	});

	it("retainer semi-monthly = fee × 2", () => {
		expect(
			monthlyRevenue({
				billingMode: "retainer",
				recurringFee: 7500,
				clientHourlyRate: null,
				invoiceCadence: "semi_monthly",
			}),
		).toBe(15000);
	});

	it("time_based = client rate × expected monthly hours", () => {
		expect(
			monthlyRevenue({
				billingMode: "time_based",
				recurringFee: null,
				clientHourlyRate: 15,
				invoiceCadence: "monthly",
				expectedMonthlyHours: 160,
			}),
		).toBe(2400);
	});

	it("never negative on missing inputs", () => {
		expect(
			monthlyRevenue({
				billingMode: "time_based",
				recurringFee: null,
				clientHourlyRate: null,
				invoiceCadence: "monthly",
			}),
		).toBe(0);
	});
});

describe("monthlyTeamPool + evenAllocation", () => {
	it("takes the team% of revenue and splits evenly", () => {
		const pool = monthlyTeamPool(15000, 60);
		expect(pool).toBe(9000);
		expect(evenAllocation(pool, 3)).toBe(3000);
		expect(evenAllocation(pool, 0)).toBe(0);
	});
});

describe("capsFromRate", () => {
	it("monthly cap = allocation / rate; weekly = monthly / weeks-per-month", () => {
		const caps = capsFromRate(3000, 300);
		expect(caps.monthly).toBe(10);
		expect(caps.weekly).toBe(Math.round((10 / WEEKS_PER_MONTH) * 100) / 100);
	});

	it("null caps when rate or allocation is zero", () => {
		expect(capsFromRate(3000, 0)).toEqual({ monthly: null, weekly: null });
		expect(capsFromRate(0, 300)).toEqual({ monthly: null, weekly: null });
	});
});

describe("rateFromHours", () => {
	it("rate = allocation / target hours", () => {
		expect(rateFromHours(4500, 40)).toBe(112.5);
	});

	it("round-trips with capsFromRate", () => {
		const allocation = 4500;
		const rate = rateFromHours(allocation, 40)!;
		expect(capsFromRate(allocation, rate).monthly).toBe(40);
	});

	it("null when hours are zero", () => {
		expect(rateFromHours(4500, 0)).toBeNull();
	});
});
