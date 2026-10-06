/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeKeys } from "@/queries/time";
import { timeService } from "@/services/time.service";
import type {
	EntryWithWarnings,
	LoggingForResult,
	LoggingOption,
	TimeEntryView,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import {
	STOP_TIMER_LABEL,
	STOP_TIMER_ON_BREAK_LABEL,
	TaskTimerButton,
} from "./TaskTimerButton";

const USER = "user-1";
const PROJECT = "p1";
const TEAM = "11111111-1111-4111-8111-111111111111";
const ASG = "33333333-3333-4333-8333-333333333333";

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

const team = option("team", TEAM, "Prodigitality Services Inc. Team");
const agreement = option("assignment", ASG, "Acme Corp");

function forResult(over: Partial<LoggingForResult>): LoggingForResult {
	return {
		options: [],
		selected: null,
		prefill: null,
		unavailable: [],
		...over,
	};
}

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "running-1",
		context_kind: "team",
		context_ref: TEAM,
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: null,
		work_item: "task",
		started_at: new Date(Date.now() - 4320_000).toISOString(),
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
		project_id: "p0",
		team_id: TEAM,
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: USER,
		member_display_name_snapshot: "Maria",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-0",
		note: null,
		task: {
			id: "task-0",
			title: "Fix login bug",
			work_type: null,
			status: null,
		},
		project: { id: "p0", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
	};
}

function started(over: Partial<TimeEntryView> = {}): EntryWithWarnings {
	return {
		...entry({
			id: "new-1",
			project_id: PROJECT,
			task_id: "task-1",
			task: {
				id: "task-1",
				title: "Write docs",
				work_type: null,
				status: null,
			},
			...over,
		}),
		warnings: [],
	};
}

let client: QueryClient;
/** What GET me/running answers (the poll after every write reads it). */
let serverRunning: TimeEntryView | null = null;

function renderButton(
	ui: ReactElement,
	opts: { running?: TimeEntryView | null } = {},
) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	if (opts.running !== undefined) {
		serverRunning = opts.running;
		client.setQueryData(timeKeys.running(USER), opts.running);
	}
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

/** A row that reacts to clicks, like the canvas and the task lists. */
function Row({ onRowClick }: { onRowClick: () => void }) {
	return (
		<div data-testid="row" onClick={onRowClick}>
			<TaskTimerButton projectId={PROJECT} taskId="task-1" />
		</div>
	);
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
	serverRunning = null;
	vi.spyOn(timeService, "getRunning").mockImplementation(
		async () => serverRunning,
	);
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("TaskTimerButton visibility", () => {
	it("renders nothing for a project with no option (a viewer)", async () => {
		const read = vi
			.spyOn(timeService, "getLoggingFor")
			.mockResolvedValue(forResult({ reason: "none" }));
		renderButton(<TaskTimerButton projectId={PROJECT} taskId="task-1" />);
		await waitFor(() => expect(read).toHaveBeenCalledWith(PROJECT));
		await act(async () => {});
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("renders nothing until the options are known", () => {
		vi.spyOn(timeService, "getLoggingFor").mockReturnValue(
			new Promise(() => {}),
		);
		renderButton(<TaskTimerButton projectId={PROJECT} taskId="task-1" />);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("signed out (a guest on a shared roadmap): no button and no request", async () => {
		useAuthStore.setState({ user: null });
		const read = vi.spyOn(timeService, "getLoggingFor");
		renderButton(<TaskTimerButton projectId={PROJECT} taskId="task-1" />);
		await act(async () => {});
		expect(read).not.toHaveBeenCalled();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("still offers Stop on its running task when the project has no option now", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ reason: "none" }),
		);
		renderButton(<TaskTimerButton projectId={PROJECT} taskId="task-1" />, {
			running: entry({ project_id: PROJECT, task_id: "task-1" }),
		});
		expect(
			await screen.findByRole("button", { name: STOP_TIMER_LABEL }),
		).toBeTruthy();
	});
});

describe("TaskTimerButton start", () => {
	it("1 option: starts at once, sends no For, never reaches the row, and keeps the same button for Stop", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockImplementation(async () => {
				serverRunning = started();
				return started();
			});
		const onRowClick = vi.fn();
		renderButton(<Row onRowClick={onRowClick} />, { running: null });

		const button = await screen.findByRole("button", { name: "Start timer" });
		expect(button.getAttribute("data-timer-state")).toBe("idle");
		fireEvent.click(button);

		await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
		const body = start.mock.calls[0][0] as unknown as Record<string, unknown>;
		expect(body).toMatchObject({ project_id: PROJECT, task_id: "task-1" });
		expect(body).not.toHaveProperty("logging_for");
		expect(onRowClick).not.toHaveBeenCalled();

		const stop = await screen.findByRole("button", { name: STOP_TIMER_LABEL });
		// The same element: keyboard focus survives the flip to Stop.
		expect(stop).toBe(button);
		expect(stop.getAttribute("data-timer-state")).toBe("running");
	});

	it("2+ options: opens the For picker instead of starting; clicks inside it stay out of the row", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [agreement, team], reason: "required" }),
		);
		const start = vi.spyOn(timeService, "startEntry");
		const onRowClick = vi.fn();
		renderButton(<Row onRowClick={onRowClick} />, { running: null });

		fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));
		const trigger = document.querySelector('[data-timer-state="idle"]');
		const picker = await screen.findByRole("dialog", {
			name: "Choose who this time is for",
		});
		expect(start).not.toHaveBeenCalled();

		// The popover is portaled to <body>, but React bubbles its events
		// through the component tree: the boundary keeps them from the row.
		fireEvent.click(picker);
		fireEvent.mouseDown(picker);
		expect(onRowClick).not.toHaveBeenCalled();
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
	});

	it("Escape closes only the prompt, not the panel the row sits in", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [agreement, team], reason: "required" }),
		);
		const panelEscape = vi.fn();
		const onWindowKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") panelEscape();
		};
		// The roadmap SidePanel closes on a window keydown (bubble phase).
		window.addEventListener("keydown", onWindowKey);
		try {
			renderButton(<TaskTimerButton projectId={PROJECT} taskId="task-1" />, {
				running: null,
			});
			fireEvent.click(
				await screen.findByRole("button", { name: "Start timer" }),
			);
			await screen.findByRole("dialog", {
				name: "Choose who this time is for",
			});
			fireEvent.keyDown(document.body, { key: "Escape" });
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			expect(panelEscape).not.toHaveBeenCalled();

			// With no prompt open, Escape goes on to the panel as before.
			fireEvent.keyDown(document.body, { key: "Escape" });
			expect(panelEscape).toHaveBeenCalledTimes(1);
		} finally {
			window.removeEventListener("keydown", onWindowKey);
		}
	});

	it("another task running: the button is not disabled; it asks to Switch, then stops and starts", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const stop = vi
			.spyOn(timeService, "stopEntry")
			.mockImplementation(async () => {
				serverRunning = null;
				return entry({ ended_at: new Date().toISOString() });
			});
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockImplementation(async () => {
				serverRunning = started();
				return started();
			});
		renderButton(<TaskTimerButton projectId={PROJECT} taskId="task-1" />, {
			running: entry(),
		});

		const button = await screen.findByRole("button", { name: "Start timer" });
		expect((button as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(button);

		expect(
			await screen.findByText(
				/^Stop Fix login bug \(\d+:\d\d\) and start this\?$/,
			),
		).toBeTruthy();
		expect(stop).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Switch" }));
		await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
		expect(stop).toHaveBeenCalledWith("running-1");
		expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
			start.mock.invocationCallOrder[0],
		);
	});
});

describe("TaskTimerButton reads", () => {
	it("rows read the running timer without polling it (the page polls)", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		renderButton(
			<>
				<TaskTimerButton projectId={PROJECT} taskId="task-1" />
				<TaskTimerButton projectId={PROJECT} taskId="task-2" />
				<TaskTimerButton projectId={PROJECT} taskId="task-3" />
			</>,
			{ running: entry() },
		);
		expect(
			await screen.findAllByRole("button", { name: "Start timer" }),
		).toHaveLength(3);
		const observers =
			client.getQueryCache().find({ queryKey: timeKeys.running(USER) })
				?.observers ?? [];
		expect(observers).toHaveLength(3);
		for (const observer of observers) {
			expect(observer.options.refetchInterval).toBe(false);
		}
		// One For read for the rows of one project.
		expect(timeService.getLoggingFor).toHaveBeenCalledTimes(1);
	});
});

describe("TaskTimerButton stop", () => {
	it("this task running: Stop stops it", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const stop = vi
			.spyOn(timeService, "stopEntry")
			.mockImplementation(async () => {
				serverRunning = null;
				return entry({ project_id: PROJECT, task_id: "task-1", ended_at: "x" });
			});
		const onRowClick = vi.fn();
		renderButton(<Row onRowClick={onRowClick} />, {
			running: entry({ project_id: PROJECT, task_id: "task-1" }),
		});

		const button = await screen.findByRole("button", {
			name: STOP_TIMER_LABEL,
		});
		await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
		fireEvent.click(button);
		await waitFor(() => expect(stop).toHaveBeenCalledWith("running-1"));
		expect(onRowClick).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(client.getQueryData(timeKeys.running(USER))).toBeNull(),
		);
		expect(toast.success).toHaveBeenCalledWith("Timer stopped.");
	});

	it("on a break the button says so", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		renderButton(<TaskTimerButton projectId={PROJECT} taskId="task-1" />, {
			running: entry({
				project_id: PROJECT,
				task_id: "task-1",
				paused_at: new Date().toISOString(),
			}),
		});
		expect(
			await screen.findByRole("button", { name: STOP_TIMER_ON_BREAK_LABEL }),
		).toBeTruthy();
	});
});
