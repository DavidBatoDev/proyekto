import { describe, expect, it } from "vitest";
import { formatAvailability, formatMonthYear } from "./formatters";

describe("formatAvailability", () => {
	it("words each enum value for a reader", () => {
		expect(formatAvailability("available")).toBe("Available for new work");
		expect(formatAvailability("partially_available")).toBe("Partly available");
		expect(formatAvailability("unavailable")).toBe("Not taking new work");
	});

	it("passes unknown values through rather than guessing", () => {
		expect(formatAvailability("sabbatical")).toBe("sabbatical");
	});
});

describe("formatMonthYear", () => {
	it("renders a month and year, never a clock reading", () => {
		expect(formatMonthYear("2026-08-01T00:00:00Z")).toMatch(/August\s2026/);
	});

	it("returns null for missing or unparseable input", () => {
		expect(formatMonthYear(null)).toBeNull();
		expect(formatMonthYear("not-a-date")).toBeNull();
	});
});
