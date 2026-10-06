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
import { MobileDayCards } from "./MobileDayCards";
import { buildReviewGrid } from "./reviewModel";

const grid = buildReviewGrid(sheet(), entries(), { nowMs: NOW.getTime() });

afterEach(cleanup);

describe("MobileDayCards", () => {
	it("stacks one card per day with time, with project lines and ⚠", () => {
		const { container } = render(
			<MobileDayCards
				grid={grid}
				filter={null}
				onFilter={() => {}}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		const days = [...container.querySelectorAll("[data-day]")].map((el) =>
			el.getAttribute("data-day"),
		);
		// Sat and Sun have no time.
		expect(days).toEqual([
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-24",
			"2026-09-25",
		]);
		const thu = container.querySelector(
			'[data-day="2026-09-24"]',
		) as HTMLElement;
		expect(
			within(thu).getByRole("button", {
				name: "Thu Sep 24: 11:40 (over 8 hours)",
			}),
		).toBeTruthy();
		expect(
			within(thu)
				.getAllByRole("button")
				.map((b) => b.getAttribute("aria-label")),
		).toEqual([
			"Thu Sep 24: 11:40 (over 8 hours)",
			"Acme Website, Thu Sep 24: 8:10",
			"Internal ops, Thu Sep 24: 3:30",
		]);
		expect(screen.getByTestId("review-cards-total").textContent).toBe("18:00");
	});

	it("filters by a project line or a day, and clears on a second press", () => {
		const onFilter = vi.fn();
		const { rerender } = render(
			<MobileDayCards
				grid={grid}
				filter={null}
				onFilter={onFilter}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Acme Website, Thu Sep 24: 8:10" }),
		);
		expect(onFilter).toHaveBeenLastCalledWith({
			rowKey: "p1",
			date: "2026-09-24",
		});
		rerender(
			<MobileDayCards
				grid={grid}
				filter={{ rowKey: null, date: "2026-09-21" }}
				onFilter={onFilter}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		const mon = screen.getByRole("button", { name: "Mon Sep 21: 4:00" });
		expect(mon.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(mon);
		expect(onFilter).toHaveBeenLastCalledWith(null);
	});
});
