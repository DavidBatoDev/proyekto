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
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeApiError, timeService } from "@/services/time.service";
import type { TimesheetRow, TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import {
	ApproveSelectedDialog,
	ApproveSheetDialog,
	DecisionDialog,
	ReopenSheetDialog,
	RequestReopenSheetDialog,
	ReturnSheetDialog,
} from "./DecisionDialogs";

const MEMBER = "member-1";
const DECIDER = "decider-1";
const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T03:00:00.000Z");

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s1",
		member_user_id: MEMBER,
		member_display_name_snapshot: "Maria Santos",
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-09-21",
		period_end: "2026-09-27",
		timezone: TZ,
		week_start: 1,
		status: "submitted",
		approver_scope: "team",
		revision: 4,
		submitted_at: "2026-09-28T02:14:00.000Z",
		submitted_by: MEMBER,
		submission_kind: "manual",
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: 137_700,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-09-21T01:00:00.000Z",
		updated_at: "2026-09-28T02:14:00.000Z",
		entry_count: 6,
		running_count: 0,
		logged_seconds: 137_700,
		...over,
	};
}

function asRow(s: TimesheetSummary, over: Partial<TimesheetRow> = {}) {
	const { entry_count, running_count, logged_seconds, ...rest } = s;
	void entry_count;
	void running_count;
	void logged_seconds;
	return { ...rest, ...over } as TimesheetRow;
}

let client: QueryClient;

function renderWith(ui: ReactElement) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

function asViewer(id: string) {
	useAuthStore.setState({ user: { id } as never });
}

beforeEach(() => asViewer(DECIDER));

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("ReturnSheetDialog", () => {
	it("needs a note, names the person and returns", async () => {
		const ret = vi
			.spyOn(timeService, "returnTimesheet")
			.mockResolvedValue(asRow(sheet(), { status: "returned" }));
		const onClose = vi.fn();
		const onDone = vi.fn();
		renderWith(
			<ReturnSheetDialog
				open
				onClose={onClose}
				onDone={onDone}
				sheet={sheet()}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(screen.getByText("Return timesheet")).toBeTruthy();
		expect(
			screen.getByText(
				"Maria Santos · Prodigitality Services Inc. Team · Sep 21–27",
			),
		).toBeTruthy();
		expect(screen.getByText("38:15")).toBeTruthy();
		const note = screen.getByPlaceholderText("What should Maria change?");
		const button = screen.getByRole("button", { name: "Return to Maria" });

		fireEvent.click(button);
		expect(
			await screen.findByText("Add a note so Maria knows what to change."),
		).toBeTruthy();
		expect(ret).not.toHaveBeenCalled();

		fireEvent.change(note, { target: { value: "Split Thursday" } });
		expect(
			screen.queryByText("Add a note so Maria knows what to change."),
		).toBeNull();
		fireEvent.click(button);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(ret).toHaveBeenCalledWith("s1", {
			expected_revision: 4,
			note: "Split Thursday",
		});
		expect(onDone).toHaveBeenCalledWith(
			expect.objectContaining({ status: "returned" }),
		);
		expect(toast.success).toHaveBeenCalledWith("Returned to Maria");
	});

	it("keeps the note within 2,000 characters", () => {
		renderWith(<ReturnSheetDialog open onClose={vi.fn()} sheet={sheet()} />);
		expect(
			screen
				.getByPlaceholderText("What should Maria change?")
				.getAttribute("maxlength"),
		).toBe("2000");
	});
});

describe("ApproveSheetDialog", () => {
	it("approves with an optional note", async () => {
		const approve = vi
			.spyOn(timeService, "approveTimesheet")
			.mockResolvedValue(
				asRow(sheet(), { status: "approved", payable_seconds: 137_700 }),
			);
		const onClose = vi.fn();
		renderWith(<ApproveSheetDialog open onClose={onClose} sheet={sheet()} />);
		expect(screen.queryByRole("checkbox")).toBeNull();
		fireEvent.change(screen.getByLabelText("Note (optional)"), {
			target: { value: "Looks good" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(approve).toHaveBeenCalledWith("s1", {
			expected_revision: 4,
			note: "Looks good",
		});
		expect(toast.success).toHaveBeenCalledWith("Approved · 38:15 frozen");
	});

	it("shows the overtime box when a cap that cuts pay is exceeded", async () => {
		const approve = vi
			.spyOn(timeService, "approveTimesheet")
			.mockResolvedValue(asRow(sheet(), { status: "approved" }));
		renderWith(
			<ApproveSheetDialog
				open
				onClose={vi.fn()}
				sheet={sheet()}
				overtime={{ overSeconds: 12_600, payableSeconds: 144_000 }}
			/>,
		);
		expect(screen.getByText("Approve the 3h 30m over the limit")).toBeTruthy();
		expect(
			screen.getByText(
				"Left unticked, 40:00 is approved for payment; the extra time stays on record.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		await waitFor(() =>
			expect(approve).toHaveBeenCalledWith("s1", {
				expected_revision: 4,
				approve_overtime: true,
			}),
		);
	});

	it("a stale revision shows the banner; Review the latest refetches and closes", async () => {
		vi.spyOn(timeService, "approveTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "STALE_REVISION",
				message: "x",
				extras: { timesheet_id: "s1", expected: 4, actual: 5 },
			}),
		);
		const onClose = vi.fn();
		const onReviewLatest = vi.fn();
		renderWith(
			<ApproveSheetDialog
				open
				onClose={onClose}
				onReviewLatest={onReviewLatest}
				sheet={sheet()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		const banner = await screen.findByTestId("stale-revision-banner");
		expect(banner.textContent).toContain(
			"Maria changed this timesheet while you were looking.",
		);
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.click(
			within(banner).getByRole("button", { name: "Review the latest" }),
		);
		expect(onReviewLatest).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("ReopenSheetDialog", () => {
	const approved = sheet({
		status: "approved",
		decision_kind: "manual",
		decided_by: DECIDER,
	});

	it("a decider's reopen needs a note and goes back as Returned", async () => {
		const reopen = vi
			.spyOn(timeService, "reopenTimesheet")
			.mockResolvedValue(asRow(approved, { status: "returned" }));
		const onClose = vi.fn();
		renderWith(<ReopenSheetDialog open onClose={onClose} sheet={approved} />);
		expect(
			screen.getByText("It goes back to Maria as Returned, with your note."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		expect(
			await screen.findByText("Add a note so Maria knows what to change."),
		).toBeTruthy();
		expect(reopen).not.toHaveBeenCalled();
		fireEvent.change(screen.getByPlaceholderText("What should Maria change?"), {
			target: { value: "Wrong week" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(reopen).toHaveBeenCalledWith("s1", {
			expected_revision: 4,
			note: "Wrong week",
		});
		expect(toast.success).toHaveBeenCalledWith(
			"Reopened. Maria can edit again.",
		);
	});

	it("the member reopens an own auto/self sheet without a note", async () => {
		asViewer(MEMBER);
		const own = sheet({
			status: "approved",
			decision_kind: "self",
			approver_scope: "self",
		});
		const reopen = vi
			.spyOn(timeService, "reopenTimesheet")
			.mockResolvedValue(asRow(own, { status: "open" }));
		const onClose = vi.fn();
		renderWith(<ReopenSheetDialog open onClose={onClose} sheet={own} />);
		expect(
			screen.getByText("It goes back to Open so you can change it."),
		).toBeTruthy();
		expect(screen.getByLabelText("Note (optional)")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(reopen).toHaveBeenCalledWith("s1", { expected_revision: 4 });
		expect(toast.success).toHaveBeenCalledWith("Reopened. You can edit again.");
	});

	it("a settled refusal shows the A12 copy and its web link", async () => {
		vi.spyOn(timeService, "reopenTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_HAS_SETTLED_ENTRIES",
				message: "x",
				extras: {
					timesheet_id: "s1",
					reason: "billed",
					invoice_id: "inv-1",
					invoice_number: "INV-0042",
					invoice_status: "sent",
				},
			}),
		);
		const onClose = vi.fn();
		renderWith(
			<ReopenSheetDialog
				open
				onClose={onClose}
				sheet={approved}
				settledHref={(link) => `/finance/invoices/${link.id}`}
			/>,
		);
		fireEvent.change(screen.getByPlaceholderText("What should Maria change?"), {
			target: { value: "x" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		expect(
			await screen.findByText(
				"Billed on invoice INV-0042. Void it without a replacement to reopen.",
			),
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open the invoice →" })
				.getAttribute("href"),
		).toBe("/finance/invoices/inv-1");
		expect(onClose).not.toHaveBeenCalled();
	});
});

describe("RequestReopenSheetDialog", () => {
	it("sends the note to the approvers", async () => {
		asViewer(MEMBER);
		const request = vi
			.spyOn(timeService, "requestReopenTimesheet")
			.mockResolvedValue(asRow(sheet({ status: "approved" })));
		const onClose = vi.fn();
		renderWith(
			<RequestReopenSheetDialog
				open
				onClose={onClose}
				sheet={sheet({ status: "approved", decision_kind: "manual" })}
			/>,
		);
		expect(screen.getAllByText("Ask to reopen")).toHaveLength(2);
		fireEvent.change(screen.getByPlaceholderText("What needs to change?"), {
			target: { value: "Wrong project on Tue" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Ask to reopen" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(request).toHaveBeenCalledWith("s1", {
			expected_revision: 4,
			note: "Wrong project on Tue",
		});
		expect(toast.success).toHaveBeenCalledWith(
			"Asked to reopen. The approvers have your note.",
		);
	});
});

describe("ApproveSelectedDialog", () => {
	it("counts the selection and hands back the note", () => {
		const onConfirm = vi.fn();
		render(
			<ApproveSelectedDialog
				open
				onClose={vi.fn()}
				count={3}
				onConfirm={onConfirm}
			/>,
		);
		expect(screen.getByText("Approve 3 timesheets")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Note (optional)"), {
			target: { value: "ok" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		expect(onConfirm).toHaveBeenCalledWith("ok");
	});
});

describe("DecisionDialog", () => {
	it("renders the dialog for its kind", () => {
		const view = renderWith(
			<DecisionDialog kind="return" open onClose={vi.fn()} sheet={sheet()} />,
		);
		expect(screen.getByText("Return timesheet")).toBeTruthy();
		view.unmount();
		renderWith(
			<DecisionDialog
				kind="approve"
				open
				onClose={vi.fn()}
				sheet={sheet()}
				overtime={{ overSeconds: 3600, payableSeconds: 3600 }}
				defaultApproveOvertime
			/>,
		);
		expect(screen.getByText("Approve timesheet")).toBeTruthy();
		expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
			true,
		);
	});
});
