/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimePageSearch } from "@/lib/timeSearch";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import {
	activeFilterCount,
	CLEAR_FILTERS,
	TIME_FILTERS_COPY,
	TimeFilterBar,
} from "./TimeFilterBar";
import { viewRangeFor } from "./useTimePageData";

const TODAY = "2026-10-06";
const PROJECTS = [
	{ id: "p1", title: "Acme Website" },
	{ id: "p2", title: "Rebrand" },
];

function renderBar(
	search: TimePageSearch = {},
	props: Partial<Parameters<typeof TimeFilterBar>[0]> = {},
) {
	const onSearchChange = vi.fn();
	const view = render(
		<TimeFilterBar
			search={search}
			onSearchChange={onSearchChange}
			range={viewRangeFor(search, TODAY)}
			today={TODAY}
			projects={PROJECTS}
			shortcuts={false}
			{...props}
		/>,
	);
	return { ...view, onSearchChange };
}

afterEach(() => cleanup());

describe("TimeFilterBar", () => {
	it("shows the date trigger, Project and search; no Clear by default", () => {
		renderBar();
		expect(screen.getByTestId("time-range-label").textContent).toBe(
			"This week · Oct 5 – 11",
		);
		// The old preset menu and date inputs are gone.
		expect(screen.queryByTestId("time-range-preset")).toBeNull();
		expect(screen.queryByTestId("time-range-from")).toBeNull();
		expect(
			Array.from(
				(screen.getByTestId("time-project-filter") as HTMLSelectElement)
					.options,
			).map((o) => o.textContent),
		).toEqual(["All projects", "Acme Website", "Rebrand"]);
		expect(screen.getByTestId("time-search")).toBeTruthy();
		expect(screen.queryByTestId("time-filters-clear")).toBeNull();
	});

	it("hides Status unless the workspace approves time", () => {
		renderBar();
		expect(screen.queryByTestId("time-status-filter")).toBeNull();
		cleanup();
		const { onSearchChange } = renderBar({}, { showStatus: true });
		fireEvent.change(screen.getByTestId("time-status-filter"), {
			target: { value: "returned" },
		});
		expect(onSearchChange).toHaveBeenLastCalledWith({ status: "returned" });
	});

	it("writes the project, and a preset from the picker", () => {
		const { onSearchChange } = renderBar();
		fireEvent.change(screen.getByTestId("time-project-filter"), {
			target: { value: "p2" },
		});
		expect(onSearchChange).toHaveBeenLastCalledWith({ project: "p2" });
		fireEvent.click(screen.getByTestId("time-range-trigger"));
		fireEvent.click(screen.getByTestId("date-preset-last_30_days"));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			week: undefined,
			preset: "last_30_days",
			from: undefined,
			to: undefined,
		});
		// A preset closes the picker.
		expect(screen.queryByTestId("date-range-picker")).toBeNull();
	});

	it("labels a range that is no preset with its dates, and steps it", () => {
		const { onSearchChange } = renderBar({ week: "2026-08-12" });
		expect(screen.getByTestId("time-range-label").textContent).toBe(
			"Aug 10 – 16, 2026",
		);
		fireEvent.click(screen.getByRole("button", { name: "Next period" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			week: "2026-08-17",
			preset: undefined,
			from: undefined,
			to: undefined,
		});
	});

	it("says when a long range was cut", () => {
		renderBar({ from: "2026-01-01", to: "2026-12-31" });
		expect(screen.getByTestId("time-range-capped").textContent).toBe(
			TIME_FILTERS_COPY.capped,
		);
		expect(screen.getByTestId("time-range-label").textContent).toBe(
			"Jan 1 – Apr 3, 2026",
		);
	});

	it("Clear resets every filter, dates included", () => {
		const { onSearchChange } = renderBar({ preset: "last_week" });
		// A non-default range alone offers Clear.
		fireEvent.click(screen.getByTestId("time-filters-clear"));
		expect(onSearchChange).toHaveBeenLastCalledWith(CLEAR_FILTERS);
		expect(Object.values(CLEAR_FILTERS).every((v) => v === undefined)).toBe(
			true,
		);
	});

	it("on phones folds the filters behind Filters, with the active count", () => {
		renderBar(
			{ preset: "this_month", q: "docs", status: "open" },
			{ compact: true, showStatus: true },
		);
		const button = screen.getByTestId("time-filters-button");
		expect(button.getAttribute("aria-label")).toBe("Filters, 2 active");
		expect(screen.getByTestId("time-filters-count").textContent).toBe("2");
		expect(screen.queryByTestId("time-search")).toBeNull();
		// ‹ dates › stay on the page.
		expect(screen.getByTestId("time-range-trigger")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Previous period" }),
		).toBeTruthy();
		fireEvent.click(button);
		const popover = screen.getByTestId("time-filters-popover");
		expect(
			popover.querySelector("[data-testid='time-status-filter']"),
		).toBeTruthy();
		expect(popover.querySelector("[data-testid='time-search']")).toBeTruthy();
	});

	it("counts the folded filters", () => {
		expect(activeFilterCount({})).toBe(0);
		expect(
			activeFilterCount({
				project: "p1",
				for: "personal",
				q: " ",
				status: "open",
			}),
		).toBe(3);
	});
});
