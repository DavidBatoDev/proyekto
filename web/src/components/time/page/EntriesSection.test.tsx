/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeApiError, timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			className,
		}: {
			children?: ReactNode;
			className?: string;
		}) => (
			<a href="#x" className={className}>
				{children}
			</a>
		),
	};
});
const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import {
	changeTaskBody,
	EntriesSection,
	useChangeEntryTask,
} from "./EntriesSection";

const MANILA = "Asia/Manila";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "personal",
		context_ref: null,
		context_label_snapshot: null,
		timesheet_id: null,
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T02:30:00.000Z",
		paused_at: null,
		duration_seconds: 5400,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "manual",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: null,
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-10-05T02:30:00.000Z",
		updated_at: "2026-10-05T02:30:00.000Z",
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

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useAuthStore.setState({ user: { id: "u1" } as never });
	stubViewport(1440);
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("EntriesSection", () => {
	it("lists the entries in the table and opens one on click", () => {
		const onOpenEntry = vi.fn();
		render(
			<EntriesSection
				entries={[entry()]}
				timeZone={MANILA}
				onOpenEntry={onOpenEntry}
			/>,
			{ wrapper },
		);
		expect(screen.getByRole("heading", { name: "Time entries" })).toBeTruthy();
		fireEvent.click(screen.getByText("Fix login bug"));
		expect(onOpenEntry).toHaveBeenCalled();
		expect(onOpenEntry.mock.calls[0][0].id).toBe("e1");
	});

	it("shows the picked day and the way back to the week", () => {
		const onClearDay = vi.fn();
		render(
			<EntriesSection
				entries={[]}
				timeZone={MANILA}
				day={{ date: "2026-10-05", label: "Mon Oct 5" }}
				onClearDay={onClearDay}
				empty={<p>No time entries match this view.</p>}
			/>,
			{ wrapper },
		);
		expect(screen.getByTestId("day-filter").textContent).toContain("Mon Oct 5");
		fireEvent.click(
			screen.getByRole("button", { name: "Show the whole week" }),
		);
		expect(onClearDay).toHaveBeenCalled();
		expect(screen.getByText("No time entries match this view.")).toBeTruthy();
	});

	it("explains Fix and offers every entry back", () => {
		const onClearFix = vi.fn();
		render(
			<EntriesSection
				entries={[]}
				timeZone={MANILA}
				fixing={{ label: "Acme Corp · agreement", period: "Sep 22–28" }}
				onClearFix={onClearFix}
			/>,
			{ wrapper },
		);
		expect(screen.getByRole("status").textContent).toBe(
			"Showing the Acme Corp · agreement timesheet for Sep 22–28. Change what the note asks for, then Resubmit.Show all entries",
		);
		fireEvent.click(screen.getByRole("button", { name: "Show all entries" }));
		expect(onClearFix).toHaveBeenCalled();
	});

	it("turns a failed read into a reason card with Try again", () => {
		const onRetry = vi.fn();
		render(
			<EntriesSection
				entries={[]}
				timeZone={MANILA}
				error={
					new TimeApiError({ status: 0, code: "NETWORK_ERROR", message: "x" })
				}
				onRetry={onRetry}
			/>,
			{ wrapper },
		);
		expect(screen.getByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalled();
	});
});

describe("changeTaskBody", () => {
	it("sends the new task, or clears it for a preset, and nothing when unchanged", () => {
		const onTask = entry();
		expect(
			changeTaskBody(onTask, { taskId: "task-2", workItem: null }),
		).toEqual({
			task_id: "task-2",
		});
		expect(
			changeTaskBody(onTask, { taskId: "task-1", workItem: null }),
		).toBeNull();
		expect(
			changeTaskBody(onTask, { taskId: null, workItem: "meeting" }),
		).toEqual({
			task_id: null,
			work_item: "meeting",
		});
		const meeting = entry({ task_id: null, task: null, work_item: "meeting" });
		expect(
			changeTaskBody(meeting, { taskId: null, workItem: "meeting" }),
		).toBeNull();
		expect(changeTaskBody(meeting, { taskId: null, workItem: null })).toEqual({
			task_id: null,
			work_item: "other",
		});
	});
});

describe("useChangeEntryTask", () => {
	it("PATCHes the task with the row's revision and says so", async () => {
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockResolvedValue({ ...entry({ task_id: "task-2" }), warnings: [] });
		const { result } = renderHook(() => useChangeEntryTask(), { wrapper });
		let ok = false;
		await act(async () => {
			ok = await result.current.change(entry(), {
				taskId: "task-2",
				workItem: null,
			});
		});
		expect(ok).toBe(true);
		expect(update).toHaveBeenCalledWith("e1", {
			task_id: "task-2",
			expected_updated_at: "2026-10-05T02:30:00.000Z",
		});
		expect(toast.success).toHaveBeenCalledWith("Time entry updated.");
	});

	it("re-reads a stale copy and retries once", async () => {
		const stale = new TimeApiError({
			status: 409,
			code: "STALE_REVISION",
			message: "changed",
			extras: { entry_id: "e1" },
		});
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockRejectedValueOnce(stale)
			.mockResolvedValueOnce({ ...entry(), warnings: [] });
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({ updated_at: "2026-10-05T09:00:00.000Z" }),
		);
		const { result } = renderHook(() => useChangeEntryTask(), { wrapper });
		await act(async () => {
			await result.current.change(entry(), {
				taskId: null,
				workItem: "review",
			});
		});
		expect(update).toHaveBeenLastCalledWith("e1", {
			task_id: null,
			work_item: "review",
			expected_updated_at: "2026-10-05T09:00:00.000Z",
		});
		expect(toast.success).toHaveBeenCalled();
	});

	it("gives up when the fresh copy is locked, with the error copy", async () => {
		const stale = new TimeApiError({
			status: 409,
			code: "STALE_REVISION",
			message: "changed",
		});
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockRejectedValue(stale);
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({ locked_reason: "sheet_submitted" }),
		);
		const { result } = renderHook(() => useChangeEntryTask(), { wrapper });
		let ok = true;
		await act(async () => {
			ok = await result.current.change(entry(), {
				taskId: "task-2",
				workItem: null,
			});
		});
		expect(ok).toBe(false);
		expect(update).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("does nothing when the task is the same", async () => {
		const update = vi.spyOn(timeService, "updateEntry");
		const { result } = renderHook(() => useChangeEntryTask(), { wrapper });
		await act(async () => {
			await result.current.change(entry(), {
				taskId: "task-1",
				workItem: null,
			});
		});
		expect(update).not.toHaveBeenCalled();
	});
});
