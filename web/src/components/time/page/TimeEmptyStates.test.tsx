/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { OverviewContext, TimeOverview } from "@/services/time.types";
import {
	pickTimeEmptyState,
	TIME_EMPTY_COPY,
	TimeEmptyState,
	timeEmptyText,
} from "./TimeEmptyStates";

function context(
	kind: OverviewContext["kind"],
	label: string,
	id: string | null = `${kind}-1`,
): OverviewContext {
	return {
		kind,
		id,
		label,
		sheet_scope: null,
		current_sheet: null,
	};
}

function overview(over: Partial<TimeOverview> = {}): TimeOverview {
	return {
		can_log: true,
		approver_mode: false,
		contexts: [],
		approvals_waiting: 0,
		workspace_time_admin: [],
		...over,
	};
}

afterEach(() => {
	cleanup();
});

describe("pickTimeEmptyState", () => {
	it("ignores approver_mode: one layout, one empty state", () => {
		expect(pickTimeEmptyState(overview({ approver_mode: true }))).toEqual(
			pickTimeEmptyState(overview({ approver_mode: false })),
		);
	});

	it("nobody can log yet: the placed-on-a-project line (P6)", () => {
		expect(pickTimeEmptyState(overview({ can_log: false }))).toEqual({
			kind: "placed",
		});
	});

	it("filters that match nothing get the filter line", () => {
		expect(pickTimeEmptyState(overview(), { filtered: true })).toEqual({
			kind: "filtered",
		});
	});

	it("a single team or workspace context never names it (it could be another workspace's)", () => {
		expect(
			pickTimeEmptyState(
				overview({
					contexts: [context("team", "Design")],
				}),
			),
		).toEqual({ kind: "start" });
		expect(
			pickTimeEmptyState(
				overview({
					contexts: [context("team", "Design"), context("assignment", "Acme")],
				}),
			),
		).toEqual({ kind: "start" });
	});

	it("no overview yet reads as the starter line (P1)", () => {
		expect(pickTimeEmptyState(null)).toEqual({ kind: "start" });
	});
});

describe("timeEmptyText", () => {
	it("uses the ux.md sentences", () => {
		expect(timeEmptyText({ kind: "start" })).toEqual({
			title: "No time logged this week",
			detail:
				"Start a timer when you begin work, or add time you already spent.",
		});
		expect(timeEmptyText({ kind: "no_projects", label: "Test" })).toEqual({
			title: "Nothing to log time on in Test yet.",
			detail: "Time is logged on this workspace's projects.",
		});
		expect(timeEmptyText({ kind: "caught_up" })).toEqual({
			title: "You're all caught up.",
			detail: "Timesheets sent to you will show up here.",
		});
		expect(timeEmptyText({ kind: "caught_up", hint: false })).toEqual({
			title: "You're all caught up.",
			detail: null,
		});
		expect(timeEmptyText({ kind: "placed" }).title).toBe(
			"When you're placed on a project, you'll be able to log time for it here.",
		);
	});
});

describe("TimeEmptyState", () => {
	it("a logger's card offers Start timer and Add time", () => {
		const onStartTimer = vi.fn();
		const onAddTime = vi.fn();
		const { container } = render(
			<TimeEmptyState
				kind="start"
				onStartTimer={onStartTimer}
				onAddTime={onAddTime}
			/>,
		);
		expect(screen.getByRole("status").getAttribute("data-empty")).toBe("start");
		expect(screen.getByText(TIME_EMPTY_COPY.start)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
		fireEvent.click(screen.getByRole("button", { name: "Add time" }));
		expect(onStartTimer).toHaveBeenCalledTimes(1);
		expect(onAddTime).toHaveBeenCalledTimes(1);
		// Theme tokens only.
		expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
	});

	it("caught up offers no logging buttons and shows the hint", () => {
		render(<TimeEmptyState kind="caught_up" onStartTimer={() => {}} />);
		expect(screen.getByText("You're all caught up.")).toBeTruthy();
		expect(
			screen.getByText("Timesheets sent to you will show up here."),
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("the inline variant is one line for a section that already has a heading", () => {
		render(<TimeEmptyState kind="caught_up" hint={false} variant="inline" />);
		const status = screen.getByRole("status");
		expect(status.textContent).toBe("You're all caught up.");
	});

	it("a custom action replaces the buttons", () => {
		render(
			<TimeEmptyState
				kind="no_projects"
				label="Acme"
				onStartTimer={() => {}}
				action={<a href="/somewhere">Open</a>}
			/>,
		);
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
	});
});
