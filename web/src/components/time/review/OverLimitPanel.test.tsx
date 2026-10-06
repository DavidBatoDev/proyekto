/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { OverLimitPanel } from "./OverLimitPanel";

afterEach(cleanup);

const agreement = {
	source: "agreement" as const,
	label: "Acme Corp",
	limitMinutes: 2400,
	loggedSeconds: 43.5 * 3600,
};

describe("OverLimitPanel", () => {
	it("shows the agreement line and the overtime box to a decider", () => {
		const onChange = vi.fn();
		render(
			<OverLimitPanel
				overSeconds={3.5 * 3600}
				payableSeconds={40 * 3600}
				reading={agreement}
				canDecide
				checked={false}
				onCheckedChange={onChange}
			/>,
		);
		const panel = screen.getByTestId("review-over-limit");
		expect(panel.textContent).toContain(
			"Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over",
		);
		const box = screen.getByRole("checkbox", {
			name: "Approve the 3h 30m over the limit",
		});
		expect(box.getAttribute("aria-describedby")).toBeTruthy();
		expect(panel.textContent).toContain(
			"Left unticked, 40:00 is approved for payment; the extra time stays on record.",
		);
		fireEvent.click(box);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it("takes logged and over from the preview when rounding moved them", () => {
		render(
			<OverLimitPanel
				overSeconds={3.5 * 3600}
				payableSeconds={40 * 3600}
				countedSeconds={43.5 * 3600}
				// Raw logged time 43:20; 15-minute rounding makes it 43:30.
				reading={{ ...agreement, loggedSeconds: 43 * 3600 + 20 * 60 }}
				canDecide
				checked={false}
				onCheckedChange={() => {}}
			/>,
		);
		const panel = screen.getByTestId("review-over-limit");
		expect(panel.textContent).toContain(
			"Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over",
		);
		// The head and the box agree on the overtime.
		expect(
			screen.getByRole("checkbox", {
				name: "Approve the 3h 30m over the limit",
			}),
		).toBeTruthy();
	});

	it("names a member cap by its hours when there is no agreement line", () => {
		render(
			<OverLimitPanel
				overSeconds={2 * 3600}
				payableSeconds={35 * 3600}
				canDecide={false}
				checked={false}
				onCheckedChange={() => {}}
			/>,
		);
		expect(screen.getByTestId("review-over-limit").textContent).toBe(
			"2:00 over the limit",
		);
		// Readers who can't approve get no box.
		expect(screen.queryByRole("checkbox")).toBeNull();
	});

	it("renders nothing when nothing is over", () => {
		const { container } = render(
			<OverLimitPanel
				overSeconds={0}
				payableSeconds={40 * 3600}
				canDecide
				checked={false}
				onCheckedChange={() => {}}
			/>,
		);
		expect(container.textContent).toBe("");
	});
});
