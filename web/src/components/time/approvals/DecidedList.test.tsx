/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeApiError, timeService } from "@/services/time.service";
import type { ApprovalRow } from "@/services/time.types";
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

import { DecidedList, decidedLine } from "./DecidedList";

const DECIDER = "decider-1";
const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T03:00:00.000Z");

function decided(over: Partial<ApprovalRow> = {}): ApprovalRow {
	return {
		id: "s1",
		member_user_id: "m-maria",
		member_display_name_snapshot: "Maria Santos",
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-09-14",
		period_end: "2026-09-20",
		timezone: TZ,
		week_start: 1,
		status: "approved",
		approver_scope: "team",
		revision: 6,
		submitted_at: "2026-09-21T02:00:00.000Z",
		submitted_by: "m-maria",
		submission_kind: "manual",
		decided_at: "2026-09-23T02:00:00.000Z",
		decided_by: DECIDER,
		decision_kind: "manual",
		decision_note: null,
		overtime_approved: false,
		total_seconds: 144_000,
		payable_seconds: 144_000,
		origin: "app",
		created_at: "2026-09-14T01:00:00.000Z",
		updated_at: "2026-09-23T02:00:00.000Z",
		entry_count: 8,
		running_count: 0,
		logged_seconds: 144_000,
		member: { id: "m-maria", display_name: "Maria Santos", avatar_url: null },
		policy_workspace: { id: "w1", name: "Prodigitality Workspace" },
		...over,
	};
}

const approved = decided();
const returned = decided({
	id: "s2",
	member_user_id: "m-leo",
	member: { id: "m-leo", display_name: "Leo Cruz", avatar_url: null },
	status: "returned",
	decision_note: "Add task names",
	total_seconds: 34_200,
	logged_seconds: 34_200,
	policy_workspace: { id: "w-acme", name: "Acme" },
});

let client: QueryClient;

function renderList(
	items: ApprovalRow[],
	props: Partial<Parameters<typeof DecidedList>[0]> = {},
) {
	const list = vi
		.spyOn(timeService, "listApprovals")
		.mockResolvedValue({ items, total: items.length, page: 1, limit: 50 });
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const view = render(
		<QueryClientProvider client={client}>
			<DecidedList now={NOW} userTimezone={TZ} {...props} />
		</QueryClientProvider>,
	);
	return { ...view, list };
}

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

describe("DecidedList", () => {
	it("lists the viewer's decisions with what they decided", async () => {
		const { list } = renderList([approved, returned], {
			currentWorkspaceId: "w1",
		});
		const rows = await screen.findAllByTestId("decided-row");
		expect(list).toHaveBeenCalledWith({
			status: "decided",
			since: undefined,
			scope_kind: undefined,
			limit: 50,
		});
		expect(screen.getByText("Decided in the last 30 days")).toBeTruthy();
		expect(rows).toHaveLength(2);

		expect(within(rows[0]).getByText("Maria Santos")).toBeTruthy();
		expect(within(rows[0]).getByText("Sep 14–20")).toBeTruthy();
		expect(within(rows[0]).getByText("40:00")).toBeTruthy();
		expect(within(rows[0]).getByTestId("decided-line").textContent).toBe(
			"Approved by you · Sep 23",
		);
		expect(within(rows[0]).getByLabelText("Approved")).toBeTruthy();
		expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe(
			"/time/timesheets/s1",
		);
		expect(within(rows[0]).queryByTestId("for-workspace-tag")).toBeNull();

		expect(within(rows[1]).getByTestId("decided-line").textContent).toBe(
			"Returned by you · 'Add task names'",
		);
		expect(within(rows[1]).getByText("9:30")).toBeTruthy();
		expect(within(rows[1]).getByLabelText("Returned")).toBeTruthy();
		expect(within(rows[1]).getByTestId("for-workspace-tag").textContent).toBe(
			"Acme",
		);
	});

	it("renders nothing when nothing was decided, unless asked", async () => {
		const first = renderList([]);
		await waitFor(() =>
			expect(vi.mocked(timeService.listApprovals)).toHaveBeenCalled(),
		);
		await waitFor(() => expect(first.container.textContent).toBe(""));
		first.unmount();
		renderList([], { hideWhenEmpty: false });
		expect(await screen.findByText("Nothing decided yet.")).toBeTruthy();
	});

	it("passes since and scope through", async () => {
		const { list } = renderList([approved], {
			since: "2026-09-01",
			scopeKind: "engagement",
			limit: 500,
		});
		await screen.findAllByTestId("decided-row");
		expect(list).toHaveBeenCalledWith({
			status: "decided",
			since: "2026-09-01",
			scope_kind: "engagement",
			limit: 100,
		});
	});

	it("a failed read shows a reason card", async () => {
		vi.spyOn(timeService, "listApprovals").mockRejectedValue(
			new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
		);
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<DecidedList now={NOW} />
			</QueryClientProvider>,
		);
		expect(
			await screen.findByText("This doesn't exist or you can't open it."),
		).toBeTruthy();
	});
});

describe("decidedLine", () => {
	const opts = { viewerId: DECIDER, now: NOW, timezone: TZ };

	it("approved: who and when, plus overtime", () => {
		expect(decidedLine(approved, opts)).toBe("Approved by you · Sep 23");
		expect(decidedLine({ ...approved, overtime_approved: true }, opts)).toBe(
			"Approved by you · Sep 23 · Overtime approved",
		);
		expect(
			decidedLine(
				{ ...approved, decided_by: "other" },
				{ ...opts, names: { other: "Ana Reyes" } },
			),
		).toBe("Approved by Ana · Sep 23");
	});

	it("returned: the note when there is one, else the date", () => {
		expect(decidedLine(returned, opts)).toBe(
			"Returned by you · 'Add task names'",
		);
		expect(decidedLine({ ...returned, decision_note: null }, opts)).toBe(
			"Returned by you · Sep 23",
		);
	});

	it("a sheet that moved on says where it is now", () => {
		expect(decidedLine({ ...approved, status: "submitted" }, opts)).toBe(
			"Submitted",
		);
	});
});
