/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import {
	WeeklyLimitLine,
	weeklyLimitText,
	weeklyLimitTone,
} from "./WeeklyLimitLine";

afterEach(cleanup);

const policy = {
	source: "policy" as const,
	label: "Prodigitality",
	limitMinutes: 2400,
	loggedSeconds: 38 * 3600 + 15 * 60,
};

describe("WeeklyLimitLine", () => {
	it("reads the policy limit as an indicator (D65)", () => {
		render(<WeeklyLimitLine reading={policy} />);
		const line = screen.getByTestId("review-weekly-limit");
		expect(line.textContent).toBe(
			"Weekly limit 40h (Prodigitality) · 38:15 logged · within limit",
		);
		expect(line.getAttribute("data-tone")).toBe("near");
	});

	it("stays amber past a policy limit and never says hours are cut", () => {
		const over = { ...policy, loggedSeconds: 43.5 * 3600 };
		expect(weeklyLimitTone(over)).toBe("over");
		expect(weeklyLimitText(over)).toBe(
			"Weekly limit 40h (Prodigitality) · 43:30 logged · 3:30 over",
		);
		expect(weeklyLimitText(over)).not.toMatch(/cut|unpaid|not paid|payable/i);
	});

	it("turns red past an agreement's limit, which cuts pay", () => {
		const agreement = {
			source: "agreement" as const,
			label: "Acme Corp",
			limitMinutes: 2400,
			loggedSeconds: 43.5 * 3600,
		};
		expect(weeklyLimitTone(agreement)).toBe("over_cut");
		expect(weeklyLimitText(agreement)).toBe(
			"Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over",
		);
		expect(weeklyLimitTone({ ...agreement, loggedSeconds: 10 * 3600 })).toBe(
			"neutral",
		);
	});
});
