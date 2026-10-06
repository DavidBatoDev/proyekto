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
import { submittedAgo } from "@/lib/timeFormat";
import { TimeApiError, timeService } from "@/services/time.service";
import type { ApprovalRow, Paged, TimesheetRow } from "@/services/time.types";
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

import {
	APPROVAL_FLAGS_PAGE_MAX,
	approvalRowBlock,
	groupApprovalRows,
	WaitingForYouList,
} from "./WaitingForYouList";

const DECIDER = "decider-1";
const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T03:00:00.000Z");

function approval(over: Partial<ApprovalRow> = {}): ApprovalRow {
	const memberId = over.member_user_id ?? "m-maria";
	return {
		id: "s1",
		member_user_id: memberId,
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
		revision: 3,
		submitted_at: "2026-10-04T02:00:00.000Z",
		submitted_by: memberId,
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
		updated_at: "2026-10-04T02:00:00.000Z",
		entry_count: 6,
		running_count: 0,
		logged_seconds: 137_700,
		member: { id: memberId, display_name: "Maria Santos", avatar_url: null },
		policy_workspace: { id: "w1", name: "Prodigitality Workspace" },
		flags: { needs_review: 0, over_cap_seconds: 0, running: 0 },
		...over,
	};
}

const maria = approval({
	id: "s1",
	flags: { needs_review: 1, over_cap_seconds: 0, running: 0 },
});
const ana = approval({
	id: "s2",
	member_user_id: "m-ana",
	member_display_name_snapshot: "Ana Lim",
	member: { id: "m-ana", display_name: "Ana Lim", avatar_url: null },
	scope_kind: "workspace",
	scope_label_snapshot: "Acme",
	policy_workspace: { id: "w-acme", name: "Acme" },
	total_seconds: 144_000,
	submitted_at: "2026-10-06T01:00:00.000Z",
	flags: { needs_review: 0, over_cap_seconds: 7200, running: 0 },
});
const leoA = approval({
	id: "s3",
	member_user_id: "m-leo",
	member_display_name_snapshot: "Leo",
	member: { id: "m-leo", display_name: "Leo Cruz", avatar_url: null },
	scope_kind: "engagement",
	scope_label_snapshot: "Acme Corp",
	revision: 7,
	total_seconds: 43_200,
});
const leoB = approval({
	id: "s4",
	member_user_id: "m-leo",
	member_display_name_snapshot: "Leo",
	member: { id: "m-leo", display_name: "Leo Cruz", avatar_url: null },
	scope_label_snapshot: "Design Team",
	revision: 2,
	total_seconds: 7200,
});
const sam = approval({
	id: "s5",
	member_user_id: "m-sam",
	member_display_name_snapshot: "Sam Reyes",
	member: { id: "m-sam", display_name: "Sam Reyes", avatar_url: null },
	revision: 9,
	flags: { needs_review: 0, over_cap_seconds: 0, running: 0 },
});

function paged(
	items: ApprovalRow[],
	total = items.length,
	page = 1,
	limit = 50,
): Paged<ApprovalRow> {
	return { items, total, page, limit };
}

let client: QueryClient;

function renderList(
	items: ApprovalRow[] | Paged<ApprovalRow>,
	props: Partial<Parameters<typeof WaitingForYouList>[0]> = {},
) {
	const list = vi
		.spyOn(timeService, "listApprovals")
		.mockResolvedValue(Array.isArray(items) ? paged(items) : items);
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={client}>
			<WaitingForYouList now={NOW} userTimezone={TZ} {...props} />
		</QueryClientProvider>,
	);
	return { ...view, list };
}

const rowOf = (id: string) =>
	screen
		.getAllByTestId("waiting-row")
		.find((el) => el.getAttribute("data-sheet-id") === id) as HTMLElement;
const checkboxOf = (id: string) =>
	within(rowOf(id)).getByRole("checkbox") as HTMLInputElement;

beforeEach(() => {
	useAuthStore.setState({ user: { id: DECIDER } as never });
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("WaitingForYouList", () => {
	it("lists the waiting sheets with person, scope, period, total, age and flags", async () => {
		const { list } = renderList([maria, ana, sam]);
		await screen.findAllByTestId("waiting-row");
		expect(list).toHaveBeenCalledWith({
			status: "submitted",
			scope_kind: undefined,
			page: 1,
			limit: 50,
		});
		expect(screen.getByText("Waiting for you (3)")).toBeTruthy();

		const mariaRow = rowOf("s1");
		expect(within(mariaRow).getByText("Maria Santos")).toBeTruthy();
		// Chips cut at 22 characters with the full name as the tooltip.
		const scope = within(mariaRow).getByText("Prodigitality Services…");
		expect(scope.getAttribute("title")).toBe(
			"Prodigitality Services Inc. Team",
		);
		expect(within(mariaRow).getByText("Sep 21–27")).toBeTruthy();
		expect(within(mariaRow).getByText("38:15")).toBeTruthy();
		expect(within(mariaRow).getByText("2 days ago")).toBeTruthy();
		expect(within(mariaRow).getByTestId("waiting-flags").textContent).toContain(
			"1",
		);
		expect(within(mariaRow).getByRole("link").getAttribute("href")).toBe(
			"/time/timesheets/s1",
		);

		const anaRow = rowOf("s2");
		expect(within(anaRow).getByText("today")).toBeTruthy();
		expect(within(anaRow).getByTestId("waiting-over").textContent).toBe("+2h");
	});

	it("flagged, over-limit and unchecked sheets can't be selected, with the reason", async () => {
		const partial = approval({
			id: "s6",
			member_user_id: "m-kim",
			member: { id: "m-kim", display_name: "Kim", avatar_url: null },
			flags_partial: true,
		});
		const running = approval({
			id: "s7",
			member_user_id: "m-joy",
			member: { id: "m-joy", display_name: "Joy", avatar_url: null },
			flags: { needs_review: 0, over_cap_seconds: 0, running: 1 },
		});
		renderList([maria, ana, sam, partial, running]);
		await screen.findAllByTestId("waiting-row");
		expect(checkboxOf("s1").disabled).toBe(true);
		expect(checkboxOf("s1").title).toBe("Has flags. Open it to review.");
		expect(checkboxOf("s7").title).toBe("Has flags. Open it to review.");
		expect(checkboxOf("s2").disabled).toBe(true);
		expect(checkboxOf("s2").title).toBe(
			"Over the limit. Open it to decide the overtime.",
		);
		expect(checkboxOf("s6").title).toBe(
			"Not checked against the limit yet. Open it to review.",
		);
		expect(checkboxOf("s5").disabled).toBe(false);
		// The reason is also read out with the checkbox.
		expect(
			screen.getAllByText("Has flags. Open it to review.").length,
		).toBeGreaterThan(0);
	});

	it("tags rows of another policy workspace than the current one (E27)", async () => {
		const first = renderList([maria, ana], { currentWorkspaceId: "w1" });
		await screen.findAllByTestId("waiting-row");
		expect(within(rowOf("s1")).queryByTestId("for-workspace-tag")).toBeNull();
		expect(
			within(rowOf("s2")).getByTestId("for-workspace-tag").textContent,
		).toBe("Acme");
		first.unmount();

		renderList([maria, ana]);
		await screen.findAllByTestId("waiting-row");
		expect(screen.queryAllByTestId("for-workspace-tag")).toHaveLength(0);
	});

	it("groups a person's sheets; the group checkbox selects their eligible ones", async () => {
		renderList([leoA, sam, leoB]);
		const group = await screen.findByTestId("waiting-group");
		expect(within(group).getByText("Leo Cruz")).toBeTruthy();
		expect(within(group).getByText("2 timesheets")).toBeTruthy();
		fireEvent.click(
			within(group).getByRole("checkbox", {
				name: "Select Leo Cruz's timesheets",
			}),
		);
		expect(checkboxOf("s3").checked).toBe(true);
		expect(checkboxOf("s4").checked).toBe(true);
		expect(checkboxOf("s5").checked).toBe(false);
		expect(
			screen.getByRole("button", { name: "Approve selected (2)" }),
		).toBeTruthy();
	});

	it("approves the selection in one all-or-nothing call", async () => {
		const bulk = vi
			.spyOn(timeService, "approveTimesheetsBulk")
			.mockResolvedValue([{ id: "s3" }, { id: "s5" }] as TimesheetRow[]);
		renderList([leoA, sam, maria]);
		await screen.findAllByTestId("waiting-row");
		const header = screen.getByRole("button", { name: "Approve selected" });
		expect((header as HTMLButtonElement).disabled).toBe(true);

		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Select every timesheet that can be approved",
			}),
		);
		expect(checkboxOf("s1").checked).toBe(false);
		expect(screen.getByTestId("waiting-floating-bar").textContent).toContain(
			"2 selected",
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Approve selected (2)" }),
		);
		expect(screen.getByText("Approve 2 timesheets")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		await waitFor(() =>
			expect(bulk).toHaveBeenCalledWith({
				ids: ["s3", "s5"],
				expected_revisions: [7, 9],
			}),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("Approved 2 timesheets"),
		);
		await waitFor(() => expect(checkboxOf("s5").checked).toBe(false));
		expect(screen.queryByTestId("waiting-floating-bar")).toBeNull();
	});

	it("a stale sheet approves nothing and names the person (A10)", async () => {
		vi.spyOn(timeService, "approveTimesheetsBulk").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "STALE_REVISION",
				message: "x",
				extras: { timesheet_id: "s3", expected: 7, actual: 8 },
			}),
		);
		renderList([leoA, sam]);
		await screen.findAllByTestId("waiting-row");
		fireEvent.click(checkboxOf("s3"));
		fireEvent.click(checkboxOf("s5"));
		fireEvent.click(
			screen.getByRole("button", { name: "Approve selected (2)" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));

		const banner = await screen.findByTestId("stale-revision-banner");
		expect(banner.textContent).toContain(
			"Nothing was approved: Leo Cruz's timesheet changed.",
		);
		expect(
			within(banner).getByRole("link", { name: "Review" }).getAttribute("href"),
		).toBe("/time/timesheets/s3");
		// The changed sheet is never approved unseen on the next click.
		await waitFor(() => expect(checkboxOf("s3").checked).toBe(false));
		expect(checkboxOf("s5").checked).toBe(true);
		expect(toast.success).not.toHaveBeenCalled();
		fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByTestId("stale-revision-banner")).toBeNull();
	});

	it("shows the caught-up line when nothing waits, or nothing at all", async () => {
		const first = renderList([]);
		expect(
			await screen.findByText(
				"You're all caught up. Timesheets sent to you will show up here.",
			),
		).toBeTruthy();
		first.unmount();
		const { container } = renderList([], { emptyText: null });
		await waitFor(() =>
			expect(vi.mocked(timeService.listApprovals)).toHaveBeenCalled(),
		);
		await waitFor(() => expect(container.textContent).toBe(""));
	});

	it("pages past the page size", async () => {
		const { list } = renderList(paged([sam], 3, 1, 1), { pageSize: 1 });
		await screen.findByText("Page 1 of 3");
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() =>
			expect(list).toHaveBeenLastCalledWith({
				status: "submitted",
				scope_kind: undefined,
				page: 2,
				limit: 1,
			}),
		);
	});

	it("never asks for more rows than the server checks against the limit (A3: 50)", async () => {
		const { list } = renderList([sam], { pageSize: 100 });
		await screen.findAllByTestId("waiting-row");
		expect(APPROVAL_FLAGS_PAGE_MAX).toBe(50);
		expect(list).toHaveBeenCalledWith({
			status: "submitted",
			scope_kind: undefined,
			page: 1,
			limit: 50,
		});
	});

	it("a page left empty goes back to the last page with rows", async () => {
		const list = vi
			.spyOn(timeService, "listApprovals")
			.mockImplementation(async (q) =>
				q?.page === 2 ? paged([], 1, 2, 1) : paged([sam], 2, 1, 1),
			);
		client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<WaitingForYouList now={NOW} userTimezone={TZ} pageSize={1} />
			</QueryClientProvider>,
		);
		await screen.findByText("Page 1 of 2");
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() =>
			expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })),
		);
		// Page 2 came back empty (its sheets were decided): back on page 1.
		await screen.findByText("Page 1 of 2");
		expect(rowOf("s5")).toBeTruthy();
	});

	it("a page left empty with nothing waiting shows the empty state", async () => {
		vi.spyOn(timeService, "listApprovals").mockResolvedValue(
			paged([sam], 2, 1, 1),
		);
		client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<WaitingForYouList now={NOW} userTimezone={TZ} pageSize={1} />
			</QueryClientProvider>,
		);
		await screen.findByText("Page 1 of 2");
		// Everything was decided elsewhere: page 1 now reads empty too.
		vi.mocked(timeService.listApprovals).mockImplementation(async (q) =>
			paged([], 0, q?.page ?? 1, 1),
		);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await screen.findByText(
			"You're all caught up. Timesheets sent to you will show up here.",
		);
	});

	it("a failed read shows a reason card with Try again", async () => {
		vi.spyOn(timeService, "listApprovals").mockRejectedValue(
			new TimeApiError({
				status: 403,
				code: "missing_permission",
				message: "x",
			}),
		);
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<WaitingForYouList now={NOW} />
			</QueryClientProvider>,
		);
		expect(
			await screen.findByText("You don't have permission to do that."),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});

describe("helpers", () => {
	it("approvalRowBlock reads A3 flags (no flags → selectable)", () => {
		expect(approvalRowBlock({ flags: undefined })).toBeNull();
		expect(approvalRowBlock(sam)).toBeNull();
		expect(approvalRowBlock(maria)?.kind).toBe("flags");
		expect(approvalRowBlock(ana)?.kind).toBe("over_limit");
		expect(
			approvalRowBlock({
				flags: {
					needs_review: 0,
					over_cap_seconds: 0,
					running: 0,
					flags_partial: true,
				},
			})?.kind,
		).toBe("unchecked");
	});

	it("submittedAgo reads days in the viewer's timezone", () => {
		const opts = { now: NOW, timezone: TZ };
		expect(submittedAgo("2026-10-06T00:30:00.000Z", opts)).toBe("today");
		expect(submittedAgo("2026-10-05T03:00:00.000Z", opts)).toBe("yesterday");
		expect(submittedAgo("2026-10-03T03:00:00.000Z", opts)).toBe("3 days ago");
		expect(submittedAgo("2026-09-22T03:00:00.000Z", opts)).toBe("Sep 22");
		expect(submittedAgo(null, opts)).toBe("");
		expect(submittedAgo("not a date", opts)).toBe("");
	});

	it("groupApprovalRows keeps the queue order", () => {
		const groups = groupApprovalRows([leoA, sam, leoB]);
		expect(groups.map((g) => g.name)).toEqual(["Leo Cruz", "Sam Reyes"]);
		expect(groups[0].rows.map((r) => r.id)).toEqual(["s3", "s4"]);
	});
});
