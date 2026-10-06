/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	TimeOverview,
	WorkspaceTimeAdmin,
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
		status: "loading",
		usage: null,
		isComplimentary: false,
	}),
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({ data: [] }),
}));

import {
	ApproverModeView,
	caughtUpText,
	summaryAdmins,
} from "./ApproverModeView";

const ADMIN: WorkspaceTimeAdmin = {
	workspace_id: "w1",
	name: "Acme",
	slug: "acme",
	has_time_tracking: true,
	policy_unconfirmed: false,
};

function overview(over: Partial<TimeOverview> = {}): TimeOverview {
	return {
		can_log: true,
		approver_mode: true,
		contexts: [],
		approvals_waiting: 0,
		workspace_time_admin: [],
		...over,
	};
}

const POLICY: ResolvedTimePolicy = {
	tracking_enabled: true,
	period_kind: "weekly",
	week_start: 1,
	timezone: "Asia/Manila",
	period_anchor: null,
	approval_required: true,
	approver_scope: "workspace",
	allow_manual_entries: true,
	retroactive_days: null,
	rounding_minutes: 0,
	weekly_limit_minutes: null,
	reminder_days: 1,
	hidden_presets: [],
	tracking_mode: null,
	sources: {},
	plan: { time_tracking: true, time_team_rules: false },
	policy_workspace_id: "w1",
	team_override_applied: false,
	member: null,
	client_hours_detail_level: null,
};

let client: QueryClient;

function renderView(ui: ReactNode) {
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useAuthStore.setState({ user: { id: "u1" } as never });
	vi.spyOn(timeService, "listApprovals").mockResolvedValue({
		items: [],
		total: 0,
		page: 1,
		limit: 50,
	});
	vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue({
		workspace_id: "w1",
		policy: POLICY,
		policy_unconfirmed: false,
		can_edit: true,
	});
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("caughtUpText and summaryAdmins", () => {
	it("gives P5 the hint line and P7 the bare line", () => {
		expect(caughtUpText(overview())).toBe(
			"You're all caught up. Timesheets sent to you will show up here.",
		);
		expect(caughtUpText(overview({ workspace_time_admin: [ADMIN] }))).toBe(
			"You're all caught up.",
		);
	});

	it("leaves the confirm card's workspaces out of the policy cards", () => {
		const unconfirmed = {
			...ADMIN,
			workspace_id: "w2",
			policy_unconfirmed: true,
		};
		const free = {
			...ADMIN,
			workspace_id: "w3",
			has_time_tracking: false,
			policy_unconfirmed: true,
		};
		expect(
			summaryAdmins([ADMIN, unconfirmed, free]).map((a) => a.workspace_id),
		).toEqual(["w1", "w3"]);
	});
});

describe("ApproverModeView", () => {
	it("P5 with nothing waiting: the caught-up line and no policy cards", async () => {
		renderView(<ApproverModeView overview={overview()} />);
		expect(
			await screen.findByText(
				"You're all caught up. Timesheets sent to you will show up here.",
			),
		).toBeTruthy();
		expect(screen.queryByTestId("policy-summary-cards")).toBeNull();
		expect(screen.queryByTestId("day-strip")).toBeNull();
	});

	it("P7 with nothing waiting: the bare line above one policy card per workspace", async () => {
		renderView(
			<ApproverModeView
				overview={overview({ workspace_time_admin: [ADMIN] })}
			/>,
		);
		expect(await screen.findByText("You're all caught up.")).toBeTruthy();
		const cards = screen.getByTestId("policy-summary-cards");
		await waitFor(() => expect(cards.textContent).toContain("Acme"));
		expect(cards.textContent).toContain("Edit time policy");
	});

	it("hides the policy cards while something waits, and reads the decided list", async () => {
		const list = vi.spyOn(timeService, "listApprovals");
		renderView(
			<ApproverModeView
				overview={overview({
					approvals_waiting: 2,
					workspace_time_admin: [ADMIN],
				})}
			/>,
		);
		await waitFor(() =>
			expect(list).toHaveBeenCalledWith(
				expect.objectContaining({ status: "decided" }),
			),
		);
		expect(list).toHaveBeenCalledWith(
			expect.objectContaining({ status: "submitted" }),
		);
		expect(screen.queryByTestId("policy-summary-cards")).toBeNull();
		expect(document.getElementById("waiting")).toBeTruthy();
	});
});
