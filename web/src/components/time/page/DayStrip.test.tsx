/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeEntryView } from "@/services/time.types";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { DayStrip, dayButtonLabel } from "./DayStrip";

const MANILA = "Asia/Manila";
const WEEK = { start: "2026-10-05", end: "2026-10-11" };
const NOW_MS = new Date("2026-10-06T03:00:00.000Z").getTime();

function entry(
	id: string,
	startIso: string,
	hours: number | null,
): TimeEntryView {
	const start = Date.parse(startIso);
	return {
		id,
		context_kind: "personal",
		context_ref: null,
		context_label_snapshot: null,
		timesheet_id: null,
		work_item: "task",
		started_at: startIso,
		ended_at:
			hours === null ? null : new Date(start + hours * 3600_000).toISOString(),
		paused_at: null,
		duration_seconds: hours === null ? null : hours * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: null,
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: startIso,
		updated_at: startIso,
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: null,
		member: null,
		member_label: null,
		content: "visible",
		task_id: "t",
		note: null,
		task: null,
		project: null,
		content_label: null,
		cost: "hidden",
	};
}

const ENTRIES = [
	entry("a", "2026-10-05T01:00:00.000Z", 6),
	entry("b", "2026-10-05T08:00:00.000Z", 3),
	entry("c", "2026-10-07T01:00:00.000Z", 1.5),
	entry("run", "2026-10-06T01:00:00.000Z", null),
];

function renderStrip(over: Partial<Parameters<typeof DayStrip>[0]> = {}) {
	const onSelectDay = vi.fn();
	const view = render(
		<DayStrip
			entries={ENTRIES}
			week={WEEK}
			timeZone={MANILA}
			today="2026-10-06"
			selectedDay={null}
			onSelectDay={onSelectDay}
			nowMs={NOW_MS}
			{...over}
		/>,
	);
	return { ...view, onSelectDay };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW_MS);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("DayStrip", () => {
	it("totals each day, live for a running timer, with the week", () => {
		renderStrip();
		const totals = screen
			.getAllByTestId("day-total")
			.map((el) => el.textContent);
		expect(totals).toEqual(["9:00", "2:00", "1:30", "–", "–", "–", "–"]);
		expect(screen.getByTestId("week-total").textContent).toContain("12:30");
		expect(
			screen.getByRole("region", { name: "Days in this week" }),
		).toBeTruthy();
	});

	it("flags a day over 8 hours and names today", () => {
		renderStrip();
		const monday = screen.getByRole("button", {
			name: "Mon Oct 5, 9h, over 8 hours",
		});
		expect(monday.getAttribute("aria-pressed")).toBe("false");
		expect(
			screen.getByRole("button", { name: "Tue Oct 6, 2h, today" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Sun Oct 11, no time" }),
		).toBeTruthy();
	});

	it("picks a day, and picking it again shows the whole week", () => {
		const { onSelectDay, rerender } = renderStrip();
		fireEvent.click(screen.getByRole("button", { name: /^Wed Oct 7/ }));
		expect(onSelectDay).toHaveBeenLastCalledWith("2026-10-07");
		rerender(
			<DayStrip
				entries={ENTRIES}
				week={WEEK}
				timeZone={MANILA}
				today="2026-10-06"
				selectedDay="2026-10-07"
				onSelectDay={onSelectDay}
				nowMs={NOW_MS}
			/>,
		);
		const wed = screen.getByRole("button", { name: /^Wed Oct 7/ });
		expect(wed.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(wed);
		expect(onSelectDay).toHaveBeenLastCalledWith(null);
	});

	it("repeats the zone label under the strip for phones", () => {
		const { container } = renderStrip({ zoneText: "Your time (Asia/Manila)" });
		const footer = container.querySelector(".sm\\:hidden") as HTMLElement;
		expect(within(footer).getByTestId("time-zone-label").textContent).toContain(
			"Your time (Asia/Manila)",
		);
		expect(footer.textContent).toContain("12:30");
	});

	it("labels a day for screen readers", () => {
		expect(
			dayButtonLabel({
				date: "2026-10-01",
				seconds: 9 * 3600 + 20 * 60,
				over: true,
				isToday: true,
			}),
		).toBe("Thu Oct 1, 9h 20m, over 8 hours, today");
	});
});
