/* @vitest-environment jsdom */

// The dialog forms of the start prompts have an accessible name (W0 review
// defect 6): AppDialog names a titleless dialog through `ariaLabel`.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimeEntryView } from "@/services/time.types";
import { StartTimerPrompts, SwitchTimerDialog } from "./SwitchTimerDialog";
import {
	IDLE_START_STATE,
	promptOf,
	type StartTimerFlow,
	type StartTimerState,
} from "./useStartTimer";

const running = {
	id: "e1",
	started_at: new Date(Date.now() - 4320_000).toISOString(),
	ended_at: null,
	paused_at: null,
	duration_seconds: null,
	break_seconds: 0,
	break_minutes: 0,
	work_item: "task",
	content_label: null,
	task: { id: "t1", title: "Fix login bug", work_type: null, status: null },
} as unknown as TimeEntryView;

function fakeFlow(patch: Partial<StartTimerState>): StartTimerFlow {
	const state: StartTimerState = { ...IDLE_START_STATE, ...patch };
	return {
		state,
		step: state.step,
		isPending: false,
		isOpen: true,
		prompt: state.step === "blocked" ? "blocked" : promptOf(state),
		start: vi.fn(),
		confirmSwitch: vi.fn(),
		select: vi.fn(),
		setRemember: vi.fn(),
		confirmPick: vi.fn(),
		withdrawAndRetry: vi.fn(),
		cancel: vi.fn(),
	} as unknown as StartTimerFlow;
}

afterEach(() => {
	cleanup();
});

describe("start prompt dialogs are named", () => {
	it("SwitchTimerDialog", () => {
		render(
			<SwitchTimerDialog
				open
				running={running}
				onSwitch={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		expect(screen.getByRole("dialog", { name: "Switch" })).toBeTruthy();
	});

	it("StartTimerPrompts without an anchor: the Switch prompt", () => {
		render(
			<StartTimerPrompts
				flow={fakeFlow({
					step: "switch",
					request: { projectId: "p1", taskId: "t2" },
					running,
				})}
			/>,
		);
		expect(screen.getByRole("dialog", { name: "Switch" })).toBeTruthy();
	});

	it("StartTimerPrompts without an anchor: the blocked card, by its title", () => {
		render(
			<StartTimerPrompts
				flow={fakeFlow({
					step: "blocked",
					request: { projectId: "p1" },
					blocked: {
						title: "You can't log time on this project",
						why: "You're a viewer on this project. Ask a project admin for editor access to log time.",
					},
				})}
			/>,
		);
		expect(
			screen.getByRole("dialog", {
				name: "You can't log time on this project",
			}),
		).toBeTruthy();
	});

	it("StartTimerPrompts without an anchor: the locked card, by its sentence", () => {
		const message =
			"This week's Acme timesheet is submitted. Withdraw it to add time.";
		render(
			<StartTimerPrompts
				flow={fakeFlow({
					step: "locked",
					request: { projectId: "p1" },
					locked: {
						timesheetId: "s1",
						sheetStatus: "submitted",
						label: "Acme",
						periodKind: "weekly",
						canWithdraw: true,
						withdrawing: false,
						message,
					},
				})}
			/>,
		);
		expect(screen.getByRole("dialog", { name: message })).toBeTruthy();
	});
});
