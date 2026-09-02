import { describe, expect, it } from "vitest";
import {
	normalizeTeamStatus,
	TEAM_STATUS_CONFIG,
	teamStatusLabel,
} from "./teamStatus";

describe("normalizeTeamStatus", () => {
	it("passes the three real statuses through", () => {
		expect(normalizeTeamStatus("active")).toBe("active");
		expect(normalizeTeamStatus("paused")).toBe("paused");
		expect(normalizeTeamStatus("archived")).toBe("archived");
	});

	it("falls back to active for a missing value", () => {
		// Not hypothetical: `status` is optional on the Team type precisely
		// because query-cache entries persisted before the column shipped carry
		// no value, and those rehydrate on the next visit.
		expect(normalizeTeamStatus(undefined)).toBe("active");
		expect(normalizeTeamStatus(null)).toBe("active");
		expect(normalizeTeamStatus("")).toBe("active");
	});

	it("falls back to active rather than rendering an unknown status", () => {
		expect(normalizeTeamStatus("deleted")).toBe("active");
	});

	it("tolerates case and surrounding whitespace", () => {
		expect(normalizeTeamStatus("  Paused ")).toBe("paused");
		expect(normalizeTeamStatus("ARCHIVED")).toBe("archived");
	});
});

describe("teamStatusLabel", () => {
	it("gives every status a human label", () => {
		expect(teamStatusLabel("active")).toBe("Active");
		expect(teamStatusLabel("paused")).toBe("Paused");
		expect(teamStatusLabel("archived")).toBe("Archived");
	});

	it("labels an unknown status as Active rather than blank", () => {
		expect(teamStatusLabel("nonsense")).toBe("Active");
	});
});

describe("TEAM_STATUS_CONFIG", () => {
	it("gives every status both a label and a hint, since the picker shows both", () => {
		for (const [status, config] of Object.entries(TEAM_STATUS_CONFIG)) {
			expect(config.label, status).toBeTruthy();
			expect(config.hint, status).toBeTruthy();
		}
	});
});
