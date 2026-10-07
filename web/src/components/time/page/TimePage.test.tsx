/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimePageSearch } from "@/lib/timeSearch";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	TimeEntryView,
	TimeOverview,
	TimesheetDetail,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			className,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className}>
					{children}
				</a>
			);
		},
	};
});
const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: () => ({
		status: "ready",
		usage: null,
		plan: null,
		isComplimentary: false,
		hasFeature: () => true,
	}),
}));
const WS = {
	id: "w1",
	name: "Prodigitality Workspace",
	slug: "prodigitality",
	my_role: "member",
};
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: WS,
		// A second workspace the person is in (not current, not outside).
		workspaces: [WS, { ...WS, id: "w-other", name: "Other", slug: "other" }],
		isLoading: false,
	}),
	useMyWorkspacesQuery: () => ({ data: [WS] }),
}));
// The forms, the month and the entry dialog have their own suites; here they
// only record how the page opens them.
vi.mock("../forms/TaskPickerModal", () => ({
	TaskPickerModal: (props: {
		open: boolean;
		mode?: string;
		initialProjectId?: string | null;
	}) =>
		props.open ? (
			<div
				data-testid={`picker-${props.mode ?? "start"}`}
				data-project={props.initialProjectId ?? ""}
			/>
		) : null,
}));
vi.mock("../forms/ManualEntryModal", () => ({
	ManualEntryModal: (props: {
		open: boolean;
		initial?: { day?: string | null; projectId?: string | null };
	}) =>
		props.open ? (
			<div
				data-testid="manual-entry"
				data-day={props.initial?.day ?? ""}
				data-project={props.initial?.projectId ?? ""}
			/>
		) : null,
}));
vi.mock("../forms/QuickAddBar", () => ({
	QuickAddBar: () => <div data-testid="quick-add" />,
}));
vi.mock("../calendar/TimeMonthView", () => ({
	TimeMonthView: (props: {
		month?: string;
		timeZone: string;
		onMonthChange?: (date: string) => void;
	}) => (
		<div
			data-testid="month-view"
			data-month={props.month}
			data-tz={props.timeZone}
		>
			{/* The real month's ‹ › pass the 1st of the month. */}
			<button type="button" onClick={() => props.onMonthChange?.("2026-09-01")}>
				Go to September
			</button>
			<button type="button" onClick={() => props.onMonthChange?.("2026-10-01")}>
				Go to October
			</button>
		</div>
	),
}));
vi.mock("../entries/TimeEntryDetailModal", () => ({
	TimeEntryDetailModal: (props: {
		entryId: string | null;
		focus?: string | null;
		onClose: () => void;
	}) =>
		props.entryId ? (
			<div
				role="dialog"
				aria-label="Time entry"
				data-testid="entry-detail"
				data-entry={props.entryId}
				data-focus={props.focus ?? ""}
			>
				<button type="button" onClick={props.onClose}>
					Close entry
				</button>
			</div>
		) : null,
}));

import { TimePage } from "./TimePage";

const MANILA = "Asia/Manila";
// Tue Oct 6, 2026, 11:00 in Manila; the view week is Mon Oct 5 – Sun Oct 11.
const NOW = new Date("2026-10-06T03:00:00.000Z");
const TEAM = "11111111-1111-4111-8111-111111111111";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: TEAM,
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 3.5 * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: TEAM,
		workspace_id: "w1",
		engagement_assignment_id: null,
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:00.000Z",
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

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s1",
		member_user_id: "u1",
		member_display_name_snapshot: null,
		scope_kind: "team",
		scope_ref: TEAM,
		team_id: TEAM,
		workspace_id: "w1",
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-10-05",
		period_end: "2026-10-11",
		timezone: MANILA,
		week_start: 1,
		status: "open",
		approver_scope: "team",
		revision: 1,
		submitted_at: null,
		submitted_by: null,
		submission_kind: null,
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: null,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-10-05T00:00:00.000Z",
		updated_at: "2026-10-05T00:00:00.000Z",
		entry_count: 2,
		running_count: 0,
		logged_seconds: 4.5 * 3600,
		...over,
	};
}

function overview(over: Partial<TimeOverview> = {}): TimeOverview {
	return {
		can_log: true,
		approver_mode: false,
		contexts: [
			{
				kind: "team",
				id: TEAM,
				label: "Prodigitality Services Inc. Team",
				sheet_scope: { kind: "team", ref: TEAM },
				current_sheet: null,
			},
		],
		approvals_waiting: 0,
		workspace_time_admin: [],
		...over,
	};
}

const MONDAY = entry();
const WEDNESDAY = entry({
	id: "e2",
	started_at: "2026-10-07T01:00:00.000Z",
	ended_at: "2026-10-07T02:00:00.000Z",
	duration_seconds: 3600,
	task: { id: "task-2", title: "Write docs", work_type: null, status: null },
	task_id: "task-2",
});

interface Setup {
	overview?: TimeOverview;
	entries?: TimeEntryView[];
	sheets?: TimesheetSummary[];
	search?: TimePageSearch;
	hash?: string;
}

let client: QueryClient;

function setup(options: Setup = {}) {
	const spies = {
		overview: vi
			.spyOn(timeService, "getOverview")
			.mockResolvedValue(options.overview ?? overview()),
		entries: vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
			items: options.entries ?? [MONDAY, WEDNESDAY],
			total: (options.entries ?? [MONDAY, WEDNESDAY]).length,
			page: 1,
			limit: 200,
		}),
		sheets: vi
			.spyOn(timeService, "listMyTimesheets")
			.mockImplementation(async (q) =>
				q?.from && q?.to ? (options.sheets ?? [sheet()]) : [],
			),
		approvals: vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			limit: 50,
		}),
	};
	const onSearchChange = vi.fn();
	const onOpenTask = vi.fn();
	const view = render(
		<QueryClientProvider client={client}>
			<TimePage
				search={options.search ?? {}}
				onSearchChange={onSearchChange}
				hash={options.hash}
				onOpenTask={onOpenTask}
				now={NOW}
			/>
		</QueryClientProvider>,
	);
	return { ...view, spies, onSearchChange, onOpenTask };
}

function stubViewport(width: number) {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: (query: string) => {
			const max = /max-width:\s*(\d+)px/.exec(query);
			return {
				matches: max ? width <= Number(max[1]) : false,
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			};
		},
	});
}

/** Lets in-flight reads land (real timers; only Date is faked). */
const settle = () =>
	act(() => new Promise((resolve) => setTimeout(resolve, 300)));

const rows = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("[data-entry-id]")).map((el) =>
		el.getAttribute("data-entry-id"),
	);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	stubViewport(1440);
	try {
		window.localStorage.clear();
	} catch {
		// Storage unavailable.
	}
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	useAuthStore.setState({ user: { id: "u1" } as never });
	vi.spyOn(timeService, "getPreferences").mockResolvedValue({
		user_id: "u1",
		timezone: MANILA,
		week_start: 1,
		updated_at: "2026-01-01T00:00:00.000Z",
	});
	vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
	// One project in the open workspace: something to log on.
	vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
		projects: [
			{
				id: "proj-here",
				title: "Here project",
				workspace_id: "w1",
				options: 1,
				default_kind: "team",
			},
		],
	});
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("TimePage › normal mode", () => {
	it("a stale running row never stops the timer that runs now; the lists refresh", async () => {
		// A ran here, then another device stopped it and started B: the poll
		// sees B, the cached list still shows A running.
		const rowA = entry({
			id: "e-a",
			started_at: "2026-10-06T01:00:00.000Z",
			ended_at: null,
			duration_seconds: null,
		});
		const timerB = entry({
			id: "e-b",
			started_at: "2026-10-06T02:30:00.000Z",
			ended_at: null,
			duration_seconds: null,
			task: {
				id: "task-2",
				title: "Landing page copy",
				work_type: null,
				status: null,
			},
			task_id: "task-2",
		});
		vi.spyOn(timeService, "getRunning").mockResolvedValue(timerB);
		const stop = vi.spyOn(timeService, "stopEntry");
		const { container, spies } = setup({ entries: [rowA, MONDAY] });
		await waitFor(() => expect(rows(container)).toContain("e-a"));
		const row = container.querySelector('[data-entry-id="e-a"]') as HTMLElement;
		const before = spies.entries.mock.calls.length;
		fireEvent.click(
			within(row).getByText("Stop").closest("button") as HTMLElement,
		);
		await waitFor(() =>
			expect(spies.entries.mock.calls.length).toBeGreaterThan(before),
		);
		expect(stop).not.toHaveBeenCalled();
	});

	it("a local stop refreshes the lists once, not again for the timer change", async () => {
		const runningEntry = entry({
			id: "e-x",
			started_at: "2026-10-06T02:00:00.000Z",
			ended_at: null,
			duration_seconds: null,
		});
		const running = vi
			.spyOn(timeService, "getRunning")
			.mockResolvedValue(runningEntry);
		const stop = vi
			.spyOn(timeService, "stopEntry")
			// The server takes a moment, as it does: the optimistic stop lands
			// on screen while the request is still out.
			.mockImplementation(
				() =>
					new Promise((resolve) =>
						setTimeout(
							() => resolve({ ...runningEntry, ended_at: NOW.toISOString() }),
							100,
						),
					),
			);
		const { container, spies } = setup({ entries: [runningEntry, MONDAY] });
		const bar = await screen.findByRole("region", { name: "Timer running" });
		await waitFor(() => expect(rows(container)).toContain("e-x"));
		await settle();
		// One refetch per list on screen (the week, and Quick add's default start).
		const lists = client
			.getQueryCache()
			.findAll({ queryKey: ["time", "me", "entries"] })
			.filter((query) => query.getObserversCount() > 0).length;
		expect(lists).toBeGreaterThan(0);
		const before = spies.entries.mock.calls.length;
		running.mockResolvedValue(null);
		fireEvent.click(within(bar).getByRole("button", { name: /^Stop\b/ }));
		await waitFor(() => expect(stop).toHaveBeenCalledWith("e-x"));
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("Timer stopped."),
		);
		await settle();
		expect(spies.entries.mock.calls.length - before).toBe(lists);
	});

	it("refreshes the week when the running timer changes under the page", async () => {
		const running = vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
		const { container, spies } = setup();
		await waitFor(() => expect(rows(container)).toEqual(["e1", "e2"]));
		await waitFor(() => expect(running).toHaveBeenCalled());
		const before = spies.entries.mock.calls.length;
		// Another device starts a timer; the next poll sees it.
		running.mockResolvedValue(
			entry({ id: "e-x", ended_at: null, duration_seconds: null }),
		);
		await act(() =>
			client.refetchQueries({ queryKey: ["time", "me", "running"] }),
		);
		await waitFor(() =>
			expect(spies.entries.mock.calls.length).toBeGreaterThan(before),
		);
	});

	it("shows the week, its cards and its entries", async () => {
		const { container, spies } = setup();
		expect(
			screen.getByRole("heading", { level: 1, name: "Time" }),
		).toBeTruthy();
		await waitFor(() => expect(rows(container)).toEqual(["e1", "e2"]));

		expect(spies.entries).toHaveBeenCalledWith(
			expect.objectContaining({ from: "2026-10-05", to: "2026-10-11" }),
		);
		expect(screen.getByTestId("time-week-range").textContent).toBe(
			"Oct 5 – 11, 2026",
		);
		const totals = screen
			.getAllByTestId("day-total")
			.map((el) => el.textContent);
		expect(totals).toEqual(["3:30", "–", "1:00", "–", "–", "–", "–"]);
		expect(await screen.findByTestId("timesheet-card")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Timesheets in this week" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add time" })).toBeTruthy();
		// The quick-add bar is gone from the page: Start timer and Add time cover it.
		expect(screen.queryByTestId("quick-add")).toBeNull();
		// Nothing waits: no pill and no section.
		expect(screen.queryByTestId("waiting-pill")).toBeNull();
		expect(document.getElementById("waiting")).toBeNull();
		expect(spies.approvals).not.toHaveBeenCalled();
	});

	it("steps weeks into ?week= and back to this week", async () => {
		const { onSearchChange } = setup();
		await screen.findByTestId("time-week-range");
		expect(
			(screen.getByRole("button", { name: "This week" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ week: "2026-09-28" },
			{ replace: true },
		);
		fireEvent.keyDown(window, { key: "j" });
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ week: "2026-10-12" },
			{ replace: true },
		);
	});

	it("reads a linked week and jumps back with This week", async () => {
		const { onSearchChange, spies } = setup({
			search: { week: "2026-09-30" },
		});
		await waitFor(() =>
			expect(spies.entries).toHaveBeenCalledWith(
				expect.objectContaining({ from: "2026-09-28", to: "2026-10-04" }),
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "This week" }));
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ week: undefined },
			{ replace: true },
		);
	});

	it("filters the list to a day picked in the strip", async () => {
		const { container } = setup();
		await waitFor(() => expect(rows(container)).toHaveLength(2));
		fireEvent.click(
			within(screen.getByTestId("day-strip")).getByRole("button", {
				name: /^Wed Oct 7/,
			}),
		);
		expect(rows(container)).toEqual(["e2"]);
		expect(screen.getByTestId("day-filter").textContent).toContain("Wed Oct 7");
		fireEvent.click(
			screen.getByRole("button", { name: "Show the whole week" }),
		);
		expect(rows(container)).toHaveLength(2);
	});

	it("writes the For filter to ?for=", async () => {
		const { onSearchChange } = setup();
		const select = (await screen.findByLabelText("For:")) as HTMLSelectElement;
		fireEvent.change(select, { target: { value: `team:${TEAM}` } });
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ for: `team:${TEAM}` },
			{ replace: true },
		);
	});

	it("opens an entry through ?entry= and closes it", async () => {
		const { container, onSearchChange, rerender } = setup();
		await waitFor(() => expect(rows(container)).toHaveLength(2));
		fireEvent.click(screen.getByText("Fix login bug"));
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ entry: "e1" },
			{ replace: true },
		);
		rerender(
			<QueryClientProvider client={client}>
				<TimePage
					search={{ entry: "e1" }}
					onSearchChange={onSearchChange}
					now={NOW}
				/>
			</QueryClientProvider>,
		);
		const detail = screen.getByTestId("entry-detail");
		expect(detail.getAttribute("data-entry")).toBe("e1");
		fireEvent.click(
			within(detail).getByRole("button", { name: "Close entry" }),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ entry: undefined },
			{ replace: true },
		);
	});

	it("opens the start picker and Add time with the page's project", async () => {
		setup({ search: { project: "22222222-2222-4222-8222-222222222222" } });
		fireEvent.click(await screen.findByRole("button", { name: "Start timer" }));
		expect(
			screen.getByTestId("picker-start").getAttribute("data-project"),
		).toBe("22222222-2222-4222-8222-222222222222");
		fireEvent.click(screen.getByRole("button", { name: "Add time" }));
		expect(
			screen.getByTestId("manual-entry").getAttribute("data-project"),
		).toBe("22222222-2222-4222-8222-222222222222");
		expect(screen.getByTestId("project-filter")).toBeTruthy();
	});

	it("offers the FAB's Add time on the day picked", async () => {
		const { container } = setup();
		await waitFor(() => expect(rows(container)).toHaveLength(2));
		fireEvent.click(
			within(screen.getByTestId("day-strip")).getByRole("button", {
				name: /^Wed Oct 7/,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Track time" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Add time" }));
		expect(screen.getByTestId("manual-entry").getAttribute("data-day")).toBe(
			"2026-10-07",
		);
	});

	it("#waiting opens Approvals with this workspace's waiting sheets", async () => {
		const scroll = vi.fn();
		Element.prototype.scrollIntoView = scroll;
		const { spies } = setup({
			overview: overview({ approvals_waiting: 2 }),
			hash: "waiting",
		});
		// Two sheets waiting in this workspace.
		spies.approvals.mockResolvedValue({
			items: [
				{
					...sheet({
						id: "w1",
						status: "submitted",
						policy_workspace_id: "w1",
					}),
					member: null,
					policy_workspace: { id: "ws-b", name: "Beta Workspace" },
				},
				{
					...sheet({
						id: "w2",
						status: "submitted",
						policy_workspace_id: "w1",
					}),
					member: null,
					policy_workspace: { id: "ws-a", name: "Alpha Workspace" },
				},
			],
			total: 2,
			page: 1,
			limit: 50,
		} as never);
		const tab = await screen.findByRole("tab", { name: "Approvals (2)" });
		await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
		expect(await screen.findAllByTestId("waiting-row")).toHaveLength(2);
		expect(screen.queryByTestId("day-strip")).toBeNull();
		expect(document.querySelectorAll("#waiting")).toHaveLength(1);
		await waitFor(() =>
			expect(document.getElementById("waiting")).toBeTruthy(),
		);
		await waitFor(() => expect(scroll).toHaveBeenCalled());
		expect(spies.approvals).toHaveBeenCalledWith(
			expect.objectContaining({ status: "submitted" }),
		);
	});

	it("Fix shows that sheet's entries until Show all entries", async () => {
		const returned = sheet({
			status: "returned",
			decision_note: "Split Thursday",
		});
		const fixed = entry({
			id: "fx",
			task: { id: "t9", title: "Returned work", work_type: null, status: null },
		});
		const getSheet = vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			sheet: returned,
			entries: [fixed],
			events: [],
			rules: null,
			routing: null,
			viewer: { is_member: true, can_decide: false, actions: ["submit"] },
		} as TimesheetDetail);
		const { container } = setup({ sheets: [returned] });
		fireEvent.click(await screen.findByRole("button", { name: "Fix" }));
		await waitFor(() => expect(rows(container)).toEqual(["fx"]));
		expect(getSheet).toHaveBeenCalledWith("s1");
		expect(screen.getByTestId("fix-filter").textContent).toContain(
			"Prodigitality Services Inc. Team",
		);
		fireEvent.click(screen.getByRole("button", { name: "Show all entries" }));
		await waitFor(() => expect(rows(container)).toHaveLength(2));
	});

	it("ends the Fix filter once the sheet is resubmitted", async () => {
		const returned = sheet({
			status: "returned",
			decision_note: "Split Thursday",
		});
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			sheet: returned,
			entries: [entry({ id: "fx" })],
			events: [],
			rules: null,
			routing: null,
			viewer: { is_member: true, can_decide: false, actions: ["submit"] },
		} as TimesheetDetail);
		vi.spyOn(timeService, "getProjectPolicy").mockRejectedValue(
			new TimeApiError({ status: 403, code: "HTTP_403", message: "x" }),
		);
		const submit = vi
			.spyOn(timeService, "submitTimesheet")
			.mockResolvedValue({ ...returned, status: "submitted", revision: 2 });
		const { container } = setup({ sheets: [returned] });
		fireEvent.click(await screen.findByRole("button", { name: "Fix" }));
		await waitFor(() => expect(rows(container)).toEqual(["fx"]));
		expect(screen.getByTestId("fix-filter")).toBeTruthy();

		fireEvent.click(
			within(screen.getByTestId("timesheet-card")).getByRole("button", {
				name: "Resubmit",
			}),
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Resubmit timesheet",
		});
		const confirm = within(dialog).getByRole("button", { name: "Resubmit" });
		await waitFor(() =>
			expect((confirm as HTMLButtonElement).disabled).toBe(false),
		);
		fireEvent.click(confirm);
		await waitFor(() => expect(submit).toHaveBeenCalled());
		await waitFor(() => expect(screen.queryByTestId("fix-filter")).toBeNull());
	});

	it("ends the Fix filter when the sheet leaves Returned elsewhere", async () => {
		const returned = sheet({
			status: "returned",
			decision_note: "Split Thursday",
		});
		const getSheet = vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			sheet: returned,
			entries: [entry({ id: "fx" })],
			events: [],
			rules: null,
			routing: null,
			viewer: { is_member: true, can_decide: false, actions: ["submit"] },
		} as TimesheetDetail);
		const { container } = setup({ sheets: [returned] });
		fireEvent.click(await screen.findByRole("button", { name: "Fix" }));
		await waitFor(() => expect(rows(container)).toEqual(["fx"]));
		getSheet.mockResolvedValue({
			sheet: {
				...returned,
				status: "submitted",
				updated_at: "2026-10-06T02:00:00.000Z",
			},
			entries: [entry({ id: "fx" })],
			events: [],
			rules: null,
			routing: null,
			viewer: { is_member: true, can_decide: false, actions: [] },
		} as TimesheetDetail);
		await client.invalidateQueries();
		await waitFor(() => expect(screen.queryByTestId("fix-filter")).toBeNull());
	});

	it("opens the Submit sheet from a card", async () => {
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			sheet: sheet({ period_start: "2026-09-28", period_end: "2026-10-04" }),
			entries: [],
			events: [],
			rules: null,
			routing: null,
			viewer: { is_member: true, can_decide: false, actions: ["submit"] },
		} as TimesheetDetail);
		setup({
			sheets: [sheet({ period_start: "2026-09-28", period_end: "2026-10-04" })],
			search: { week: "2026-10-01" },
		});
		fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
		expect(
			await screen.findByRole("dialog", { name: "Submit timesheet" }),
		).toBeTruthy();
	});

	it("switches to the month", async () => {
		setup();
		await screen.findByTestId("day-strip");
		fireEvent.click(screen.getByRole("button", { name: "Month" }));
		const month = screen.getByTestId("month-view");
		expect(month.getAttribute("data-month")).toBe("2026-10-06");
		expect(month.getAttribute("data-tz")).toBe(MANILA);
		expect(screen.queryByTestId("day-strip")).toBeNull();
	});

	it("keeps the URL clean when the month comes back to this month", async () => {
		const { onSearchChange } = setup();
		await screen.findByTestId("day-strip");
		fireEvent.click(screen.getByRole("button", { name: "Month" }));
		fireEvent.click(screen.getByRole("button", { name: "Go to September" }));
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ week: "2026-09-01", view: "month" },
			{ replace: true },
		);
		fireEvent.click(screen.getByRole("button", { name: "Go to October" }));
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ week: undefined, view: "month" },
			{ replace: true },
		);
	});

	it("D86: picking a view writes it, Month into the URL and List out of it", async () => {
		const { onSearchChange } = setup();
		await screen.findByTestId("day-strip");
		fireEvent.click(screen.getByRole("button", { name: "Month" }));
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ view: "month" },
			{ replace: true },
		);
		expect(window.localStorage.getItem("timeView:me")).toBe("month");
		fireEvent.click(screen.getByRole("button", { name: "List" }));
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ view: undefined },
			{ replace: true },
		);
		expect(window.localStorage.getItem("timeView:me")).toBe("list");
		expect(screen.getByTestId("day-strip")).toBeTruthy();
	});

	it("D86: a Month URL reloads as Month on its month, whatever is remembered", async () => {
		window.localStorage.setItem("timeView:me", "list");
		setup({ search: { week: "2026-09-01", view: "month" } });
		const month = await screen.findByTestId("month-view");
		expect(month.getAttribute("data-month")).toBe("2026-09-01");
		expect(screen.queryByTestId("day-strip")).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Month" })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("D86: ?view=list opens List even when Month is remembered", async () => {
		window.localStorage.setItem("timeView:me", "month");
		setup({ search: { view: "list" } });
		expect(await screen.findByTestId("day-strip")).toBeTruthy();
		expect(screen.queryByTestId("month-view")).toBeNull();
	});

	it("D86: a linked week stays in List when it steps back to this week", async () => {
		window.localStorage.setItem("timeView:me", "month");
		const { rerender, onSearchChange } = setup({
			search: { week: "2026-09-30" },
		});
		expect(await screen.findByTestId("day-strip")).toBeTruthy();
		// "This week" drops ?week=; the visit started on a link, so List stays.
		rerender(
			<QueryClientProvider client={client}>
				<TimePage search={{}} onSearchChange={onSearchChange} now={NOW} />
			</QueryClientProvider>,
		);
		expect(await screen.findByTestId("day-strip")).toBeTruthy();
		expect(screen.queryByTestId("month-view")).toBeNull();
	});

	it("opens a linked week in the list even when Month is remembered", async () => {
		window.localStorage.setItem("timeView:me", "month");
		const last = sheet({
			period_start: "2026-09-28",
			period_end: "2026-10-04",
		});
		setup({ search: { week: "2026-09-30" }, sheets: [last] });
		// The dashboard's "Submit last week" lands on its card and Submit.
		expect(await screen.findByTestId("day-strip")).toBeTruthy();
		expect(screen.queryByTestId("month-view")).toBeNull();
		expect(await screen.findByTestId("timesheet-card")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
		// The stored choice stays until the person picks a view.
		expect(window.localStorage.getItem("timeView:me")).toBe("month");
		fireEvent.click(screen.getByRole("button", { name: "Month" }));
		expect(screen.getByTestId("month-view")).toBeTruthy();
	});

	it("opens the remembered Month without a linked week", async () => {
		window.localStorage.setItem("timeView:me", "month");
		setup();
		expect(await screen.findByTestId("month-view")).toBeTruthy();
		expect(screen.queryByTestId("day-strip")).toBeNull();
	});

	it("never shows last week's rows under a new week while it loads", async () => {
		const { container, rerender, onSearchChange } = setup();
		await waitFor(() => expect(rows(container)).toEqual(["e1", "e2"]));
		vi.spyOn(timeService, "listMyEntries").mockReturnValue(
			new Promise(() => {}),
		);
		vi.spyOn(timeService, "listMyTimesheets").mockReturnValue(
			new Promise(() => {}),
		);
		rerender(
			<QueryClientProvider client={client}>
				<TimePage
					search={{ week: "2026-09-28" }}
					onSearchChange={onSearchChange}
					now={NOW}
				/>
			</QueryClientProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("time-week-range").textContent).toBe(
				"Sep 28 – Oct 4, 2026",
			),
		);
		expect(rows(container)).toEqual([]);
		expect(screen.queryByTestId("timesheet-card")).toBeNull();
	});

	it("names periods against the person's saved timezone, not the device's", async () => {
		const NY = "America/New_York";
		vi.spyOn(timeService, "getPreferences").mockResolvedValue({
			user_id: "u1",
			timezone: NY,
			week_start: 1,
			updated_at: "2026-01-01T00:00:00.000Z",
		});
		setup({ sheets: [sheet({ timezone: NY })] });
		const card = await screen.findByTestId("timesheet-card");
		expect(card.textContent).not.toContain(`(${NY})`);
	});

	it("has no timer buttons for someone who can't log yet (P6)", async () => {
		setup({
			overview: overview({ can_log: false, contexts: [] }),
			entries: [],
			sheets: [],
		});
		// Nothing in this workspace: the calm "not set up" state, no timer.
		expect(await screen.findByTestId("time-not-set-up")).toBeTruthy();
		expect(
			screen.getByText("Time isn't set up for you in Prodigitality Workspace."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Start timer" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Track time" })).toBeNull();
		expect(screen.queryByTestId("quick-add")).toBeNull();
	});

	it("says Just me with Why? when that is all the person can log (P1b)", async () => {
		vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
			projects: [
				{
					id: "p1",
					title: "Side",
					workspace_id: "w1",
					options: 1,
					default_kind: "personal",
				},
			],
		});
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue({
			options: [
				{
					kind: "personal",
					id: null,
					label: "Just me",
					sheet_scope: null,
					rate_source: "none",
					workspace_tag: null,
					approver_hint: null,
				},
			],
			selected: null,
			prefill: null,
			personal_reason: "plan",
			unavailable: [],
		});
		setup({
			overview: overview({ contexts: [] }),
			entries: [],
			sheets: [],
		});
		expect(await screen.findByTestId("for-filter-personal")).toBeTruthy();
		expect(screen.getByText("No time logged this week")).toBeTruthy();
	});

	it("explains a failed overview read", async () => {
		// A 4xx: the overview query never retries those (a 5xx retries twice).
		vi.spyOn(timeService, "getOverview").mockRejectedValue(
			new TimeApiError({ status: 400, code: "HTTP_400", message: "x" }),
		);
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			limit: 200,
		});
		vi.spyOn(timeService, "listMyTimesheets").mockResolvedValue([]);
		render(
			<QueryClientProvider client={client}>
				<TimePage search={{}} onSearchChange={vi.fn()} now={NOW} />
			</QueryClientProvider>,
		);
		const alert = await screen.findByRole("alert");
		expect(
			within(alert).getByRole("button", { name: "Try again" }),
		).toBeTruthy();
	});
});

describe("TimePage › one layout", () => {
	it("gives owners and admins a Time policy button with the summary and Edit", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue({
			workspace_id: "w1",
			policy_unconfirmed: false,
			can_edit: true,
			policy: {
				tracking_enabled: true,
				period_kind: "weekly",
				week_start: 1,
				timezone: "Asia/Manila",
				approval_required: true,
				plan: { time_tracking: true, time_team_rules: true },
			},
		} as never);
		setup({
			overview: overview({
				workspace_time_admin: [
					{
						workspace_id: "w1",
						name: "Prodigitality Workspace",
						slug: "prodigitality",
						has_time_tracking: true,
						policy_unconfirmed: false,
					},
				],
			}),
		});
		fireEvent.click(await screen.findByTestId("time-policy-button"));
		const popover = await screen.findByTestId("time-policy-popover");
		await waitFor(() =>
			expect(popover.textContent).toContain(
				"Weekly · starts Monday · Asia/Manila · Approval required",
			),
		);
		expect(screen.getByRole("link", { name: "Edit time policy" })).toBeTruthy();
		// No policy cards on the page.
		expect(screen.queryByTestId("policy-summary-card")).toBeNull();
		expect(screen.queryByTestId("policy-confirm-card")).toBeNull();
	});

	it("gives members no Time policy button", async () => {
		setup();
		await screen.findByTestId("day-strip");
		expect(screen.queryByTestId("time-policy-button")).toBeNull();
	});

	it("shows one banner when the policy still needs confirming", async () => {
		setup({
			overview: overview({
				workspace_time_admin: [
					{
						workspace_id: "w1",
						name: "Prodigitality Workspace",
						slug: "prodigitality",
						has_time_tracking: true,
						policy_unconfirmed: true,
					},
				],
			}),
		});
		await screen.findByTestId("time-tabs");
		expect(
			(await screen.findAllByTestId(/policy-confirm-(card|loading)/)).length,
		).toBe(1);
	});

	it("opens Approvals by default for an approver with no time here", async () => {
		setup({
			overview: overview({
				approvals_waiting: 0,
				contexts: [],
				can_log: false,
				workspace_time_admin: [
					{
						workspace_id: "w1",
						name: "Prodigitality Workspace",
						slug: "prodigitality",
						has_time_tracking: true,
						policy_unconfirmed: false,
					},
				],
			}),
			entries: [],
		});
		const tab = await screen.findByRole("tab", { name: "Approvals" });
		await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
		expect(await screen.findByText("You're all caught up.")).toBeTruthy();
	});

	it("hides the Approvals tab, even from ?tab=approvals, without approvals here", async () => {
		setup({ search: { tab: "approvals" } });
		await screen.findByTestId("day-strip");
		expect(screen.queryByTestId("time-tabs")).toBeNull();
	});

	it("an empty week offers Start timer and Add time", async () => {
		setup({ entries: [], sheets: [] });
		const empty = await screen.findByText("No time logged this week");
		const card = empty.closest("[data-empty]") as HTMLElement;
		expect(card.textContent).toContain(
			"Start a timer when you begin work, or add time you already spent.",
		);
		fireEvent.click(within(card).getByRole("button", { name: "Start timer" }));
		expect(screen.getByTestId("picker-start")).toBeTruthy();
		fireEvent.click(within(card).getByRole("button", { name: "Add time" }));
		expect(screen.getByTestId("manual-entry")).toBeTruthy();
	});

	it("with no project here: no quick add, disabled buttons, a clear empty state", async () => {
		vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
			projects: [
				{
					id: "elsewhere",
					title: "[DEV] Client Portal",
					workspace_id: "w-other",
					options: 1,
					default_kind: "team",
				},
			],
		});
		setup({ entries: [], sheets: [] });
		expect(
			await screen.findByText(
				"Nothing to log time on in Prodigitality Workspace yet.",
			),
		).toBeTruthy();
		expect(
			screen.getByText("Time is logged on this workspace's projects."),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Create a project" })).toBeTruthy();
		expect(screen.queryByTestId("quick-add")).toBeNull();
		const start = screen.getByRole("button", { name: "Start timer" });
		expect((start as HTMLButtonElement).disabled).toBe(true);
		expect(start.getAttribute("title")).toBe(
			"Nothing to log time on in Prodigitality Workspace yet.",
		);
	});

	it("shows the week, not a separate approver page, when approver_mode is set", async () => {
		setup({
			overview: overview({
				approver_mode: true,
				approvals_waiting: 0,
				contexts: [],
			}),
			entries: [],
			sheets: [],
		});
		expect(await screen.findByTestId("day-strip")).toBeTruthy();
		expect(screen.getByTestId("time-toolbar")).toBeTruthy();
		expect(screen.queryByTestId("approver-mode")).toBeNull();
		expect(screen.queryByText(/You're all caught up/)).toBeNull();
		expect(await screen.findByText("No time logged this week")).toBeTruthy();
	});
});
