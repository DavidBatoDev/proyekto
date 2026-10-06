/* @vitest-environment jsdom */

/**
 * Team › Time (ux.md › Reports, Routes and Redirects, Mobile): the layout's
 * sub-nav and refusal cards, the Report index, and the Finance › team › Time
 * mount. The redirect stubs are covered in `redirects.test.ts`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { TeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import type { TimeReportProps } from "@/components/time/report/TimeReport";
import type { Team } from "@/services/teams.service";
import { TimeApiError, timeService } from "@/services/time.service";
import type { TeamPolicyView, TimeEntryView } from "@/services/time.types";

const TEAM = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const PERSON = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
	native: false,
	pathname: "/w/acme/teams/t/time",
	navigate: vi.fn(),
	access: null as unknown as TeamMoneyAccess,
	reportProps: null as TimeReportProps | null,
	modalProps: null as {
		entryId: string | null;
		mode?: string;
		timeZone?: string;
		onClose: () => void;
	} | null,
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));
vi.mock("@/components/layout/DashboardShell", () => ({
	DashboardShell: ({ children }: { children: ReactNode }) => (
		<main>{children}</main>
	),
}));
vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: () => mocks.access,
}));
vi.mock("@/components/time/report/TimeReport", () => ({
	TimeReport: (props: TimeReportProps) => {
		mocks.reportProps = props;
		return <div data-testid="time-report" />;
	},
}));
vi.mock("@/components/time/entries/TimeEntryDetailModal", () => ({
	TimeEntryDetailModal: (props: NonNullable<typeof mocks.modalProps>) => {
		mocks.modalProps = props;
		return props.entryId ? (
			<div role="dialog" aria-label="Entry">
				{props.entryId}
			</div>
		) : null;
	},
}));
// The finance shell and its gate have their own tests; here they pass through.
vi.mock("@/components/finance/team/TeamFinanceChrome", () => ({
	TeamFinanceChrome: ({
		section,
		children,
	}: {
		section: string;
		children: ReactNode;
	}) => <div data-testid={`finance-${section}`}>{children}</div>,
}));
vi.mock("@/components/team-time/TeamMoneyGate", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	TeamMoneyGate: ({
		need,
		children,
	}: {
		need: string;
		children: ReactNode;
	}) => <div data-testid={`gate-${need}`}>{children}</div>,
}));

/** Writes a router link as a plain href: params substituted, search appended. */
function hrefOf(
	to: string,
	params?: Record<string, string>,
	search?: Record<string, string | undefined>,
): string {
	let path = to;
	for (const [key, value] of Object.entries(params ?? {})) {
		path = path.replace(`$${key}`, value);
	}
	const query = new URLSearchParams(
		Object.entries(search ?? {}).filter(
			(pair): pair is [string, string] => typeof pair[1] === "string",
		),
	).toString();
	return query ? `${path}?${query}` : path;
}

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Link: ({
		to,
		params,
		search,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		search?: Record<string, string | undefined>;
		children?: ReactNode;
		className?: string;
		"aria-current"?: "page";
	}) => (
		<a
			href={hrefOf(to, params, search)}
			className={rest.className}
			aria-current={rest["aria-current"]}
		>
			{children}
		</a>
	),
	Outlet: () => <div data-testid="outlet" />,
	useLocation: (opts?: { select?: (l: { pathname: string }) => unknown }) =>
		opts?.select
			? opts.select({ pathname: mocks.pathname })
			: { pathname: mocks.pathname },
	useNavigate: () => mocks.navigate,
}));

import { Route as FinanceRoute } from "@/routes/_execution/engagements/finance/team/$teamId/time-logs";
import { Route as IndexRoute } from "./index";
import { Route as LayoutRoute } from "./route";

const FORBIDDEN = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3} -?\d[\d,]*(?:\.\d+)?\b|[$€£₱¥]\s?\d/;

beforeAll(async () => {
	for (const route of [LayoutRoute, IndexRoute, FinanceRoute]) {
		const component = route.options.component as unknown as {
			preload?: () => Promise<void>;
		};
		await component.preload?.();
	}
}, 30_000);

function team(over: Partial<Team> = {}): Team {
	return {
		id: TEAM,
		owner_id: "owner-1",
		workspace_id: "ws-1",
		name: "Prodigitality Services Inc. Team",
		time_tracking_enabled: true,
		member_rates_enabled: true,
		payouts_enabled: true,
		pay_period_config: null,
		...over,
	} as Team;
}

function access(over: Partial<TeamMoneyAccess> = {}): TeamMoneyAccess {
	return {
		isLoading: false,
		error: null,
		team: team(),
		isApprover: true,
		isTeamMember: true,
		timeTrackingEnabled: true,
		hasRates: true,
		canPay: true,
		planWorkspaceId: "ws-1",
		planWorkspace: {
			id: "ws-1",
			name: "Acme",
			slug: "acme",
			my_role: "owner",
		} as TeamMoneyAccess["planWorkspace"],
		isComplimentary: false,
		planStatus: "ready",
		payoutsPlanLimit: null,
		teamRulesPlanLimit: null,
		...over,
	};
}

function policyView(): TeamPolicyView {
	return {
		team_id: TEAM,
		override: null,
		effective: { timezone: "Asia/Manila", week_start: 1 },
		can_edit_money_fields: true,
		has_team_rules: true,
	} as unknown as TeamPolicyView;
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	mocks.native = false;
	mocks.pathname = `/w/acme/teams/${TEAM}/time`;
	mocks.navigate.mockReset();
	mocks.access = access();
	mocks.reportProps = null;
	mocks.modalProps = null;
	const params = { workspaceSlug: "acme", teamId: TEAM };
	vi.spyOn(LayoutRoute, "useParams").mockReturnValue(params as never);
	vi.spyOn(IndexRoute, "useParams").mockReturnValue(params as never);
	vi.spyOn(IndexRoute, "useSearch").mockReturnValue({} as never);
	vi.spyOn(FinanceRoute, "useParams").mockReturnValue({
		teamId: TEAM,
	} as never);
	vi.spyOn(FinanceRoute, "useSearch").mockReturnValue({
		person: PERSON,
	} as never);
	vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(policyView());
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
});

function renderRoute(route: { options: { component?: unknown } }) {
	const Page = route.options.component as ComponentType;
	return render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
}

function subNavLabels(): string[] {
	const nav = screen.getByRole("navigation", { name: "Team time" });
	return within(nav)
		.getAllByRole("link")
		.map((link) => link.textContent ?? "");
}

/** Every visible string, title and accessible label, plus every link target. */
function nativeSweep() {
	const texts = [document.body.textContent ?? ""];
	for (const el of Array.from(
		document.querySelectorAll("[title],[aria-label],[placeholder],[alt]"),
	)) {
		for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
			const value = el.getAttribute(attr);
			if (value) texts.push(value);
		}
	}
	const all = texts.join(" \n ");
	expect(all).not.toMatch(FORBIDDEN);
	expect(all).not.toMatch(AMOUNT);
	for (const a of Array.from(document.querySelectorAll("a[href]"))) {
		expect(a.getAttribute("href") ?? "").not.toMatch(/\/engagements\b/);
	}
}

describe("Team › Time layout", () => {
	it("gives a manager the Report · Rates · Payouts sub-nav and the page", () => {
		renderRoute(LayoutRoute);

		expect(
			screen.getByRole("heading", {
				level: 1,
				name: "Time · Prodigitality Services Inc. Team",
			}),
		).toBeTruthy();
		expect(subNavLabels()).toEqual(["Report", "Rates", "Payouts"]);
		const report = screen.getByRole("link", { name: "Report" });
		expect(report.getAttribute("aria-current")).toBe("page");
		expect(report.getAttribute("href")).toBe(`/w/acme/teams/${TEAM}/time`);
		expect(
			screen.getByRole("link", { name: "Payouts" }).getAttribute("href"),
		).toBe(`/w/acme/teams/${TEAM}/time/payouts`);
		expect(
			screen.getByRole("link", { name: "Time settings" }).getAttribute("href"),
		).toBe(`/w/acme/teams/${TEAM}/settings/time`);
		expect(screen.getByTestId("outlet")).toBeTruthy();
		// The retired tabs are gone.
		expect(screen.queryByText(/my logs|team logs/i)).toBeNull();
	});

	it("marks Rates current on the rates page, even with a workspace slug of 'time'", () => {
		mocks.pathname = `/w/time/teams/${TEAM}/time/manage-rates`;
		renderRoute(LayoutRoute);
		expect(
			screen.getByRole("link", { name: "Rates" }).getAttribute("aria-current"),
		).toBe("page");
		expect(
			screen.getByRole("link", { name: "Report" }).getAttribute("aria-current"),
		).toBeNull();
	});

	it("hides Rates and Payouts while the team's switches are off", () => {
		mocks.access = access({ hasRates: false, canPay: false });
		renderRoute(LayoutRoute);
		expect(subNavLabels()).toEqual(["Report"]);
	});

	it("answers a rates URL whose switch is off with a card, not the page", () => {
		mocks.access = access({ hasRates: false, canPay: false });
		mocks.pathname = `/w/acme/teams/${TEAM}/time/manage-rates`;
		renderRoute(LayoutRoute);
		expect(
			screen.getByText("Member rates are turned off for this team."),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open settings" }).getAttribute("href"),
		).toBe(`/w/acme/teams/${TEAM}/settings/time`);
		expect(screen.queryByTestId("outlet")).toBeNull();
	});

	it("says time tracking is off, with the way to turn it on", () => {
		mocks.access = access({ timeTrackingEnabled: false });
		renderRoute(LayoutRoute);
		expect(
			screen.getByText("Time tracking is off for this team."),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open settings" })).toBeTruthy();
		expect(screen.queryByRole("navigation", { name: "Team time" })).toBeNull();
		expect(screen.queryByTestId("outlet")).toBeNull();
	});

	it("gives a member who opens a money page the refusal card and a way into Time", () => {
		mocks.access = access({ isApprover: false, isTeamMember: true });
		mocks.pathname = `/w/acme/teams/${TEAM}/time/payouts`;
		renderRoute(LayoutRoute);
		expect(
			screen.getByText("You don't have access to this team's time and pay."),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open in Time" }).getAttribute("href"),
		).toBe(`/time?for=team%3A${TEAM}`);
		expect(
			screen.getByRole("link", { name: "Back to team" }).getAttribute("href"),
		).toBe(`/w/acme/teams/${TEAM}`);
		expect(screen.queryByTestId("outlet")).toBeNull();
	});

	it("gives someone with no standing the refusal card (ux.md: never an empty page)", () => {
		mocks.access = access({
			team: undefined,
			isApprover: false,
			isTeamMember: false,
			error: Object.assign(new Error("Forbidden"), {
				response: { status: 403 },
			}),
		});
		renderRoute(LayoutRoute);
		expect(
			screen.getByText("You don't have access to this team's time and pay."),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Open in Time" })).toBeNull();
		expect(screen.queryByTestId("outlet")).toBeNull();
	});

	it("says a load failed and retries it", async () => {
		const refetch = vi.spyOn(client, "refetchQueries").mockResolvedValue();
		mocks.access = access({
			team: undefined,
			isApprover: false,
			error: new TimeApiError({
				status: 500,
				code: "TIME_INTERNAL",
				message: "Proyekto couldn't load this. Try again.",
			}),
		});
		renderRoute(LayoutRoute);
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Try again");
		fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
		await waitFor(() =>
			expect(refetch).toHaveBeenCalledWith({
				queryKey: ["team", TEAM],
				type: "active",
			}),
		);
	});

	it("shows a loading status while the team resolves", () => {
		mocks.access = access({ isLoading: true, team: undefined });
		renderRoute(LayoutRoute);
		expect(screen.getByRole("status").textContent).toContain("Loading");
	});
});

describe("Team › Time layout in the app (native)", () => {
	beforeEach(() => {
		mocks.native = true;
	});

	it("shows the Report alone: Rates and Payouts are web-only (L54)", () => {
		renderRoute(LayoutRoute);
		expect(subNavLabels()).toEqual(["Report"]);
		nativeSweep();
	});

	it("keeps the refusal and time-off cards free of money words", () => {
		mocks.access = access({ isApprover: false });
		renderRoute(LayoutRoute);
		expect(
			screen.getByText("You don't have access to this team's time."),
		).toBeTruthy();
		nativeSweep();
		cleanup();

		mocks.access = access({ timeTrackingEnabled: false });
		renderRoute(LayoutRoute);
		expect(
			screen.getByText("Time tracking is off for this team."),
		).toBeTruthy();
		nativeSweep();
	});
});

describe("Team › Time › Report (index)", () => {
	it("mounts the team report in the team's timezone once the policy answers", async () => {
		renderRoute(IndexRoute);
		await screen.findByTestId("time-report");
		const props = mocks.reportProps as TimeReportProps;
		expect(props.scope).toEqual({ kind: "team", id: TEAM });
		expect(props.timezone).toBe("Asia/Manila");
		expect(props.weekStart).toBe(1);
		expect(props.planWorkspace).toEqual({
			id: "ws-1",
			name: "Acme",
			slug: "acme",
			my_role: "owner",
		});
		// Pay cut-offs are range presets where the team records payments.
		expect(props.cutoffs).toEqual({ config: null });
		expect(timeService.getTeamPolicy).toHaveBeenCalledWith(TEAM);
	});

	it("offers no pay cut-offs when payouts are off", async () => {
		mocks.access = access({ canPay: false });
		renderRoute(IndexRoute);
		await screen.findByTestId("time-report");
		expect(mocks.reportProps?.cutoffs).toBeNull();
	});

	it("still renders, in the device's timezone, when the policy can't be read", async () => {
		vi.mocked(timeService.getTeamPolicy).mockRejectedValue(
			new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
		);
		renderRoute(IndexRoute);
		await screen.findByTestId("time-report");
		expect(mocks.reportProps?.timezone).toBeNull();
	});

	it("merges filter changes into the URL, replacing history", async () => {
		renderRoute(IndexRoute);
		await screen.findByTestId("time-report");
		act(() => mocks.reportProps?.onSearchChange({ person: PERSON }));
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
		const call = mocks.navigate.mock.calls[0][0] as {
			search: (prev: object) => object;
			replace: boolean;
		};
		expect(call.replace).toBe(true);
		expect(call.search({ group: "week" })).toEqual({
			group: "week",
			person: PERSON,
		});
	});

	it("opens an entry over the report, read-only, and closes it", async () => {
		renderRoute(IndexRoute);
		await screen.findByTestId("time-report");
		act(() => mocks.reportProps?.onOpenEntry?.({ id: ENTRY } as TimeEntryView));
		expect(screen.getByRole("dialog", { name: "Entry" }).textContent).toBe(
			ENTRY,
		);
		expect(mocks.modalProps?.mode).toBe("readonly");
		expect(mocks.modalProps?.timeZone).toBe("Asia/Manila");
		act(() => mocks.modalProps?.onClose());
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});
});

describe("Finance › team › Time", () => {
	it("renders the same team report behind the approver gate, from the Report's URL", async () => {
		renderRoute(FinanceRoute);
		expect(screen.getByTestId("finance-time-logs")).toBeTruthy();
		expect(screen.getByTestId("gate-approver")).toBeTruthy();
		await screen.findByTestId("time-report");
		const props = mocks.reportProps as TimeReportProps;
		expect(props.scope).toEqual({ kind: "team", id: TEAM });
		expect(props.search).toEqual({ person: PERSON });
		expect(props.timezone).toBe("Asia/Manila");
	});

	it("reads the Report's search params (old period params drop, an old log is kept)", () => {
		const validate = FinanceRoute.options.validateSearch as (
			raw: Record<string, unknown>,
		) => unknown;
		expect(
			validate({
				person: PERSON,
				from: "2026-09-01",
				to: "2026-09-15",
				preset: "custom",
				cutoff_month: "2026-09",
				log: ENTRY,
			}),
		).toEqual({
			person: PERSON,
			from: "2026-09-01",
			to: "2026-09-15",
			log: ENTRY,
		});
		expect(validate({ log: "not-an-id" })).toEqual({});
	});

	it("keeps an old Team Logs ?member= link filtered to that person", () => {
		const validate = FinanceRoute.options.validateSearch as (
			raw: Record<string, unknown>,
		) => unknown;
		expect(validate({ member: PERSON })).toEqual({ person: PERSON });
		// `person` wins when both are there; a junk member drops.
		const OTHER = "66666666-6666-4666-8666-666666666666";
		expect(validate({ person: PERSON, member: OTHER })).toEqual({
			person: PERSON,
		});
		expect(validate({ member: "someone" })).toEqual({});
	});

	it("opens an old ?log= entry over the Report, and closing drops the param", async () => {
		vi.spyOn(FinanceRoute, "useSearch").mockReturnValue({
			person: PERSON,
			log: ENTRY,
		} as never);
		renderRoute(FinanceRoute);
		await screen.findByTestId("time-report");
		// The Report never sees the legacy param.
		expect((mocks.reportProps as TimeReportProps).search).toEqual({
			person: PERSON,
		});
		expect(screen.getByRole("dialog", { name: "Entry" }).textContent).toBe(
			ENTRY,
		);
		expect(mocks.modalProps?.mode).toBe("readonly");
		act(() => mocks.modalProps?.onClose());
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
		const call = mocks.navigate.mock.calls[0][0] as {
			search: (prev: Record<string, unknown>) => Record<string, unknown>;
			replace?: boolean;
		};
		expect(call.replace).toBe(true);
		expect(call.search({ person: PERSON, log: ENTRY })).toEqual({
			person: PERSON,
		});
	});
});
