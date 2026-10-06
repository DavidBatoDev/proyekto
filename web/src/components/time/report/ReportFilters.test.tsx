/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { NOW, U1, U2 } from "./__fixtures__/reportFixtures";
import { pickerPeriod, ReportFilters } from "./ReportFilters";

afterEach(cleanup);

const range = { from: "2026-09-01", to: "2026-09-30" };
const people = [
	{ id: U1, label: "Maria Santos" },
	{ id: U2, label: "Leo Cruz" },
];

function openPeriod(container: HTMLElement) {
	const trigger = container.querySelector(
		"button[aria-expanded]:not([aria-haspopup])",
	) as HTMLButtonElement;
	fireEvent.click(trigger);
}

function pick(trigger: string, option: string) {
	fireEvent.click(screen.getByRole("button", { name: trigger }));
	fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("ReportFilters", () => {
	it("counts a preset in the scope's timezone", () => {
		const onRangeChange = vi.fn();
		const { container } = render(
			<ReportFilters
				range={range}
				onRangeChange={onRangeChange}
				timezone="Asia/Manila"
				weekStart={1}
				now={NOW}
			/>,
		);
		openPeriod(container);
		fireEvent.click(screen.getByRole("button", { name: "This month" }));
		expect(onRangeChange).toHaveBeenCalledWith({
			from: "2026-10-01",
			to: "2026-10-31",
		});
		openPeriod(container);
		fireEvent.click(screen.getByRole("button", { name: "This week" }));
		expect(onRangeChange).toHaveBeenLastCalledWith({
			from: "2026-10-05",
			to: "2026-10-11",
		});
	});

	it("filters by person, For, status and grouping", () => {
		const onPersonChange = vi.fn();
		const onForChange = vi.fn();
		const onStatusChange = vi.fn();
		const onGroupChange = vi.fn();
		render(
			<ReportFilters
				range={range}
				onRangeChange={vi.fn()}
				timezone="Asia/Manila"
				people={people}
				onPersonChange={onPersonChange}
				forKinds={["team", "workspace", "assignment"]}
				onForChange={onForChange}
				showStatus
				onStatusChange={onStatusChange}
				groups={["person", "project", "task", "day", "week"]}
				group="person"
				onGroupChange={onGroupChange}
			/>,
		);
		pick("All people", "Maria Santos");
		expect(onPersonChange).toHaveBeenCalledWith(U1);
		pick("For: all", "For: agreement");
		expect(onForChange).toHaveBeenCalledWith("assignment");
		pick("All statuses", "Submitted");
		expect(onStatusChange).toHaveBeenCalledWith("submitted");
		pick("Group by person", "Group by week");
		expect(onGroupChange).toHaveBeenCalledWith("week");
	});

	it("clears a filter back to undefined and names a person outside the list", () => {
		const onPersonChange = vi.fn();
		render(
			<ReportFilters
				range={range}
				onRangeChange={vi.fn()}
				timezone="Asia/Manila"
				people={people}
				person="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
				onPersonChange={onPersonChange}
			/>,
		);
		pick("Selected person", "All people");
		expect(onPersonChange).toHaveBeenCalledWith(undefined);
	});

	it("renders only the controls it is given options for", () => {
		render(
			<ReportFilters
				range={range}
				onRangeChange={vi.fn()}
				timezone="Asia/Manila"
				people={null}
				onPersonChange={vi.fn()}
				forKinds={[]}
				onForChange={vi.fn()}
				groups={[]}
				onGroupChange={vi.fn()}
				leading={<span>Everyone</span>}
				trailing={<button type="button">Export</button>}
			/>,
		);
		expect(screen.queryByRole("button", { name: "All people" })).toBeNull();
		expect(screen.queryByRole("button", { name: "For: all" })).toBeNull();
		expect(screen.queryByRole("button", { name: "All statuses" })).toBeNull();
		expect(document.body.textContent).toContain("Everyone");
		expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
	});

	it("offers pay cut-offs only when asked", () => {
		const { container, rerender } = render(
			<ReportFilters
				range={range}
				onRangeChange={vi.fn()}
				timezone="Asia/Manila"
			/>,
		);
		openPeriod(container);
		expect(
			screen.queryByRole("button", { name: "Current cut-off" }),
		).toBeNull();
		rerender(
			<ReportFilters
				range={range}
				onRangeChange={vi.fn()}
				timezone="Asia/Manila"
				cutoffs={{ config: null }}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Current cut-off" }),
		).toBeTruthy();
	});

	it("feeds the picker a period that matches its presets and cut-offs", () => {
		const ctx = { timezone: "Asia/Manila", weekStart: 1, now: NOW };
		expect(
			pickerPeriod({ from: "2026-10-01", to: "2026-10-31" }, ctx).preset,
		).toBe("this_month");
		const cutoff = pickerPeriod(
			{ from: "2026-09-16", to: "2026-09-30" },
			ctx,
			null,
		);
		expect(cutoff).toMatchObject({
			preset: "cutoff",
			cutoffMonth: "2026-09",
			cutoffPeriodId: "h2",
			customFromDate: "2026-09-16",
			customToDate: "2026-09-30",
		});
		expect(pickerPeriod(range, ctx).preset).toBe("custom");
	});
});
