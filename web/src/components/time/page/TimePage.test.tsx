/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
		workspaces: [WS],
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
	vi.spyOn(timeService, "listMyProjects").mockResolvedValue({ projects: [] });
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
	it("shows the week, its cards and its entries", async () => {
		const { container, spies } = setup();
		expect(
			screen.getByRole("heading", { level: 1, name: "Time" }),
		).toBeTruthy();
		await waitFor(() => expect(rows(container)).toEqual(["e2", "e1"]));

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
		expect(screen.getByTestId("quick-add")).toBeTruthy();
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

	it("shows Waiting for you with the pill, and scrolls to #waiting", async () => {
		const scroll = vi.fn();
		Element.prototype.scrollIntoView = scroll;
		const { spies } = setup({
			overview: overview({ approvals_waiting: 2 }),
			hash: "waiting",
		});
		expect(
			await screen.findByRole("link", { name: "Waiting for you · 2" }),
		).toBeTruthy();
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
		await waitFor(() => expect(rows(container)).toEqual(["e2", "e1"]));
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
		expect(
			await screen.findByText(
				"When you're placed on a project, you'll be able to log time for it here.",
			),
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
		expect(
			screen.getByText(
				"Track time on your tasks. Start a timer from any task, or add time you've already worked.",
			),
		).toBeTruthy();
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

describe("TimePage › approver mode", () => {
	it("collapses to one Start timer pill with Waiting and Decided, and no week", async () => {
		const { spies } = setup({
			overview: overview({
				approver_mode: true,
				approvals_waiting: 0,
				contexts: [],
			}),
		});
		expect(await screen.findByTestId("approver-mode")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Start timer" })).toHaveLength(
			1,
		);
		expect(screen.queryByTestId("day-strip")).toBeNull();
		expect(screen.queryByTestId("time-toolbar")).toBeNull();
		expect(screen.queryByRole("button", { name: "Track time" })).toBeNull();
		expect(
			await screen.findByText(
				"You're all caught up. Timesheets sent to you will show up here.",
			),
		).toBeTruthy();
		await waitFor(() =>
			expect(spies.approvals).toHaveBeenCalledWith(
				expect.objectContaining({ status: "decided" }),
			),
		);

		fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
		expect(screen.getByTestId("picker-start")).toBeTruthy();
	});
});
