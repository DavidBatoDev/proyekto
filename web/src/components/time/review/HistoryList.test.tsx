/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { event, NOW, TZ } from "./__fixtures__/reviewFixtures";
import { HistoryList } from "./HistoryList";
import { historyItems } from "./reviewModel";

afterEach(cleanup);

describe("HistoryList", () => {
	it("lists the history oldest first with dates, times and notes", () => {
		const items = historyItems(
			[
				event({
					id: 1,
					event: "legacy_import",
					created_at: "2026-09-29T01:00:00.000Z",
				}),
				event({
					id: 2,
					event: "returned",
					note: "Split Thu",
					created_at: "2026-09-30T02:00:00.000Z",
				}),
				event({
					id: 3,
					event: "submitted",
					from_status: "returned",
					created_at: "2026-10-01T01:00:00.000Z",
				}),
			],
			{ timeZone: TZ, now: NOW },
		);
		render(<HistoryList items={items} />);
		const section = screen.getByRole("region", { name: "History" });
		const rows = within(section).getAllByRole("listitem");
		expect(rows.map((r) => r.textContent)).toEqual([
			"Imported from per-entry review Sep 29",
			"Returned Sep 30'Split Thu'",
			"Resubmitted Oct 1",
		]);
		const time = rows[1].querySelector("time");
		expect(time?.getAttribute("dateTime")).toBe("2026-09-30T02:00:00.000Z");
		expect(time?.getAttribute("title")).toBe("Sep 30, 10:00");
	});

	it("says when nothing has happened yet", () => {
		render(<HistoryList items={[]} />);
		expect(
			screen.getByText("Nothing has happened to this timesheet yet."),
		).toBeTruthy();
	});
});
