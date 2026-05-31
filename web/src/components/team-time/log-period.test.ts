import { describe, expect, it } from "vitest";
import { resolveTeamLogPeriod } from "./log-period";

describe("resolveTeamLogPeriod cutoff handling", () => {
	it("uses day 28 for non-leap February second cutoff", () => {
		const period = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2025-02",
			cutoff_half: "2",
		});
		expect(period.customFromDate).toBe("2025-02-16");
		expect(period.customToDate).toBe("2025-02-28");
	});

	it("uses day 29 for leap-year February second cutoff", () => {
		const period = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2024-02",
			cutoff_half: "2",
		});
		expect(period.customFromDate).toBe("2024-02-16");
		expect(period.customToDate).toBe("2024-02-29");
	});

	it("uses month end for 30 and 31 day months", () => {
		const april = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2026-04",
			cutoff_half: "2",
		});
		expect(april.customToDate).toBe("2026-04-30");

		const may = resolveTeamLogPeriod({
			preset: "cutoff",
			cutoff_month: "2026-05",
			cutoff_half: "2",
		});
		expect(may.customToDate).toBe("2026-05-31");
	});
});
