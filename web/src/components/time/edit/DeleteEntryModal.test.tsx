/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { timeKeys } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	DELETE_ENTRY_COPY,
	DeleteEntryModal,
	deleteEntryQuestion,
	entrySpanLine,
} from "./DeleteEntryModal";

const TZ = "Asia/Manila";
const USER = "u1";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "workspace",
		context_ref: "w1",
		context_label_snapshot: "Acme",
		timesheet_id: null,
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 12_600,
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
		workspace_id: "w1",
		engagement_assignment_id: null,
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: USER,
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

function renderModal(
	props: Partial<Parameters<typeof DeleteEntryModal>[0]> = {},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onClose = vi.fn();
	const onDeleted = vi.fn();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	render(
		<DeleteEntryModal
			open
			entry={entry()}
			timeZone={TZ}
			onClose={onClose}
			onDeleted={onDeleted}
			{...props}
		/>,
		{ wrapper },
	);
	return { client, onClose, onDeleted };
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const fn of Object.values(toast)) fn.mockReset();
	useAuthStore.setState({ user: null });
});

describe("copy helpers", () => {
	it("names the work and the span", () => {
		expect(deleteEntryQuestion(entry())).toBe(
			"Delete this time entry for Fix login bug?",
		);
		expect(
			deleteEntryQuestion(
				entry({ task: null, task_id: null, work_item: "meeting" }),
			),
		).toBe("Delete this time entry for Meeting?");
		expect(entrySpanLine(entry(), TZ)).toMatch(
			/^Mon Oct 5(, 2026)? · 09:00–12:30 · 3:30$/,
		);
		expect(
			entrySpanLine(entry({ ended_at: null, duration_seconds: null }), TZ),
		).toMatch(/· 09:00–now$/);
	});
});

describe("DeleteEntryModal", () => {
	it("deletes, refreshes time and closes", async () => {
		const remove = vi.spyOn(timeService, "deleteEntry").mockResolvedValue();
		const { client, onClose, onDeleted } = renderModal();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		expect(
			screen.getByText("Delete this time entry for Fix login bug?"),
		).toBeTruthy();
		expect(screen.getByText(DELETE_ENTRY_COPY.irreversible)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(remove).toHaveBeenCalledWith("e1");
		expect(onDeleted).toHaveBeenCalledWith("e1");
		expect(toast.success).toHaveBeenCalledWith("Time entry deleted.");
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["time", "me", "entries"],
		});
	});

	it("drops a deleted running timer from the running cache at once", async () => {
		vi.spyOn(timeService, "deleteEntry").mockResolvedValue();
		const running = entry({ ended_at: null, duration_seconds: null });
		const { client, onClose } = renderModal({ entry: running });
		client.setQueryData(timeKeys.running(USER), running);
		expect(
			screen.getByText(
				`${DELETE_ENTRY_COPY.runningNote} ${DELETE_ENTRY_COPY.irreversible}`,
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(client.getQueryData(timeKeys.running(USER))).toBeNull();
	});

	it("treats an entry that is already gone as deleted", async () => {
		vi.spyOn(timeService, "deleteEntry").mockRejectedValue(
			new TimeApiError({
				status: 404,
				code: "TIME_NOT_FOUND",
				message: "This time entry doesn't exist or you can't open it.",
			}),
		);
		const { onClose, onDeleted } = renderModal();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(onDeleted).toHaveBeenCalledWith("e1");
	});

	it("explains a refusal and stays open", async () => {
		vi.spyOn(timeService, "deleteEntry").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_LOCKED",
				message: "This entry is on a submitted or approved timesheet.",
				extras: { reason: "entry", lock: "sheet_submitted", entry_id: "e1" },
			}),
		);
		const { onClose } = renderModal();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(
			"This entry is on a submitted or approved timesheet.",
		);
		expect(onClose).not.toHaveBeenCalled();
		expect(
			(screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	it("offers no Delete on a locked entry", () => {
		const remove = vi.spyOn(timeService, "deleteEntry");
		renderModal({
			entry: entry({ locked_reason: "paid", payout_id: "po1" }),
		});
		expect(
			screen.getByText("This time has been paid, so it can't change."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(remove).not.toHaveBeenCalled();
	});
});
