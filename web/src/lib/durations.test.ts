import { describe, expect, it } from "vitest";
import {
	CUSTOM_DURATION,
	DURATION_LABELS,
	DURATION_OPTIONS,
	describeDuration,
} from "@/lib/durations";

describe("describeDuration", () => {
	it("labels a bucket", () => {
		expect(describeDuration("2-4_weeks")).toBe("2–4 weeks");
	});

	it("prefers the author's own words for a custom timeline", () => {
		expect(describeDuration(CUSTOM_DURATION, "about ten weeks")).toBe(
			"about ten weeks",
		);
	});

	it("says nothing for a custom timeline with nothing written", () => {
		expect(describeDuration(CUSTOM_DURATION, "   ")).toBeNull();
		expect(describeDuration(CUSTOM_DURATION, null)).toBeNull();
	});

	it("still labels the two buckets retired from the picker", () => {
		expect(describeDuration("<1_month")).toBe("Less than 1 month");
		expect(describeDuration("6+_months")).toBe("6+ months");
		expect(DURATION_OPTIONS.map((option) => option.value)).not.toContain(
			"<1_month",
		);
	});

	it("says nothing rather than printing a code it does not know", () => {
		expect(describeDuration("next_tuesday")).toBeNull();
		expect(describeDuration(null)).toBeNull();
	});

	it("has a label for every offered option", () => {
		for (const option of DURATION_OPTIONS) {
			expect(DURATION_LABELS[option.value]).toBe(option.label);
		}
	});

	it("keeps the escape hatch out of the pickable list", () => {
		expect(DURATION_OPTIONS.map((option) => option.value)).not.toContain(
			CUSTOM_DURATION,
		);
	});
});
