/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PLAN_LIMITS } from "@/lib/planLimits";
import { PricingComparison } from "./PricingComparison";

afterEach(cleanup);

/**
 * The four plan cells of the row whose header starts with `label`, Free
 * first. Plain DOM queries rather than `getByRole`: computing accessible names
 * over a 40-row table takes seconds in jsdom.
 */
function planCells(label: string): HTMLElement[] {
	const header = Array.from(
		document.querySelectorAll<HTMLElement>('th[scope="row"]'),
	).find((th) => th.textContent?.startsWith(label));
	const tableRow = header?.closest("tr");
	if (!tableRow) throw new Error(`No row for ${label}`);
	return Array.from(tableRow.querySelectorAll("td"));
}

describe("PricingComparison", () => {
	it("renders the published matrix from the seed", () => {
		render(<PricingComparison limits={DEFAULT_PLAN_LIMITS} />);
		expect(planCells("Projects").map((cell) => cell.textContent)).toEqual([
			"2",
			"10",
			"Unlimited",
			"Unlimited",
		]);
		expect(planCells("Members")[0].textContent).toBe("Up to 10");
		expect(planCells("MCP server")[3].textContent).toBe("Higher limits");
		expect(planCells("AI messages")[2].textContent).toBe(
			"2,000 / seat / month",
		);
	});

	it("shows an edited limit in its row", () => {
		const limits = {
			...DEFAULT_PLAN_LIMITS,
			free: {
				...DEFAULT_PLAN_LIMITS.free,
				projects: {
					kind: "count" as const,
					value: 3,
					per_seat: false,
					display_label: null,
				},
			},
		};
		render(<PricingComparison limits={limits} />);
		expect(planCells("Projects")[0].textContent).toBe("3");
		// Only the edited cell moves.
		expect(planCells("Teams")[0].textContent).toBe("2");
	});

	it("draws a switched-off feature as not included", () => {
		const limits = {
			...DEFAULT_PLAN_LIMITS,
			pro: {
				...DEFAULT_PLAN_LIMITS.pro,
				change_requests: {
					kind: "feature" as const,
					enabled: false,
					display_label: null,
				},
			},
		};
		render(<PricingComparison limits={limits} />);
		expect(planCells("Change requests")[1].textContent).toBe(
			"Change requests: not included",
		);
		expect(planCells("Deliverables")[1].textContent).toBe(
			"Deliverables: included",
		);
	});
});
