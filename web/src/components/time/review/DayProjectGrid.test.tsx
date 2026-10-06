/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entries, NOW, sheet, TZ } from "./__fixtures__/reviewFixtures";
import { DayProjectGrid } from "./DayProjectGrid";
import { buildReviewGrid, HIDDEN_ROW_KEY } from "./reviewModel";

const grid = buildReviewGrid(sheet(), entries(), { nowMs: NOW.getTime() });

afterEach(cleanup);

describe("DayProjectGrid", () => {
	it("renders days, rows, totals and ⚠ on days over 8h", () => {
		render(
			<DayProjectGrid
				grid={grid}
				filter={null}
				onFilter={() => {}}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		const table = screen.getByRole("table", {
			name: "Hours by project and day",
		});
		const headers = within(table).getAllByRole("columnheader");
		// Project, Mon…Sun, Total.
		expect(headers).toHaveLength(9);
		expect(headers[1].textContent).toContain("Mon");
		expect(headers[1].textContent).toContain("21");
		expect(
			within(table)
				.getAllByRole("rowheader")
				.map((h) => h.textContent),
		).toEqual([
			"Acme Website",
			"Internal ops",
			"Projects you can't open",
			"Total",
		]);
		expect(
			within(table).getByRole("button", {
				name: "Total, Thu Sep 24: 11:40 (over 8 hours)",
			}),
		).toBeTruthy();
		// Under 8h: no ⚠.
		expect(
			within(table).getByRole("button", { name: "Total, Mon Sep 21: 4:00" }),
		).toBeTruthy();
		expect(screen.getByTestId("review-grid-total").textContent).toBe("18:00");
	});

	it("presses a cell, a row total and a day total into filters", () => {
		const onFilter = vi.fn();
		const { rerender } = render(
			<DayProjectGrid
				grid={grid}
				filter={null}
				onFilter={onFilter}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Projects you can't open, Tue Sep 22: 1:00",
			}),
		);
		expect(onFilter).toHaveBeenLastCalledWith({
			rowKey: HIDDEN_ROW_KEY,
			date: "2026-09-22",
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Acme Website, total: 12:10" }),
		);
		expect(onFilter).toHaveBeenLastCalledWith({ rowKey: "p1", date: null });
		fireEvent.click(
			screen.getByRole("button", {
				name: "Total, Thu Sep 24: 11:40 (over 8 hours)",
			}),
		);
		expect(onFilter).toHaveBeenLastCalledWith({
			rowKey: null,
			date: "2026-09-24",
		});

		// The active cell reads pressed; pressing it again clears.
		rerender(
			<DayProjectGrid
				grid={grid}
				filter={{ rowKey: "p1", date: null }}
				onFilter={onFilter}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		const active = screen.getByRole("button", {
			name: "Acme Website, total: 12:10",
		});
		expect(active.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(active);
		expect(onFilter).toHaveBeenLastCalledWith(null);
	});

	it("leaves empty cells as text, not buttons", () => {
		render(<DayProjectGrid grid={grid} filter={null} onFilter={() => {}} />);
		// Sat and Sun have no time: no buttons in those columns.
		expect(screen.queryByRole("button", { name: /Sat Sep 26/ })).toBeNull();
	});
});
