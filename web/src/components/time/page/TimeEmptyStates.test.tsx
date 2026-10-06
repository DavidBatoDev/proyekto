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
	it("approver mode is caught up, with the hint only without policy cards (P5 vs P7)", () => {
		expect(pickTimeEmptyState(overview({ approver_mode: true }))).toEqual({
			kind: "caught_up",
			hint: true,
		});
		expect(
			pickTimeEmptyState(
				overview({
					approver_mode: true,
					workspace_time_admin: [
						{
							workspace_id: "w1",
							name: "Acme",
							slug: "acme",
							has_time_tracking: true,
							policy_unconfirmed: false,
						},
					],
				}),
			),
		).toEqual({ kind: "caught_up", hint: false });
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

	it("one team or workspace context names it (P3)", () => {
		expect(
			pickTimeEmptyState(
				overview({
					contexts: [
						context("team", "Prodigitality Services Inc. Team"),
						context("personal", "Just me", null),
					],
				}),
			),
		).toEqual({ kind: "team", label: "Prodigitality Services Inc. Team" });
		expect(
			pickTimeEmptyState(
				overview({ contexts: [context("workspace", "Acme")] }),
			),
		).toEqual({ kind: "team", label: "Acme" });
	});

	it("several contexts, or an agreement beside a team, fall back to the starter line", () => {
		expect(
			pickTimeEmptyState(
				overview({
					contexts: [context("team", "Design"), context("team", "Ops", "t2")],
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

	it("a caller-known team label covers a member with no recent time", () => {
		expect(
			pickTimeEmptyState(overview(), { teamLabel: "Design team" }),
		).toEqual({ kind: "team", label: "Design team" });
	});

	it("no overview yet reads as the starter line (P1)", () => {
		expect(pickTimeEmptyState(null)).toEqual({ kind: "start" });
	});
});

describe("timeEmptyText", () => {
	it("uses the ux.md sentences", () => {
		expect(timeEmptyText({ kind: "start" }).title).toBe(
			"Track time on your tasks. Start a timer from any task, or add time you've already worked.",
		);
		expect(timeEmptyText({ kind: "team", label: "Acme" }).title).toBe(
			"You log time for Acme. Start a timer from a task, or add time.",
		);
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

	it("a team pick without a label falls back to the starter line", () => {
		expect(timeEmptyText({ kind: "team", label: "  " }).title).toBe(
			TIME_EMPTY_COPY.start,
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
				kind="team"
				label="Acme"
				onStartTimer={() => {}}
				action={<a href="/somewhere">Open</a>}
			/>,
		);
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
	});
});
