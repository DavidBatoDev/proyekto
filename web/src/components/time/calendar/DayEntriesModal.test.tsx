/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { TimeEntryView } from "@/services/time.types";
import {
	DAY_ENTRIES_COPY,
	DayEntriesModal,
	entryCountText,
	entrySeconds,
	needsReview,
} from "./DayEntriesModal";

const TZ = "Asia/Manila";
// Mon Oct 5 2026, 15:00 in Manila.
const NOW = Date.parse("2026-10-05T07:00:00.000Z");

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Design",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 12_600,
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
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: "Maria",
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
		cost: "visible",
		...over,
	};
}

const meeting = entry({
	id: "e2",
	task: null,
	task_id: null,
	work_item: "meeting",
	started_at: "2026-10-05T05:00:00.000Z",
	ended_at: "2026-10-05T06:00:00.000Z",
	duration_seconds: 3600,
});

function renderDay(props: Partial<Parameters<typeof DayEntriesModal>[0]> = {}) {
	const handlers = {
		onClose: vi.fn(),
		onOpenEntry: vi.fn(),
		onEditEntry: vi.fn(),
		onChangeFor: vi.fn(),
		onDeleteEntry: vi.fn(),
		onAddTime: vi.fn(),
		onStartTimer: vi.fn(),
	};
	render(
		<DayEntriesModal
			open
			date="2026-10-05"
			entries={[meeting, entry()]}
			timeZone={TZ}
			nowMs={NOW}
			{...handlers}
			{...props}
		/>,
	);
	return handlers;
}

function openMenu(entryId: string) {
	const row = document.querySelector(`tr[data-entry-id="${entryId}"]`);
	const trigger = row?.querySelector('button[aria-label="Entry actions"]');
	if (!trigger) throw new Error("no menu trigger");
	fireEvent.click(trigger);
}

function menuLabels(): string[] {
	// RowActionsMenu portals its items into a fixed panel on the body.
	const menu = document.querySelector('div[class*="min-w-[200px]"]');
	return Array.from(menu?.querySelectorAll("button") ?? []).map(
		(b) => b.textContent ?? "",
	);
}

afterEach(() => {
	cleanup();
});

describe("helpers", () => {
	it("counts entries and running time", () => {
		expect(entryCountText(1)).toBe("1 entry");
		expect(entryCountText(3)).toBe("3 entries");
		const running = entry({
			ended_at: null,
			duration_seconds: null,
			break_seconds: 600,
		});
		// 6 h since 01:00Z, minus a 10 min break.
		expect(entrySeconds(running, NOW)).toBe(6 * 3600 - 600);
		const paused = { ...running, paused_at: "2026-10-05T03:00:00.000Z" };
		expect(entrySeconds(paused, NOW)).toBe(2 * 3600 - 600);
	});

	it("flags entries of 10 h or more, and cron-flagged ones", () => {
		expect(needsReview(entry())).toBe(false);
		expect(needsReview(entry({ duration_seconds: 36_000 }))).toBe(true);
		expect(needsReview(entry({ flagged_reason: "auto_stopped_24h" }))).toBe(
			true,
		);
	});
});

describe("DayEntriesModal", () => {
	it("lists the day's entries by start time with the day total", () => {
		renderDay();
		expect(screen.getByRole("dialog").textContent).toMatch(
			/Mon Oct 5(, 2026)?/,
		);
		expect(screen.getByText("2 entries")).toBeTruthy();
		expect(screen.getByText("4:30")).toBeTruthy();
		const ids = Array.from(document.querySelectorAll("tr[data-entry-id]")).map(
			(row) => row.getAttribute("data-entry-id"),
		);
		expect(ids).toEqual(["e1", "e2"]);
		expect(screen.getAllByText("Meeting").length).toBeGreaterThan(0);
		expect(screen.getAllByText("09:00").length).toBeGreaterThan(0);
		expect(screen.queryByLabelText(DAY_ENTRIES_COPY.longDay)).toBeNull();
	});

	it("warns on a day over 8 hours and flags a long entry", () => {
		renderDay({
			entries: [entry({ duration_seconds: 36_000 })],
		});
		expect(screen.getByLabelText(DAY_ENTRIES_COPY.longDay)).toBeTruthy();
		expect(screen.getByLabelText(DAY_ENTRIES_COPY.needsReview)).toBeTruthy();
	});

	it("shows a running timer to now", () => {
		renderDay({
			entries: [entry({ ended_at: null, duration_seconds: null })],
		});
		expect(screen.getAllByText("now").length).toBeGreaterThan(0);
		// The day total and the row both read 6:00.
		expect(screen.getAllByText("6:00").length).toBe(2);
	});

	it("offers the full menu on an open entry", () => {
		const handlers = renderDay();
		openMenu("e1");
		expect(menuLabels()).toEqual([
			"View details",
			"Edit",
			"Change For…",
			"Delete",
		]);
		fireEvent.click(screen.getByText("Change For…"));
		expect(handlers.onChangeFor).toHaveBeenCalledWith(
			expect.objectContaining({ id: "e1" }),
		);
		openMenu("e1");
		fireEvent.click(screen.getByText("Edit"));
		expect(handlers.onEditEntry).toHaveBeenCalled();
		openMenu("e1");
		fireEvent.click(screen.getByText("Delete"));
		expect(handlers.onDeleteEntry).toHaveBeenCalled();
	});

	it("keeps only View details and Comment on a locked entry", () => {
		const handlers = renderDay({
			entries: [
				entry({
					locked_reason: "sheet_submitted",
					timesheet: {
						id: "s1",
						status: "submitted",
						period_start: "2026-10-05",
						period_end: "2026-10-11",
						decision_kind: null,
						decided_by: null,
						decided_at: null,
						decision_note: null,
						scope_label_snapshot: "Design",
					},
				}),
			],
		});
		openMenu("e1");
		expect(menuLabels()).toEqual(["View details", "Comment"]);
		fireEvent.click(screen.getByText("Comment"));
		expect(handlers.onOpenEntry).toHaveBeenCalledWith(
			expect.objectContaining({ id: "e1" }),
			{ zIndex: 1210, focus: "comments" },
		);
	});

	it("opens the entry detail above itself from the task title", () => {
		const handlers = renderDay();
		fireEvent.click(screen.getByRole("button", { name: "Fix login bug" }));
		expect(handlers.onOpenEntry).toHaveBeenCalledWith(
			expect.objectContaining({ id: "e1" }),
			{ zIndex: 1210 },
		);
	});

	it("adds time for the day, and starts a timer only on today", () => {
		const handlers = renderDay();
		fireEvent.click(screen.getByRole("button", { name: "Add time" }));
		expect(handlers.onClose).toHaveBeenCalled();
		expect(handlers.onAddTime).toHaveBeenCalledWith("2026-10-05");
		fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
		expect(handlers.onStartTimer).toHaveBeenCalled();
		cleanup();
		renderDay({ date: "2026-10-04", entries: [] });
		expect(screen.queryByRole("button", { name: "Start timer" })).toBeNull();
		expect(screen.getByText(DAY_ENTRIES_COPY.empty)).toBeTruthy();
	});

	it("badges paid time", () => {
		renderDay({
			entries: [entry({ payout_id: "po1", locked_reason: "paid" })],
		});
		expect(screen.getByText("Paid")).toBeTruthy();
	});
});
