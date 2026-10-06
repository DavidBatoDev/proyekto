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
import type { WorkspaceEntitlements } from "@/lib/entitlements";

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
			<a href="#link" className={className}>
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
	useEntitlements: (): WorkspaceEntitlements =>
		({
			status: "ready",
			usage: { workspace_id: "w1", features: [] },
			plan: "business",
			planName: "Business",
			planSource: null,
			isComplimentary: false,
			limits: null,
			upgradePlan: null,
			usedFor: () => null,
			meter: () => null,
			remaining: () => null,
			canCreate: () => true,
			hasFeature: () => true,
		}) as unknown as WorkspaceEntitlements,
}));

const report = vi.hoisted(() => ({
	props: null as Record<string, unknown> | null,
}));
vi.mock("@/components/time/report/TimeReport", () => ({
	TimeReport: (props: Record<string, unknown>) => {
		report.props = props;
		return <div data-testid="time-report" />;
	},
}));

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	WorkspacePolicyView,
} from "@/services/time.types";
import { POLICY_FORM_COPY } from "./WorkspaceTimePolicyForm";
import type { WorkspaceTimePageSearch } from "./WorkspaceTimeReportTab";
import { WORKSPACE_REPORT_COPY } from "./WorkspaceTimeReportTab";
import {
	managesWorkspace,
	WORKSPACE_TIME_SETTINGS_COPY,
	WorkspaceTimeSettings,
	workspaceTimeTitle,
} from "./WorkspaceTimeSettings";

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
		retroactive_days: null,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
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

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
	cleanup();
	client.clear();
	report.props = null;
	vi.restoreAllMocks();
});

function renderPage(
	workspace: typeof OWNER | typeof MEMBER,
	search: WorkspaceTimePageSearch = {},
	onSearchChange = vi.fn(),
) {
	return render(
		<QueryClientProvider client={client}>
			<WorkspaceTimeSettings
				workspace={workspace}
				search={search}
				onSearchChange={onSearchChange}
				browserTimeZone="Asia/Manila"
				now={NOW}
			/>
		</QueryClientProvider>,
	);
}

describe("helpers", () => {
	it("titles the page by tab", () => {
		expect(workspaceTimeTitle("policy", "Acme")).toBe("Time policy · Acme");
		expect(workspaceTimeTitle("report", "Acme")).toBe("Time report · Acme");
		expect(workspaceTimeTitle("policy", " ")).toBe("Time policy");
		expect(managesWorkspace("owner")).toBe(true);
		expect(managesWorkspace("admin")).toBe(true);
		expect(managesWorkspace("member")).toBe(false);
		expect(managesWorkspace(null)).toBe(false);
	});
});

describe("WorkspaceTimeSettings", () => {
	it("reads the policy with the browser timezone and shows the editor, history and tabs", async () => {
		const get = vi
			.spyOn(timeService, "getWorkspacePolicy")
			.mockResolvedValue(view());
		const history = vi
			.spyOn(timeService, "getWorkspacePolicyHistory")
			.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
		const onSearchChange = vi.fn();
		renderPage(OWNER, {}, onSearchChange);
		expect(screen.getByRole("status").textContent).toBe(
			WORKSPACE_TIME_SETTINGS_COPY.loading,
		);
		await screen.findByTestId("time-policy-form");
		expect(get).toHaveBeenCalledWith("w1", { tz: "Asia/Manila" });
		expect(
			screen.getByRole("heading", { level: 1, name: "Time policy · Acme" }),
		).toBeTruthy();
		await waitFor(() => expect(history).toHaveBeenCalled());

		const tabs = screen.getAllByRole("tab");
		expect(tabs.map((t) => t.textContent)).toEqual(["Policy", "Report"]);
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
		fireEvent.click(tabs[1] as HTMLElement);
		expect(onSearchChange).toHaveBeenCalledWith({ tab: "report" });
		// Arrow keys move between tabs too.
		fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" });
		expect(onSearchChange).toHaveBeenCalledTimes(2);
	});

	it("gives members the read-only policy: no tabs, no history request", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view({ can_edit: false }),
		);
		const history = vi.spyOn(timeService, "getWorkspacePolicyHistory");
		renderPage(MEMBER);
		await screen.findByTestId("time-policy-readonly");
		expect(screen.getByText(POLICY_FORM_COPY.readOnly)).toBeTruthy();
		expect(screen.queryByRole("tab")).toBeNull();
		expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
		expect(history).not.toHaveBeenCalled();
	});

	it("the Report tab mounts the workspace report for owners and admins", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view({ policy: policy({ timezone: "America/New_York", week_start: 7 }) }),
		);
		const onSearchChange = vi.fn();
		renderPage(OWNER, { tab: "report", status: "submitted" }, onSearchChange);
		await screen.findByTestId("time-report");
		expect(
			screen.getByRole("heading", { level: 1, name: "Time report · Acme" }),
		).toBeTruthy();
		const props = report.props as Record<string, unknown>;
		expect(props.scope).toEqual({ kind: "workspace", id: "w1" });
		expect(props.search).toEqual({ status: "submitted" });
		expect(props.timezone).toBe("America/New_York");
		expect(props.weekStart).toBe(7);
		(props.onSearchChange as (patch: object) => void)({ group: "day" });
		expect(onSearchChange).toHaveBeenCalledWith(
			{ tab: "report", status: "submitted", group: "day" },
			{ replace: true },
		);
		// Back to Policy drops the report's filters.
		fireEvent.click(screen.getByRole("tab", { name: "Policy" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({});
	});

	it("a member on ?tab=report gets the reason card, not an empty report", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view({ can_edit: false }),
		);
		const onSearchChange = vi.fn();
		renderPage(MEMBER, { tab: "report" }, onSearchChange);
		await screen.findByText(WORKSPACE_REPORT_COPY.membersOnly);
		expect(screen.queryByTestId("time-report")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: WORKSPACE_REPORT_COPY.backToPolicy }),
		);
		expect(onSearchChange).toHaveBeenCalledWith({});
	});

	it("a 404 reads as a not-found card; a server error offers Try again", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockRejectedValue(
			new TimeApiError({ status: 404, code: "HTTP_404", message: "" }),
		);
		renderPage(MEMBER);
		expect(
			await screen.findByText("This doesn't exist or you can't open it."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		cleanup();
		client.clear();

		const get = vi
			.spyOn(timeService, "getWorkspacePolicy")
			.mockRejectedValueOnce(
				new TimeApiError({ status: 400, code: "HTTP_400", message: "" }),
			)
			.mockResolvedValueOnce(view());
		vi.spyOn(timeService, "getWorkspacePolicyHistory").mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			limit: 20,
		});
		renderPage(OWNER);
		fireEvent.click(
			await screen.findByRole("button", {
				name: WORKSPACE_TIME_SETTINGS_COPY.retry,
			}),
		);
		await screen.findByTestId("time-policy-form");
		expect(get).toHaveBeenCalledTimes(2);
	});
});
