/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { TimeEntryView } from "@/services/time.types";
import { TimerBar } from "./TimerBar";
import type { ActiveTimer } from "./useActiveTimer";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: null,
		work_item: "task",
		started_at: "2026-10-06T09:00:00.000Z",
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
		created_at: "2026-10-06T09:00:00.000Z",
		updated_at: "2026-10-06T09:00:00.000Z",
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

function timer(over: Partial<ActiveTimer> = {}): ActiveTimer {
	const running = over.entry === undefined ? entry() : over.entry;
	return {
		entry: running,
		query: {} as ActiveTimer["query"],
		isRunning: Boolean(running),
		isPaused: Boolean(running?.paused_at),
		runningTaskId: running?.task_id ?? null,
		runningProjectId: running?.project_id ?? null,
		runningEntryId: running?.id ?? null,
		workSeconds: 4364,
		breakSeconds: 0,
		isBusy: false,
		isPausing: false,
		isStopping: false,
		pause: vi.fn(),
		resume: vi.fn(),
		toggleBreak: vi.fn(),
		stop: vi.fn(),
		stopAsync: vi.fn(async () => true),
		...over,
	};
}

function renderBar(ui: ReactElement) {
	const client = new QueryClient();
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

afterEach(() => {
	cleanup();
});

describe("TimerBar (full)", () => {
	it("shows the clock, the work, the project and a For chip, with Pause and Stop", () => {
		const t = timer();
		const { container } = renderBar(<TimerBar timer={t} />);
		expect(screen.getByTestId("timer-clock").textContent).toBe("01:12:44");
		expect(screen.getByText("Fix login bug")).toBeTruthy();
		expect(screen.getByText("· Acme Website")).toBeTruthy();
		expect(screen.getByText("For:")).toBeTruthy();
		expect(screen.getByText("Prodigitality Services…")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Pause" }));
		expect(t.toggleBreak).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Stop" }));
		expect(t.stop).toHaveBeenCalled();
		const bar = container.querySelector('[data-variant="full"]');
		expect(bar?.className).toContain("max-sm:sticky");
		expect(bar?.getAttribute("aria-label")).toBe("Timer running");
	});

	it("on a break: Resume and the break countdown", () => {
		const t = timer({
			entry: entry({ paused_at: "2026-10-06T10:00:00.000Z" }),
			isPaused: true,
			breakSeconds: 330,
		});
		renderBar(<TimerBar timer={t} />);
		expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
		expect(screen.getByTestId("timer-break").textContent).toBe("05:30");
		expect(screen.getAllByText("On break").length).toBeGreaterThan(0);
	});

	it("the running chip's ▾ hands the entry to Change For", () => {
		const onChangeFor = vi.fn();
		const t = timer();
		const { container } = renderBar(
			<TimerBar timer={t} onChangeFor={onChangeFor} />,
		);
		expect(container.querySelector('[data-variant="menu"]')).not.toBeNull();
		fireEvent.click(
			screen.getByTitle("Prodigitality Services Inc. Team").closest("button") ??
				document.body,
		);
		expect(onChangeFor).toHaveBeenCalledWith(t.entry);
	});

	it("marks a preset with ◦", () => {
		renderBar(
			<TimerBar
				timer={timer({
					entry: entry({ task: null, task_id: null, work_item: "review" }),
				})}
			/>,
		);
		expect(screen.getByText("◦ Review")).toBeTruthy();
	});

	it("locks the buttons while a call is in flight", () => {
		renderBar(<TimerBar timer={timer({ isBusy: true, isStopping: true })} />);
		for (const name of ["Pause", "Stop"]) {
			expect(
				(screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
			).toBe(true);
		}
	});

	it("idle: Start timer and Add time, plus the page's controls", () => {
		const onStartTimer = vi.fn();
		const onAddTime = vi.fn();
		renderBar(
			<TimerBar
				timer={timer({ entry: null })}
				onStartTimer={onStartTimer}
				onAddTime={onAddTime}
				idleExtra={<span>List | Month</span>}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
		expect(onStartTimer).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Add time" }));
		expect(onAddTime).toHaveBeenCalled();
		expect(screen.getByText("List | Month")).toBeTruthy();
	});

	it("idle without actions renders nothing", () => {
		const { container } = renderBar(
			<TimerBar timer={timer({ entry: null })} />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("the start button waits on the start flow", () => {
		renderBar(
			<TimerBar
				timer={timer({ entry: null })}
				onStartTimer={vi.fn()}
				starting
			/>,
		);
		expect(
			(screen.getByRole("button", { name: "Start timer" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});

describe("TimerBar (pill, approver mode)", () => {
	it("idle: a single Start timer pill", () => {
		const onStartTimer = vi.fn();
		const { container } = renderBar(
			<TimerBar
				variant="pill"
				timer={timer({ entry: null })}
				onStartTimer={onStartTimer}
				onAddTime={vi.fn()}
			/>,
		);
		expect(screen.getAllByRole("button")).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
		expect(onStartTimer).toHaveBeenCalled();
		expect(container.querySelector('[data-variant="pill"]')).not.toBeNull();
	});

	it("running: the clock and the controls, no task line", () => {
		renderBar(<TimerBar variant="pill" timer={timer()} />);
		expect(screen.getByTestId("timer-clock").textContent).toBe("01:12:44");
		expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
		expect(screen.queryByText("Fix login bug")).toBeNull();
	});
});
