/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for Workspace settings
// › Time, which stays in the app (`/settings` is an app surface): no
// contract, rate, payout or invoice; no amounts; no /engagements links. The
// plan notice speaks the native sentence with no upgrade link, and the
// timezone hint says "this device", not "your browser".

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntitlements } from "@/lib/entitlements";

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
const ents = vi.hoisted(() => ({ features: {} as Record<string, boolean> }));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (): WorkspaceEntitlements =>
		({
			status: "ready",
			usage: { workspace_id: "w1", features: [] },
			plan: "free",
			planName: "Free",
			planSource: null,
			isComplimentary: false,
			limits: null,
			upgradePlan: null,
			usedFor: () => null,
			meter: () => null,
			remaining: () => null,
			canCreate: () => true,
			hasFeature: (key: string) => ents.features[key] ?? true,
		}) as unknown as WorkspaceEntitlements,
}));
vi.mock("@/components/time/report/TimeReport", () => ({
	TimeReport: () => <div data-testid="time-report" />,
}));

import { NATIVE_FALLBACK_COPY } from "@/lib/timeErrors";
import { timeService } from "@/services/time.service";
import type {
	PolicyHistoryRow,
	ResolvedTimePolicy,
	WorkspacePolicyView,
} from "@/services/time.types";
import { historyLine } from "./PolicyHistory";
import { POLICY_FORM_COPY } from "./WorkspaceTimePolicyForm";
import type { WorkspaceTimePageSearch } from "./WorkspaceTimeReportTab";
import { WORKSPACE_REPORT_COPY } from "./WorkspaceTimeReportTab";
import { WorkspaceTimeSettings } from "./WorkspaceTimeSettings";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(
		document.body.querySelectorAll("[title],[aria-label],option"),
	)) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

const NOW = new Date("2026-10-06T03:00:00.000Z");
const OWNER = {
	id: "w1",
	name: "Acme",
	slug: "acme",
	my_role: "owner" as const,
};
const MEMBER = { ...OWNER, my_role: "member" as const };

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "Asia/Manila",
		period_anchor: null,
		approval_required: true,
		approver_scope: "workspace",
		allow_manual_entries: true,
		retroactive_days: 7,
		rounding_minutes: 15,
		weekly_limit_minutes: 2400,
		reminder_days: 1,
		hidden_presets: ["admin"],
		tracking_mode: null,
		sources: {},
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function view(over: Partial<WorkspacePolicyView> = {}): WorkspacePolicyView {
	return {
		workspace_id: "w1",
		policy: policy(),
		policy_unconfirmed: false,
		can_edit: true,
		...over,
	};
}

const HISTORY: PolicyHistoryRow[] = [
	{
		id: 3,
		created_at: "2026-10-02T02:00:00.000Z",
		actor: { id: "u1", display_name: "Ana Reyes" },
		changes: {
			period_kind: ["weekly", "semi_monthly"],
			weekly_limit_minutes: [null, 2400],
			hidden_presets: [[], ["admin"]],
		},
		scope: "workspace",
		team_id: null,
		team_name: null,
		kind: "changed",
	},
	{
		id: 2,
		created_at: "2026-10-01T02:00:00.000Z",
		actor: { id: "u1", display_name: "Ana Reyes" },
		changes: {
			approver_scope: [null, "team"],
			approval_required: [null, true],
		},
		scope: "team",
		team_id: "t1",
		team_name: "Prodigitality Services Inc. Team",
		kind: "created",
	},
	{
		id: 1,
		created_at: "2026-09-30T02:00:00.000Z",
		actor: { id: "u1", display_name: "Ana Reyes" },
		changes: {},
		scope: "workspace",
		team_id: null,
		team_name: null,
		kind: "confirmed",
	},
];

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	ents.features = {};
	vi.spyOn(timeService, "getWorkspacePolicyHistory").mockResolvedValue({
		items: HISTORY,
		total: HISTORY.length,
		page: 1,
		limit: 20,
	});
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
});

function renderPage(
	workspace: typeof OWNER | typeof MEMBER,
	search: WorkspaceTimePageSearch = {},
) {
	return render(
		<QueryClientProvider client={client}>
			<WorkspaceTimeSettings
				workspace={workspace}
				search={search}
				onSearchChange={vi.fn()}
				browserTimeZone="Asia/Manila"
				now={NOW}
			/>
		</QueryClientProvider>,
	);
}

describe("native: Workspace settings › Time", () => {
	it("the editor, its history and its hints carry no banned word", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view({ policy_unconfirmed: true }),
		);
		renderPage(OWNER);
		await screen.findByTestId("time-policy-form");
		await screen.findByTestId("policy-history-row");
		fireEvent.click(screen.getByRole("button", { name: "Show all" }));
		expect(screen.getAllByTestId("policy-history-row")).toHaveLength(3);
		expect(
			screen.getByText(
				`${POLICY_FORM_COPY.detectedDevice} · ${POLICY_FORM_COPY.timezoneHint}`,
			),
		).toBeTruthy();
		expect(screen.queryByText(/your browser/)).toBeNull();
		assertNativeSafe();
	});

	it("Free speaks the native plan sentence, without an upgrade link", async () => {
		ents.features = { time_tracking: false };
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view({
				policy: policy({
					plan: { time_tracking: false, time_team_rules: false },
				}),
			}),
		);
		renderPage(OWNER);
		await screen.findByTestId("time-policy-form");
		expect(
			screen.getByText(
				"Timesheets and approvals aren't on Acme's current plan. A workspace owner can change this on the web.",
			),
		).toBeTruthy();
		expect(
			screen.getByText("Everyone can still track time just for themselves."),
		).toBeTruthy();
		expect(document.body.querySelector("a")).toBeNull();
		assertNativeSafe();
	});

	it("a member's read-only policy and refused report are safe too", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view({ can_edit: false }),
		);
		renderPage(MEMBER);
		await screen.findByTestId("time-policy-readonly");
		assertNativeSafe();
		cleanup();
		client.clear();
		renderPage(MEMBER, { tab: "report" });
		await screen.findByText(WORKSPACE_REPORT_COPY.membersOnly);
		assertNativeSafe();
	});

	it("a history line naming a banned word falls back to the web pointer", () => {
		expect(
			historyLine(
				{
					...(HISTORY[0] as PolicyHistoryRow),
					changes: { default_rate_mode: ["a", "b"] },
				},
				{ now: NOW, userTimezone: "Asia/Manila" },
			),
		).toBe(NATIVE_FALLBACK_COPY);
	});
});
