import { describe, expect, it } from "vitest";
import type { PayPeriodConfig } from "@/services/teams.service";
import {
	currentPayPeriod,
	DEFAULT_PAY_PERIOD_CONFIG,
	resolvePayPeriods,
	resolveTeamLogPeriod,
} from "./log-period";

describe("resolveTeamLogPeriod cutoff handling (default config)", () => {
	it("uses day 28 for non-leap February second cutoff", () => {
		const period = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2025-02",
			cutoff_period: "h2",
		});
		expect(period.customFromDate).toBe("2025-02-16");
		expect(period.customToDate).toBe("2025-02-28");
	});

	it("uses day 29 for leap-year February second cutoff", () => {
		const period = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2024-02",
			cutoff_period: "h2",
		});
		expect(period.customFromDate).toBe("2024-02-16");
		expect(period.customToDate).toBe("2024-02-29");
	});

	it("uses month end for 30 and 31 day months", () => {
		const april = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2026-04",
			cutoff_period: "h2",
		});
		expect(april.customToDate).toBe("2026-04-30");

		const may = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2026-05",
			cutoff_period: "h2",
		});
		expect(may.customToDate).toBe("2026-05-31");
	});

	it("resolves the first half by default and carries its pay date", () => {
		const period = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2026-07",
		});
		expect(period.cutoffPeriodId).toBe("h1");
		expect(period.customFromDate).toBe("2026-07-01");
		expect(period.customToDate).toBe("2026-07-15");
		// Default h1 pays on the 22nd of the same month.
		expect(period.payDateIso).not.toBeNull();
		expect(new Date(period.payDateIso as string).getDate()).toBe(22);
	});

	it("second-half pay date rolls into the next month (offset 1)", () => {
		const period = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2026-07",
			cutoff_period: "h2",
		});
		const pay = new Date(period.payDateIso as string);
		expect(pay.getMonth()).toBe(7); // August (0-indexed)
		expect(pay.getDate()).toBe(7);
	});
});

describe("current_cutoff preset", () => {
	it("picks the period containing today", () => {
		const jul10 = new Date(2026, 6, 10);
		const period = resolveTeamLogPeriod(
			{ preset: "current_cutoff" },
			DEFAULT_PAY_PERIOD_CONFIG,
			jul10,
		);
		expect(period.cutoffPeriodId).toBe("h1");
		expect(period.customFromDate).toBe("2026-07-01");
		expect(period.customToDate).toBe("2026-07-15");
	});

	it("selects the second half on the boundary day 16", () => {
		const jul16 = new Date(2026, 6, 16);
		const { period } = currentPayPeriod(DEFAULT_PAY_PERIOD_CONFIG, jul16);
		expect(period.id).toBe("h2");
	});

	it("selects the first half on the boundary day 15", () => {
		const jul15 = new Date(2026, 6, 15);
		const { period } = currentPayPeriod(DEFAULT_PAY_PERIOD_CONFIG, jul15);
		expect(period.id).toBe("h1");
	});
});

describe("resolvePayPeriods with a custom config", () => {
	it("supports a single monthly 26–25 style period with EOM", () => {
		const config: PayPeriodConfig = {
			cadence: "monthly",
			periods: [
				{
					id: "full",
					label: "Monthly",
					start_day: 1,
					end_day: "EOM",
					pay_day: 5,
					pay_month_offset: 1,
				},
			],
		};
		const periods = resolvePayPeriods(config, "2026-02");
		expect(periods).toHaveLength(1);
		expect(periods[0].to.getDate()).toBe(28); // 2026 Feb is non-leap
		expect(periods[0].dayRangeLabel).toBe("1–EOM");
		expect(periods[0].payDate.getMonth()).toBe(2); // March
	});
});
