/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for the timesheets kit:
// cards, the Submit sheet, the decision dialogs, the stale banner and the
// toasts never say contract, rate, payout or invoice, never show an amount on
// an agreement, and never link to /engagements.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	TimeEntryView,
	TimesheetDetail,
	TimesheetRow,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	ApproveSheetDialog,
	ReopenSheetDialog,
	RequestReopenSheetDialog,
} from "./DecisionDialogs";
import { StaleRevisionBanner } from "./StaleRevisionBanner";
import { SubmitSheetDialog } from "./SubmitSheetDialog";
import { TimesheetCard } from "./TimesheetCard";
import { sheetSuccessToast } from "./useTimesheetActions";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(document.body.querySelectorAll("[title]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
	}
	for (const el of Array.from(
		document.body.querySelectorAll("[aria-label],[placeholder]"),
	)) {
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("placeholder") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

const MEMBER = "member-1";
const TZ = "Asia/Manila";
const NOW = new Date("2026-10-04T03:00:00.000Z");

const agreementSheet: TimesheetSummary = {
	id: "s1",
	member_user_id: MEMBER,
	member_display_name_snapshot: "Leo Cruz",
	scope_kind: "engagement",
	scope_ref: "eng-1",
	team_id: null,
	workspace_id: null,
	engagement_id: "eng-1",
	scope_label_snapshot: "Acme Corp",
	policy_workspace_id: "w1",
	period_kind: "weekly",
	period_start: "2026-09-28",
	period_end: "2026-10-04",
	timezone: TZ,
	week_start: 1,
	status: "open",
	approver_scope: null,
	revision: 2,
	submitted_at: null,
	submitted_by: null,
	submission_kind: null,
	decided_at: null,
	decided_by: null,
	decision_kind: null,
	decision_note: null,
	overtime_approved: false,
	total_seconds: 156_600,
	payable_seconds: null,
	origin: "app",
	created_at: "2026-09-28T01:00:00.000Z",
	updated_at: "2026-09-28T01:00:00.000Z",
	entry_count: 6,
	running_count: 0,
	logged_seconds: 156_600,
	routing_preview: {
		approver_scope: "hirer",
		cost_money: true,
		deciders: [{ id: "d1", display_name: "Ana Reyes" }],
	},
};

function agreementEntry(day: string): TimeEntryView {
	const start = new Date(`${day}T09:00:00+08:00`);
	return {
		id: `e-${day}`,
		context_kind: "assignment",
		context_ref: "a1",
		context_label_snapshot: "Acme Corp",
		timesheet_id: "s1",
		work_item: "task",
		started_at: start.toISOString(),
		ended_at: new Date(start.getTime() + 7.25 * 3600_000).toISOString(),
		paused_at: null,
		duration_seconds: 26_100,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: day === "2026-09-28" ? "stopped_by_assignment_end" : null,
		project_id: "p1",
		team_id: null,
		workspace_id: null,
		engagement_assignment_id: "a1",
		created_at: start.toISOString(),
		updated_at: start.toISOString(),
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: MEMBER,
		member_display_name_snapshot: "Leo Cruz",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "t1",
		note: null,
		task: { id: "t1", title: "Build the API", work_type: null, status: null },
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		// The person's own cost is visible on the web; native shows no amounts.
		cost: "visible",
		rate_snapshot: 25,
		currency_snapshot: "USD",
		amount_snapshot: 181.25,
	};
}

const policy = {
	tracking_enabled: true,
	period_kind: "weekly",
	week_start: 1,
	timezone: TZ,
	period_anchor: null,
	approval_required: true,
	approver_scope: "workspace",
	allow_manual_entries: true,
	retroactive_days: null,
	rounding_minutes: 0,
	weekly_limit_minutes: 2400,
	reminder_days: 1,
	hidden_presets: [],
	tracking_mode: "required",
	sources: { weekly_limit_minutes: "contract" },
	plan: { time_tracking: true, time_team_rules: false },
	policy_workspace_id: "w1",
	team_override_applied: false,
	member: null,
	client_hours_detail_level: "summary",
	engagement_id: "eng-1",
} satisfies ResolvedTimePolicy;

let client: QueryClient;

function renderWith(ui: ReactElement) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: MEMBER } as never });
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("native: timesheets kit", () => {
	it("an agreement card drops ' · agreement' and shows no amounts", () => {
		render(
			<TimesheetCard
				sheet={{
					...agreementSheet,
					status: "returned",
					decision_note: "Split Thu",
				}}
				onSubmit={vi.fn()}
				onFix={vi.fn()}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(screen.getByText("Acme Corp")).toBeTruthy();
		expect(screen.queryByText(/agreement/)).toBeNull();
		assertNativeSafe();
	});

	it("the Submit sheet for an agreement over its limit stays native-safe", async () => {
		const entries = [
			"2026-09-28",
			"2026-09-29",
			"2026-09-30",
			"2026-10-01",
			"2026-10-02",
			"2026-10-03",
		].map(agreementEntry);
		const sheetDetail: TimesheetDetail = {
			sheet: agreementSheet,
			entries,
			events: [],
			rules: null,
			routing: null,
			viewer: { is_member: true, can_decide: false, actions: ["submit"] },
			routing_preview: agreementSheet.routing_preview,
		};
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue(sheetDetail);
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(policy);
		renderWith(
			<SubmitSheetDialog
				open
				onClose={vi.fn()}
				sheet={agreementSheet}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(
			await screen.findByText(
				"Your agreement with Acme Corp allows 40h a week. You logged 43h 30m. The 3h 30m over needs Ana's approval.",
			),
		).toBeTruthy();
		expect(
			screen.getByText("Stopped when your agreement with Acme Corp ended."),
		).toBeTruthy();
		expect(screen.getByText("Goes to Ana Reyes")).toBeTruthy();
		assertNativeSafe();
	});

	it("a client agreement's confirm line is native-safe", async () => {
		const auto: TimesheetSummary = {
			...agreementSheet,
			routing_preview: {
				approver_scope: "auto",
				cost_money: false,
				deciders: [],
			},
		};
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			sheet: auto,
			entries: [agreementEntry("2026-09-29")],
			events: [],
			rules: null,
			routing: null,
			viewer: { is_member: true, can_decide: false, actions: ["submit"] },
		});
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(policy);
		renderWith(
			<SubmitSheetDialog open onClose={vi.fn()} sheet={auto} now={NOW} />,
		);
		expect(
			screen.getByText(
				"Submitting confirms these hours for your agreement with Acme Corp.",
			),
		).toBeTruthy();
		await screen.findByTestId("submit-days");
		assertNativeSafe();
	});

	it("a settled reopen says 'already being billed' with no link or number", async () => {
		useAuthStore.setState({ user: { id: "decider-1" } as never });
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
		renderWith(
			<ReopenSheetDialog
				open
				onClose={vi.fn()}
				sheet={{ ...agreementSheet, status: "approved" }}
				settledHref={(link) => `/engagements/finance/invoices/${link.id}`}
			/>,
		);
		fireEvent.change(screen.getByPlaceholderText("What should Leo change?"), {
			target: { value: "Wrong week" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		expect(
			await screen.findByText(
				"This time is already being billed. Reopen it on the web.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
		assertNativeSafe();
	});

	it("a paid reopen says 'already paid'", async () => {
		vi.spyOn(timeService, "reopenTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_HAS_SETTLED_ENTRIES",
				message: "x",
				extras: { timesheet_id: "s1", reason: "paid", payout_id: "po-1" },
			}),
		);
		renderWith(
			<ReopenSheetDialog
				open
				onClose={vi.fn()}
				sheet={{ ...agreementSheet, status: "approved", decision_kind: "self" }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		expect(
			await screen.findByText(
				"This time has already been paid. Reopen it on the web.",
			),
		).toBeTruthy();
		assertNativeSafe();
	});

	it("the approve dialog's overtime box and the ask-to-reopen dialog are native-safe", () => {
		const first = renderWith(
			<ApproveSheetDialog
				open
				onClose={vi.fn()}
				sheet={{ ...agreementSheet, status: "submitted" }}
				overtime={{ overSeconds: 12_600, payableSeconds: 144_000 }}
			/>,
		);
		assertNativeSafe();
		first.unmount();
		renderWith(
			<RequestReopenSheetDialog
				open
				onClose={vi.fn()}
				sheet={{ ...agreementSheet, status: "approved" }}
			/>,
		);
		assertNativeSafe();
	});

	it("the stale banner is native-safe", () => {
		render(
			<StaleRevisionBanner personName="Leo Cruz" onReviewLatest={vi.fn()} />,
		);
		assertNativeSafe();
	});

	it("every toast is native-safe", () => {
		const row = { ...agreementSheet, status: "submitted" } as TimesheetRow;
		for (const action of [
			"submit",
			"withdraw",
			"approve",
			"return",
			"reopen",
			"request_reopen",
			"approve_bulk",
		] as const) {
			const text = sheetSuccessToast(action, [row], [agreementSheet], {
				viewerId: MEMBER,
			});
			expect(text).not.toMatch(BANNED);
			expect(text).not.toMatch(AMOUNT);
		}
	});
});
