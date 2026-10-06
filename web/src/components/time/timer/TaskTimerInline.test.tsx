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

import { TaskTimerInline } from "./TaskTimerInline";

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

const thisTaskRunning = (over: Partial<TimeEntryView> = {}) =>
	entry({
		project_id: PROJECT,
		task_id: "task-1",
		task: { id: "task-1", title: "Write docs", work_type: null, status: null },
		...over,
	});

let client: QueryClient;

function renderInline(
	ui: ReactElement,
	opts: { running?: TimeEntryView | null } = {},
) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	if (opts.running !== undefined) {
		client.setQueryData(timeKeys.running(USER), opts.running);
	}
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

const inline = <TaskTimerInline projectId={PROJECT} taskId="task-1" />;

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
	// The server echoes the last write: the poll after a write keeps it.
	vi.spyOn(timeService, "getRunning").mockImplementation(
		async () =>
			client?.getQueryData<TimeEntryView | null>(timeKeys.running(USER)) ??
			null,
	);
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("TaskTimerInline: no option", () => {
	it("says you can't log here, with the viewer Why? in a popover", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ reason: "none" }),
		);
		renderInline(inline, { running: null });

		expect(
			await screen.findByText("You can't log time on this project"),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Start timer" })).toBeNull();

		const why = screen.getByRole("button", { name: "Why?" });
		expect(why.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(why);
		const popover = await screen.findByRole("dialog", {
			name: "You can't log time on this project",
		});
		expect(popover.textContent).toBe(
			"You're a viewer on this project. Ask a project admin for editor access to log time.",
		);
		expect(why.getAttribute("aria-expanded")).toBe("true");
	});

	it("Escape closes the Why? popover without closing the panel around it", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ reason: "none" }),
		);
		const panelEscape = vi.fn();
		const onWindowKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") panelEscape();
		};
		window.addEventListener("keydown", onWindowKey);
		try {
			renderInline(inline, { running: null });
			fireEvent.click(await screen.findByRole("button", { name: "Why?" }));
			await screen.findByRole("dialog");
			fireEvent.keyDown(document.body, { key: "Escape" });
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			expect(panelEscape).not.toHaveBeenCalled();
		} finally {
			window.removeEventListener("keydown", onWindowKey);
		}
	});
});

describe("TaskTimerInline: idle", () => {
	it("renders nothing while the options load", () => {
		vi.spyOn(timeService, "getLoggingFor").mockReturnValue(
			new Promise(() => {}),
		);
		const { container } = renderInline(inline, { running: null });
		expect(container.textContent).toBe("");
	});

	it("1 option: the read-only chip with its note, and Start starts at once", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const start = vi.spyOn(timeService, "startEntry").mockResolvedValue({
			...thisTaskRunning({ id: "new-1" }),
			warnings: [],
		} as EntryWithWarnings);
		renderInline(inline, { running: null });

		const button = await screen.findByRole("button", { name: "Start timer" });
		expect(screen.getByText("For:")).toBeTruthy();
		const chip = screen.getByTitle(
			"Prodigitality Services Inc. Team · Only option on this project",
		);
		expect(chip.textContent).toContain("Prodigitality Services…");

		fireEvent.click(button);
		await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
		const body = start.mock.calls[0][0] as unknown as Record<string, unknown>;
		expect(body).toMatchObject({ project_id: PROJECT, task_id: "task-1" });
		expect(body).not.toHaveProperty("logging_for");
		// It now runs here: the clock and Stop replace Start.
		expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy();
	});

	it("2+ options with a remembered default: the picker preselects it and names it, nothing starts", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({
				options: [agreement, team],
				prefill: agreement,
				reason: "confirm",
			}),
		);
		const start = vi.spyOn(timeService, "startEntry");
		renderInline(inline, { running: null });

		fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));
		expect(
			await screen.findByRole("button", { name: "Start for Acme Corp" }),
		).toBeTruthy();
		expect(start).not.toHaveBeenCalled();
	});

	it("another task running: Start stays enabled and asks to Switch", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const stop = vi.spyOn(timeService, "stopEntry");
		renderInline(inline, { running: entry() });

		const button = await screen.findByRole("button", { name: "Start timer" });
		expect((button as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(button);
		expect(
			await screen.findByText(
				/^Stop Fix login bug \(\d+:\d\d\) and start this\?$/,
			),
		).toBeTruthy();
		expect(stop).not.toHaveBeenCalled();
	});
});

describe("TaskTimerInline: this task running", () => {
	it("shows the live clock, the entry's For, Pause and Stop", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const pause = vi
			.spyOn(timeService, "pauseEntry")
			.mockResolvedValue(
				thisTaskRunning({ paused_at: new Date().toISOString() }),
			);
		renderInline(inline, { running: thisTaskRunning() });

		const cluster = await screen.findByRole("region", {
			name: "Timer running",
		});
		expect(screen.getByTestId("timer-clock").textContent).toMatch(
			/^01:1\d:\d\d$/,
		);
		expect(cluster.textContent).toContain("Prodigitality Services…");
		fireEvent.click(screen.getByRole("button", { name: "Pause" }));
		await waitFor(() => expect(pause).toHaveBeenCalledWith("running-1"));
	});

	it("on a break: Resume and the break clock", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const resume = vi
			.spyOn(timeService, "resumeEntry")
			.mockResolvedValue(thisTaskRunning());
		renderInline(inline, {
			running: thisTaskRunning({
				paused_at: new Date(Date.now() - 90_000).toISOString(),
			}),
		});

		expect(
			await screen.findByRole("region", { name: "On break" }),
		).toBeTruthy();
		expect(screen.getByTestId("timer-break").textContent).toMatch(/01:3\d/);
		// Readable on a tint: a solid success fill would hide the same-hue label.
		const resumeButton = screen.getByRole("button", { name: "Resume" });
		expect(resumeButton.className).toContain("bg-success/15");
		expect(resumeButton.className).not.toMatch(/(^|\s)bg-success(\s|$)/);
		fireEvent.click(resumeButton);
		await waitFor(() => expect(resume).toHaveBeenCalledWith("running-1"));
	});

	it("Stop stops it and Start comes back", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const stop = vi
			.spyOn(timeService, "stopEntry")
			.mockResolvedValue(thisTaskRunning({ ended_at: "x" }));
		renderInline(inline, { running: thisTaskRunning() });

		fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
		await waitFor(() => expect(stop).toHaveBeenCalledWith("running-1"));
		expect(
			await screen.findByRole("button", { name: "Start timer" }),
		).toBeTruthy();
		await act(async () => {});
	});
});
