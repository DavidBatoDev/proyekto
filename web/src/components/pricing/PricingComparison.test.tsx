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

	it("draws the time ladder: personal time on every plan, then one tier per key", () => {
		render(<PricingComparison limits={DEFAULT_PLAN_LIMITS} />);
		const included = (label: string) =>
			planCells(label).map((cell) =>
				cell.textContent === `${label}: included`
					? true
					: cell.textContent === `${label}: not included`
						? false
						: cell.textContent,
			);
		expect(included("Personal time tracking")).toEqual([
			true,
			true,
			true,
			true,
		]);
		expect(included("Timesheets and approvals")).toEqual([
			false,
			true,
			true,
			true,
		]);
		expect(included("Billable hours on invoices")).toEqual([
			false,
			true,
			true,
			true,
		]);
		expect(included("Team approvers and time rules")).toEqual([
			false,
			false,
			true,
			true,
		]);
		expect(included("Payouts")).toEqual([false, false, true, true]);
		expect(included("Workspace time reports and export")).toEqual([
			false,
			false,
			true,
			true,
		]);
		expect(included("Custom approval chains")).toEqual([
			false,
			false,
			false,
			true,
		]);
		expect(included("Time audit export")).toEqual([false, false, false, true]);
	});

	it("puts the agreement note inside the Time tracking group header", () => {
		render(<PricingComparison limits={DEFAULT_PLAN_LIMITS} />);
		const header = Array.from(
			document.querySelectorAll<HTMLElement>('th[scope="colgroup"]'),
		).find((th) => th.textContent?.startsWith("Time tracking"));
		expect(header?.textContent).toBe(
			"Time trackingTime logged under a client or talent agreement is never limited by plan.",
		);
		// Only that group carries a note.
		const withNotes = Array.from(
			document.querySelectorAll('th[scope="colgroup"] span'),
		);
		expect(withNotes).toHaveLength(1);
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
