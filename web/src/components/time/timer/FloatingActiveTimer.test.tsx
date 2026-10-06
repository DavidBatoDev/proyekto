/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeKeys } from "@/queries/time";
import { timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

const mocks = vi.hoisted(() => ({
	pathname: "/dashboard",
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock("@/hooks/useToast", () => ({ useToast: () => mocks.toast }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useRouterState: ({
			select,
		}: {
			select: (state: { location: { pathname: string } }) => unknown;
		}) => select({ location: { pathname: mocks.pathname } }),
		Link: ({
			children,
			to,
			params,
			search,
			className,
			onClick,
			title,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			search?: Record<string, string>;
			className?: string;
			onClick?: () => void;
			title?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			if (search) href += `?${new URLSearchParams(search).toString()}`;
			return createElement("a", { href, className, onClick, title }, children);
		},
	};
});

import {
	FloatingActiveTimer,
	shouldShowOnPath,
	TIMER_ANCHOR_STORAGE_KEY,
	TIMER_COLLAPSED_STORAGE_KEY,
	TIMER_VISIBLE_PATH_PREFIXES,
} from "./FloatingActiveTimer";

const USER = "user-1";
const TEAM = "11111111-1111-4111-8111-111111111111";

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

let client: QueryClient;

function renderTimer(running: TimeEntryView | null) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(timeKeys.running(USER), running);
	return render(
		<QueryClientProvider client={client}>
			<FloatingActiveTimer />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.pathname = "/dashboard";
	useAuthStore.setState({ user: { id: USER } as never });
	try {
		window.localStorage.clear();
	} catch {
		// jsdom always has storage; nothing to clear otherwise.
	}
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("shouldShowOnPath", () => {
	it.each([
		"/dashboard",
		"/w/acme/dashboard",
		"/inbox",
		"/command-center",
		"/meetings",
		"/task-board",
		"/notifications",
		"/teams",
		"/teams/t1/time/my-logs",
		"/w/acme/teams/t1/time/team-logs",
		"/project/p1/roadmap",
		"/project/p1/timeline/r1",
		"/project/p1/work-items",
		"/projects",
	])("shows on %s", (path) => {
		expect(shouldShowOnPath(path)).toBe(true);
	});

	it.each([
		"/time",
		"/time/",
		"/time/timesheets/s1",
		"/w/acme/time",
		"/work-items",
		"/settings/profile",
		"/w/acme/settings/time",
		"/",
		"",
		"/dashboards",
		"/meetings-archive",
		"/notificationsx",
		"/timeline",
	])("hides on %s", (path) => {
		expect(shouldShowOnPath(path)).toBe(false);
	});

	it("never lists /time (its own bar) or /work-items (a redirect)", () => {
		expect(TIMER_VISIBLE_PATH_PREFIXES).not.toContain("/time");
		expect(TIMER_VISIBLE_PATH_PREFIXES).not.toContain("/work-items");
		for (const path of ["/meetings", "/task-board", "/notifications"]) {
			expect(TIMER_VISIBLE_PATH_PREFIXES).toContain(path);
		}
	});
});

describe("FloatingActiveTimer", () => {
	beforeEach(() => {
		// The server echoes the last write: the poll after a write keeps it.
		vi.spyOn(timeService, "getRunning").mockImplementation(
			async () =>
				client?.getQueryData<TimeEntryView | null>(timeKeys.running(USER)) ??
				null,
		);
	});

	it("shows the running timer with Open in Time → /time?entry=<id>", async () => {
		renderTimer(entry());
		const card = await screen.findByRole("region", { name: "Timer running" });
		expect(card.textContent).toContain("Fix login bug");
		expect(card.textContent).toContain("Acme Website");
		expect(card.textContent).toContain("Prodigitality Services…");
		expect(screen.getByTestId("timer-clock").textContent).toMatch(
			/^01:1\d:\d\d$/,
		);

		const open = screen.getByRole("link", { name: "Open in Time" });
		expect(open.getAttribute("href")).toBe("/time?entry=running-1");
		const roadmap = screen.getByRole("link", { name: "Roadmap" });
		expect(roadmap.getAttribute("href")).toBe(
			"/project/p0/roadmap?nodeId=task-0&view=roadmapView",
		);
		// The old team-only "My Logs" link is gone.
		expect(screen.queryByText("My Logs")).toBeNull();
		expect(document.querySelector('a[href*="/my-logs"]')).toBeNull();
	});

	it("is not shown on /time, which has its own bar", () => {
		mocks.pathname = "/time";
		const { container } = renderTimer(entry());
		expect(container.innerHTML).toBe("");
	});

	it("is shown on the new pages (meetings, task board, notifications)", async () => {
		for (const path of ["/meetings", "/task-board", "/notifications"]) {
			mocks.pathname = path;
			renderTimer(entry());
			expect(
				await screen.findByRole("link", { name: "Open in Time" }),
			).toBeTruthy();
			cleanup();
		}
	});

	it("renders nothing without a running timer", async () => {
		vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
		const { container } = renderTimer(null);
		await waitFor(() => expect(container.innerHTML).toBe(""));
	});

	it("preset time links to the roadmap without a task", async () => {
		renderTimer(entry({ task_id: null, task: null, work_item: "meeting" }));
		const card = await screen.findByRole("region", { name: "Timer running" });
		expect(card.textContent).toContain("◦ Meeting");
		expect(
			screen.getByRole("link", { name: "Roadmap" }).getAttribute("href"),
		).toBe("/project/p0/roadmap");
	});

	it("hidden content: no project link, the hidden label only", async () => {
		renderTimer(
			entry({
				content: "hidden",
				task: null,
				project: null,
				content_label: "A project you can't open",
			}),
		);
		const card = await screen.findByRole("region", { name: "Timer running" });
		expect(card.textContent).toContain("A project you can't open");
		expect(screen.queryByRole("link", { name: "Roadmap" })).toBeNull();
		expect(screen.getByRole("link", { name: "Open in Time" })).toBeTruthy();
	});

	it("Pause and Stop go through the shared timer", async () => {
		const pause = vi
			.spyOn(timeService, "pauseEntry")
			.mockResolvedValue(entry({ paused_at: new Date().toISOString() }));
		const stop = vi
			.spyOn(timeService, "stopEntry")
			.mockResolvedValue(entry({ ended_at: new Date().toISOString() }));
		renderTimer(entry());

		fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
		await waitFor(() => expect(pause).toHaveBeenCalledWith("running-1"));
		expect(
			await screen.findByRole("region", { name: "On break" }),
		).toBeTruthy();
		// Readable on a tint: a solid success fill would hide the same-hue label.
		const resumeButton = screen.getByRole("button", { name: "Resume" });
		expect(resumeButton.className).toContain("bg-success/15");
		expect(resumeButton.className).not.toMatch(/(^|\s)bg-success(\s|$)/);
		fireEvent.click(screen.getByRole("button", { name: "Stop" }));
		await waitFor(() => expect(stop).toHaveBeenCalledWith("running-1"));
	});

	it("collapsing hides the details and is remembered", async () => {
		renderTimer(entry());
		fireEvent.click(
			await screen.findByRole("button", { name: "Collapse timer" }),
		);
		expect(screen.queryByRole("link", { name: "Open in Time" })).toBeNull();
		expect(screen.queryByText("Fix login bug")).toBeNull();
		expect(screen.queryByRole("group", { name: "Timer position" })).toBeNull();
		expect(window.localStorage.getItem(TIMER_COLLAPSED_STORAGE_KEY)).toBe(
			"true",
		);
		// The clock and the controls stay.
		expect(screen.getByTestId("timer-clock")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();

		cleanup();
		renderTimer(entry());
		expect(
			await screen.findByRole("button", { name: "Expand timer" }),
		).toBeTruthy();
	});

	it("restores the stored corner", async () => {
		window.localStorage.setItem(TIMER_ANCHOR_STORAGE_KEY, "top-left");
		renderTimer(entry());
		const card = await screen.findByRole("region", { name: "Timer running" });
		expect(card.getAttribute("data-anchor")).toBe("top-left");
		fireEvent.click(screen.getByRole("button", { name: "bottom left" }));
		expect(card.getAttribute("data-anchor")).toBe("bottom-left");
		expect(window.localStorage.getItem(TIMER_ANCHOR_STORAGE_KEY)).toBe(
			"bottom-left",
		);
	});

	it("still works when storage throws", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		renderTimer(entry());
		const card = await screen.findByRole("region", { name: "Timer running" });
		expect(card.getAttribute("data-anchor")).toBe("bottom-right");
		fireEvent.click(screen.getByRole("button", { name: "Collapse timer" }));
		expect(screen.getByRole("button", { name: "Expand timer" })).toBeTruthy();
	});
});
