/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimeEntryView } from "@/services/time.types";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { TimeSummaryCards, timeSummary } from "./TimeSummaryCards";

const MANILA = "Asia/Manila";
const NOW = Date.parse("2026-10-08T03:00:00.000Z");

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Team",
		timesheet_id: null,
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:00:00.000Z",
		paused_at: null,
		duration_seconds: 3 * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "manual",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_assignment_id: null,
		created_at: "2026-10-05T04:00:00.000Z",
		updated_at: "2026-10-05T04:00:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: null,
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Fix login bug",
			work_type: null,
			status: null,
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
	};
}

/** Three entries on two Manila days: 3 h and 1.5 h on Mon, 2 h on Wed. */
const ENTRIES = [
	entry(),
	entry({
		id: "e2",
		started_at: "2026-10-05T06:00:00.000Z",
		ended_at: "2026-10-05T07:30:00.000Z",
		duration_seconds: 1.5 * 3600,
	}),
	// 23:00 UTC on Oct 6 is Wed Oct 7 in Manila.
	entry({
		id: "e3",
		started_at: "2026-10-06T23:00:00.000Z",
		ended_at: "2026-10-07T01:00:00.000Z",
		duration_seconds: 2 * 3600,
	}),
];

afterEach(() => cleanup());

describe("timeSummary", () => {
	it("totals the hours, counts entries and distinct local days, and averages per day logged", () => {
		const summary = timeSummary(ENTRIES, { timeZone: MANILA, nowMs: NOW });
		expect(summary.seconds).toBe(6.5 * 3600);
		expect(summary.entries).toBe(3);
		expect(summary.days).toBe(2);
		expect(summary.avgSeconds).toBe(3.25 * 3600);
		// Cost hidden: no amount at all.
		expect(summary.amounts).toBeNull();
	});

	it("reads days in the view's timezone", () => {
		// In UTC the Wednesday entry starts on Tuesday: still two days.
		expect(timeSummary(ENTRIES, { timeZone: "UTC", nowMs: NOW }).days).toBe(2);
		expect(
			timeSummary(ENTRIES.slice(0, 2), { timeZone: MANILA, nowMs: NOW }).days,
		).toBe(1);
	});

	it("is all zeros with nothing shown (no division by zero)", () => {
		expect(timeSummary([], { timeZone: MANILA, nowMs: NOW })).toEqual({
			seconds: 0,
			entries: 0,
			days: 0,
			avgSeconds: 0,
			amounts: null,
			amountSource: null,
		});
	});

	it("counts a running timer live", () => {
		const running = entry({
			id: "run",
			started_at: "2026-10-08T02:00:00.000Z",
			ended_at: null,
			duration_seconds: null,
		});
		expect(
			timeSummary([running], { timeZone: MANILA, nowMs: NOW }).seconds,
		).toBe(3600);
	});

	it("sums money per currency only where an amount may show", () => {
		const priced = [
			entry({ cost: "visible", rate_snapshot: 500, currency_snapshot: "PHP" }),
			entry({
				id: "e2",
				cost: "visible",
				payable_seconds: 3600,
				amount_snapshot: 450,
				rate_snapshot: 450,
				currency_snapshot: "PHP",
			}),
			entry({
				id: "e3",
				cost: "visible",
				rate_snapshot: 20,
				currency_snapshot: "USD",
			}),
			// Hidden cost never counts.
			entry({ id: "e4", cost: "hidden", rate_snapshot: 999 }),
		] as TimeEntryView[];
		const summary = timeSummary(priced, { timeZone: MANILA, nowMs: NOW });
		expect(summary.amounts).toEqual({ PHP: 1950, USD: 60 });
		// On native, agreement time never shows money.
		const agreement = priced.map((item) => ({
			...item,
			context_kind: "assignment" as const,
		}));
		expect(
			timeSummary(agreement, { timeZone: MANILA, nowMs: NOW, native: true })
				.amounts,
		).toBeNull();
	});
});

describe("TimeSummaryCards", () => {
	it("shows the four cards, and no Amount card when no amount may show", () => {
		render(
			<TimeSummaryCards entries={ENTRIES} timeZone={MANILA} nowMs={NOW} />,
		);
		const value = (key: string) =>
			screen.getByTestId(`time-summary-${key}-value`).textContent;
		expect(value("total")).toBe("6.50");
		expect(value("entries")).toBe("3");
		expect(value("days")).toBe("2");
		expect(value("avg")).toBe("3.25");
		expect(screen.queryByTestId("time-summary-amount")).toBeNull();
		expect(screen.getByText("Avg / day")).toBeTruthy();
	});

	it("adds the Amount card when the money rule allows it", () => {
		render(
			<TimeSummaryCards
				entries={[
					entry({
						cost: "visible",
						rate_snapshot: 500,
						currency_snapshot: "PHP",
					}) as TimeEntryView,
				]}
				timeZone={MANILA}
				nowMs={NOW}
			/>,
		);
		expect(
			screen.getByTestId("time-summary-amount-value").textContent,
		).toContain("1,500.00");
	});

	it("lays out as a two-column grid on phones", () => {
		render(<TimeSummaryCards entries={[]} timeZone={MANILA} nowMs={NOW} />);
		expect(screen.getByTestId("time-summary").className).toContain(
			"grid-cols-2",
		);
		expect(screen.getByTestId("time-summary-avg-value").textContent).toBe(
			"0.00",
		);
	});
});
