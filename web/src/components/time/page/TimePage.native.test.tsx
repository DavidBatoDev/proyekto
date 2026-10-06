/* @vitest-environment jsdom */

// Native copy rules on the Time page (ux.md › Mobile; web blueprint §4): in
// the installed app the page never says contract, rate, payout or invoice,
// never shows an amount on agreement time and never links to /engagements.
// Agreement time stays on the page (a talent's own hours are execution work).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimePageSearch } from "@/lib/timeSearch";
import { timeService } from "@/services/time.service";
import type {
	ApprovalRow,
	TimeEntryView,
	TimeOverview,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
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
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: () => ({
		status: "ready",
		usage: null,
		plan: null,
		isComplimentary: false,
		hasFeature: () => true,
	}),
}));
const WS = { id: "w1", name: "Studio", slug: "studio", my_role: "member" };
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: WS,
		workspaces: [WS],
		isLoading: false,
	}),
	useMyWorkspacesQuery: () => ({ data: [WS] }),
}));
vi.mock("../forms/QuickAddBar", () => ({
	QuickAddBar: () => <div data-testid="quick-add" />,
}));

import { TimePage } from "./TimePage";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(root: HTMLElement = document.body) {
	const text = root.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(root.querySelectorAll("[title], [aria-label]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(root.querySelector('a[href*="/engagements"]')).toBeNull();
}

const MANILA = "Asia/Manila";
const NOW = new Date("2026-10-06T03:00:00.000Z");
const ASSIGNMENT = "33333333-3333-4333-8333-333333333333";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "assignment",
		context_ref: ASSIGNMENT,
		context_label_snapshot: "Acme Corp",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 3.5 * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: 3.5 * 3600,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: null,
		workspace_id: "w1",
		engagement_assignment_id: ASSIGNMENT,
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
			title: "Brand refresh",
			work_type: null,
			status: null,
		},
		project: { id: "p1", title: "Rebrand" },
		content_label: null,
		cost: "visible",
		rate_snapshot: 25,
		rate_type_snapshot: "hourly",
		currency_snapshot: "USD",
		amount_snapshot: 87.5,
		...over,
	};
}

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s1",
		member_user_id: "u1",
		member_display_name_snapshot: null,
		scope_kind: "engagement",
		scope_ref: "eng1",
		team_id: null,
		workspace_id: null,
		engagement_id: "eng1",
		scope_label_snapshot: "Acme Corp",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-10-05",
		period_end: "2026-10-11",
		timezone: MANILA,
		week_start: 1,
		status: "returned",
		approver_scope: "hirer",
		revision: 2,
		submitted_at: "2026-10-05T10:00:00.000Z",
		submitted_by: "u1",
		submission_kind: "manual",
		decided_at: "2026-10-05T12:00:00.000Z",
		decided_by: "cora",
		decision_kind: "manual",
		decision_note: "Split the rebrand work",
		overtime_approved: false,
		total_seconds: 3.5 * 3600,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-10-05T00:00:00.000Z",
		updated_at: "2026-10-05T12:00:00.000Z",
		entry_count: 1,
		running_count: 0,
		logged_seconds: 3.5 * 3600,
		...over,
	};
}

function overview(over: Partial<TimeOverview> = {}): TimeOverview {
	return {
		can_log: true,
		approver_mode: false,
		contexts: [
			{
				kind: "assignment",
				id: ASSIGNMENT,
				label: "Acme Corp",
				sheet_scope: { kind: "engagement", ref: "eng1" },
				current_sheet: null,
			},
		],
		approvals_waiting: 1,
		workspace_time_admin: [],
		...over,
	};
}

const approval: ApprovalRow = {
	...sheet({
		id: "a1",
		member_user_id: "theo",
		member_display_name_snapshot: "Theo Ramos",
		status: "submitted",
		decided_at: null,
		decided_by: null,
		decision_note: null,
	}),
	member: { id: "theo", display_name: "Theo Ramos", avatar_url: null },
	policy_workspace: { id: "w9", name: "Studio Team" },
	flags: { needs_review: 0, over_cap_seconds: 7200, running: 0 },
};

let client: QueryClient;

function renderPage(over: TimeOverview, search: TimePageSearch = {}) {
	vi.spyOn(timeService, "getOverview").mockResolvedValue(over);
	return render(
		<QueryClientProvider client={client}>
			<TimePage search={search} onSearchChange={vi.fn()} now={NOW} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: /max-width:\s*(\d+)px/.test(query),
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}),
	});
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useAuthStore.setState({ user: { id: "u1" } as never });
	vi.spyOn(timeService, "getPreferences").mockResolvedValue({
		user_id: "u1",
		timezone: MANILA,
		week_start: 1,
		updated_at: "2026-01-01T00:00:00.000Z",
	});
	vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
	vi.spyOn(timeService, "listMyProjects").mockResolvedValue({ projects: [] });
	vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
		items: [entry()],
		total: 1,
		page: 1,
		limit: 200,
	});
	vi.spyOn(timeService, "listMyTimesheets").mockImplementation(async (q) =>
		q?.from && q?.to ? [sheet()] : [sheet({ origin: "legacy_migration" })],
	);
	vi.spyOn(timeService, "listApprovals").mockImplementation(async (q) => ({
		items:
			q?.status === "decided"
				? [{ ...approval, id: "d1", status: "approved", decided_by: "u1" }]
				: [approval],
		total: 1,
		page: 1,
		limit: 50,
	}));
	vi.spyOn(timeService, "getProjectPolicy").mockRejectedValue(new Error("no"));
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("TimePage on native", () => {
	it("keeps agreement time without money words, amounts or /engagements links", async () => {
		renderPage(overview());
		await screen.findByTestId("timesheet-card");
		await screen.findAllByTestId("waiting-row");
		await waitFor(() =>
			expect(document.querySelectorAll("[data-entry-id]").length).toBe(1),
		);
		// The agreement card names the counterparty only.
		expect(screen.getByTestId("timesheet-card").textContent).toContain(
			"Acme Corp",
		);
		expect(screen.getByTestId("timesheet-card").textContent).not.toContain(
			"· agreement",
		);
		assertNativeSafe();
	});

	it("filters to the agreement with a native label", async () => {
		renderPage(overview(), { for: `assignment:${ASSIGNMENT}` });
		const select = (await screen.findByLabelText("For:")) as HTMLSelectElement;
		expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
			"All",
			"Acme Corp",
		]);
		await screen.findByTestId("timesheet-card");
		assertNativeSafe();
	});

	it("approver mode stays clean too", async () => {
		renderPage(
			overview({
				approver_mode: true,
				contexts: [],
				workspace_time_admin: [],
			}),
		);
		await screen.findAllByTestId("waiting-row");
		await screen.findAllByTestId("decided-row");
		assertNativeSafe();
	});
});
