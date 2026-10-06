/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { LoggingOption, TimeEntryView } from "@/services/time.types";
import {
	StartTimerPrompts,
	SwitchTimerDialog,
	SwitchTimerPanel,
} from "./SwitchTimerDialog";
import {
	IDLE_START_STATE,
	promptOf,
	type StartTimerFlow,
	type StartTimerState,
} from "./useStartTimer";

const NOW = Date.parse("2026-10-06T10:00:00.000Z");

function running(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Design",
		timesheet_id: null,
		work_item: "task",
		started_at: new Date(NOW - 72 * 60_000).toISOString(),
		ended_at: null,
		paused_at: null,
		duration_seconds: null,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: "t1",
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: new Date(NOW).toISOString(),
		updated_at: new Date(NOW).toISOString(),
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
		cost: "hidden",
		...over,
	};
}

function option(
	kind: LoggingOption["kind"],
	id: string | null,
	label: string,
): LoggingOption {
	return {
		kind,
		id,
		label,
		sheet_scope: kind === "personal" ? null : { kind: "workspace", ref: "w" },
		rate_source: "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
	};
}

function fakeFlow(patch: Partial<StartTimerState>, pending = false) {
	const state: StartTimerState = { ...IDLE_START_STATE, ...patch };
	const prompt = state.step === "blocked" ? "blocked" : promptOf(state);
	const flow = {
		state,
		step: state.step,
		isPending: pending,
		isOpen: prompt !== null,
		prompt,
		start: vi.fn(),
		confirmSwitch: vi.fn(async () => "started"),
		select: vi.fn(),
		setRemember: vi.fn(),
		confirmPick: vi.fn(async () => "started"),
		withdrawAndRetry: vi.fn(async () => "started"),
		cancel: vi.fn(),
	};
	return flow as unknown as StartTimerFlow & typeof flow;
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("SwitchTimerPanel", () => {
	it("asks with the running task and its h:mm, then switches", () => {
		const onSwitch = vi.fn();
		const onCancel = vi.fn();
		render(
			<SwitchTimerPanel
				running={running()}
				onSwitch={onSwitch}
				onCancel={onCancel}
			/>,
		);
		expect(
			screen.getByText("Stop Fix login bug (1:12) and start this?"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Switch" }));
		expect(onSwitch).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onCancel).toHaveBeenCalled();
	});

	it("names a preset timer and shows an error", () => {
		render(
			<SwitchTimerPanel
				running={running({ task: null, task_id: null, work_item: "meeting" })}
				error="Proyekto couldn't reach the server. Try again."
				busy
				onSwitch={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		expect(screen.getByText(/^Stop Meeting \(1:12\)/)).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(
			"Proyekto couldn't reach the server. Try again.",
		);
		expect(
			(screen.getByRole("button", { name: "Switch" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});

describe("SwitchTimerDialog", () => {
	it("renders only while open", () => {
		const { rerender } = render(
			<SwitchTimerDialog
				open={false}
				running={running()}
				onSwitch={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		expect(screen.queryByText(/and start this\?/)).toBeNull();
		rerender(
			<SwitchTimerDialog
				open
				running={running()}
				onSwitch={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByText(/and start this\?/)).toBeTruthy();
	});
});

describe("StartTimerPrompts", () => {
	it("renders nothing while idle", () => {
		render(<StartTimerPrompts flow={fakeFlow({})} />);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("the Switch prompt confirms through the flow", () => {
		const flow = fakeFlow({
			step: "switch",
			request: { projectId: "p2" },
			running: running(),
		});
		render(<StartTimerPrompts flow={flow} />);
		fireEvent.click(screen.getByRole("button", { name: "Switch" }));
		expect(flow.confirmSwitch).toHaveBeenCalled();
	});

	it("the picker selects and confirms through the flow", () => {
		const team = option("team", "t1", "Design");
		const agreement = option("assignment", "a1", "Acme Corp");
		const flow = fakeFlow({
			step: "pick",
			request: { projectId: "p2" },
			result: {
				options: [team, agreement],
				selected: null,
				prefill: agreement,
				unavailable: [],
			},
			choice: { kind: "assignment", id: "a1" },
			choiceLabel: "Acme Corp",
		});
		render(<StartTimerPrompts flow={flow} />);
		fireEvent.click(screen.getAllByRole("radio")[1]);
		expect(flow.select).toHaveBeenCalledWith(team);
		fireEvent.click(screen.getByRole("checkbox"));
		expect(flow.setRemember).toHaveBeenCalledWith(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Start for Acme Corp" }),
		);
		expect(flow.confirmPick).toHaveBeenCalled();
	});

	it("keeps the picker on screen, busy, while the start runs", () => {
		const team = option("team", "t1", "Design");
		const flow = fakeFlow(
			{
				step: "starting",
				busyIn: "pick",
				request: { projectId: "p2" },
				result: {
					options: [team, option("workspace", "w1", "Acme")],
					selected: null,
					prefill: null,
					unavailable: [],
				},
				choice: { kind: "team", id: "t1" },
			},
			true,
		);
		render(<StartTimerPrompts flow={flow} />);
		const primary = screen.getByRole("button", { name: "Start for Design" });
		expect((primary as HTMLButtonElement).disabled).toBe(true);
	});

	it("the locked card offers Withdraw for a submitted sheet", () => {
		const flow = fakeFlow({
			step: "locked",
			request: { projectId: "p2" },
			locked: {
				timesheetId: "s1",
				sheetStatus: "submitted",
				label: "Prodigitality",
				periodKind: "weekly",
				canWithdraw: true,
				withdrawing: false,
				message:
					"This week's Prodigitality timesheet is submitted. Withdraw it to add time.",
			},
		});
		render(<StartTimerPrompts flow={flow} />);
		expect(
			screen.getByText(
				"This week's Prodigitality timesheet is submitted. Withdraw it to add time.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		expect(flow.withdrawAndRetry).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(flow.cancel).toHaveBeenCalled();
	});

	it("the locked card has only Close when Withdraw does not apply", () => {
		const flow = fakeFlow({
			step: "locked",
			request: { projectId: "p2" },
			error: "This period's timesheet is approved, so its time can't change.",
			locked: {
				timesheetId: "s1",
				sheetStatus: "approved",
				label: null,
				periodKind: null,
				canWithdraw: false,
				withdrawing: false,
				message:
					"This period's timesheet is approved, so its time can't change.",
			},
		});
		render(<StartTimerPrompts flow={flow} />);
		expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
		expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
	});

	it("the blocked card explains why", () => {
		const flow = fakeFlow({
			step: "blocked",
			request: { projectId: "p2" },
			blocked: {
				title: "You can't log time on this project",
				why: "You're a viewer on this project. Ask a project admin for editor access to log time.",
			},
		});
		render(<StartTimerPrompts flow={flow} />);
		expect(screen.getByText("You can't log time on this project")).toBeTruthy();
		expect(screen.getByText(/You're a viewer on this project/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(flow.cancel).toHaveBeenCalled();
	});

	it("opens as a popover anchored to the trigger", () => {
		const anchor = createRef<HTMLButtonElement>();
		const flow = fakeFlow({
			step: "switch",
			request: { projectId: "p2" },
			running: running(),
		});
		render(
			<>
				<button ref={anchor} type="button">
					timer
				</button>
				<StartTimerPrompts flow={flow} anchorRef={anchor} />
			</>,
		);
		const popover = screen.getByRole("dialog");
		expect(popover.getAttribute("aria-label")).toBe("Switch");
		expect(popover.getAttribute("aria-modal")).toBeNull();
	});

	it("names a locked popover by its sentence, not by a Withdraw it may not offer", () => {
		const anchor = createRef<HTMLButtonElement>();
		const message =
			"This period's timesheet is approved, so its time can't change.";
		const flow = fakeFlow({
			step: "locked",
			request: { projectId: "p2" },
			locked: {
				timesheetId: "s1",
				sheetStatus: "approved",
				label: null,
				periodKind: null,
				canWithdraw: false,
				withdrawing: false,
				message,
			},
		});
		render(
			<>
				<button ref={anchor} type="button">
					timer
				</button>
				<StartTimerPrompts flow={flow} anchorRef={anchor} />
			</>,
		);
		expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(message);
	});
});
