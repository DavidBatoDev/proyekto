/* @vitest-environment jsdom */

// Native copy rules for Project › Time and Project settings › Time (ux.md ›
// Mobile; web blueprint §4): `/project` is an app surface, so these pages
// render in the installed app. Never the words contract, rate, payout or
// invoice; no amounts on agreement time; no `/engagements` links; and the
// money pages (team Payouts and Rates) are never linked.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
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
			...rest
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
			"aria-label"?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className} aria-label={rest["aria-label"]}>
					{children}
				</a>
			);
		},
	};
});
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: () => ({
		status: "ready",
		usage: null,
		plan: "business",
		upgradePlan: null,
		isComplimentary: false,
		hasFeature: () => true,
	}),
}));
vi.mock("@/components/team-time/RateBudgetCalculator", () => ({
	RateBudgetCalculator: () => <div data-testid="rate-calculator" />,
}));
const state = vi.hoisted(() => ({
	perms: {} as Record<string, unknown>,
	rates: [] as Record<string, unknown>[],
}));
vi.mock("@/hooks/useProjectQueries", () => ({
	useProjectMyPermissionsQuery: () => ({
		data: state.perms,
		isPending: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
	}),
	useProjectDetailQuery: () => ({
		data: { id: "p", title: "Acme Website", workspace_id: "ws1" },
		isPending: false,
	}),
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({
		data: [{ id: "ws1", name: "Acme", slug: "acme", my_role: "owner" }],
	}),
}));
vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: () => ({
		isApprover: true,
		canPay: true,
		hasRates: true,
		planWorkspace: { slug: "acme" },
		team: { id: "t1", name: "Design" },
	}),
}));
vi.mock("@/stores/authStore", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/stores/authStore")>()),
	useUser: () => ({ id: "me" }),
}));
vi.mock("@/services/teams.service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/services/teams.service")>()),
	listProjectTeams: () =>
		Promise.resolve([
			{ team_id: "t1", team: { id: "t1", name: "Design", avatar_url: null } },
		]),
	listMyTeams: () => Promise.resolve([{ id: "t1", name: "Design" }]),
	listTeamMembers: () =>
		Promise.resolve([
			{
				id: "m1",
				user_id: "u1",
				position: null,
				user: { display_name: "Leo" },
			},
		]),
	listCuratedMembers: () => Promise.resolve([{ user_id: "u1" }]),
	getTeam: (id: string) =>
		Promise.resolve({ id, name: "Design", member_rates_enabled: true }),
	listMemberRates: () => Promise.resolve(state.rates),
	updateMemberRate: vi.fn(),
}));
vi.mock("@/services/engagement.service", () => ({
	engagementService: {
		list: () =>
			Promise.resolve([
				{
					id: ENGAGEMENT_ID,
					kind: "client_services",
					status: "active",
					viewer_position: "hirer",
					counterparty: {
						display_name_snapshot: "Ana",
						team_name_snapshot: "Pixel Studio",
					},
					project_links: [{ project_id: PROJECT_ID, status: "active" }],
					current_settings: { client_hours_detail_level: "summary" },
				},
			]),
	},
}));

import {
	ENGAGEMENT_ID,
	entry,
	maskedAgreementEntry,
	NOW,
	PROJECT_ID,
	summary,
} from "@/components/time/report/__fixtures__/reportFixtures";
import { updateMemberRate } from "@/services/teams.service";
import { timeService } from "@/services/time.service";
import type { ReportQuery, TimeEntryView } from "@/services/time.types";
import { ProjectTimePage } from "./ProjectTimePage";
import { ProjectTimeSettings } from "./ProjectTimeSettings";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?|invoicing)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(options: { amounts: boolean }) {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	if (!options.amounts) expect(text).not.toMatch(AMOUNT);
	for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
		for (const el of Array.from(document.body.querySelectorAll(`[${attr}]`))) {
			expect(el.getAttribute(attr) ?? "", attr).not.toMatch(BANNED);
		}
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
	expect(document.body.querySelector('a[href*="/payouts"]')).toBeNull();
	expect(document.body.querySelector('a[href*="/manage-rates"]')).toBeNull();
}

function withClient(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

/** Agreement time a provider-side viewer may cost. */
function namedAgreementEntry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return entry({
		id: "ag",
		context_kind: "assignment",
		context_ref: "as1",
		context_label_snapshot: "Acme Corp",
		payable_seconds: 7200,
		duration_seconds: 7200,
		cost: "visible",
		rate_snapshot: 25,
		currency_snapshot: "USD",
		amount_snapshot: 50,
		...over,
	});
}

function page(view?: "everyone" | "client") {
	return (
		<ProjectTimePage
			projectId={PROJECT_ID}
			search={view ? { view } : {}}
			onSearchChange={vi.fn()}
			onRedirectMine={vi.fn()}
			now={NOW}
		/>
	);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	state.rates = [];
	state.perms = {
		access: { time: true },
		time: { log: true, view_team_logs: true },
		time_client_hours_level: "summary",
	};
	vi.spyOn(timeService, "getReportSummary").mockResolvedValue(
		summary({ scope: { kind: "project", id: PROJECT_ID } }),
	);
	vi.spyOn(timeService, "getReportEntries").mockImplementation(
		async (q: ReportQuery) => {
			const items = [
				namedAgreementEntry(),
				maskedAgreementEntry({ id: "mk", context_ref: "as2" }),
			];
			return q.limit === 1
				? { items: items.slice(0, 1), total: 2, page: 1, limit: 1 }
				: { items, total: items.length, page: 1, limit: 200 };
		},
	);
	vi.spyOn(timeService, "getProjectLoggers").mockResolvedValue({
		people: [
			{
				user_id: "u-leo",
				display_name: "Leo Cruz",
				role: "editor",
				reason: "agreement",
				label: "agreement with Pixel Studio",
				options: 2,
			},
		],
	});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	for (const fn of Object.values(toast)) fn.mockReset();
});

describe("Project › Time on native", () => {
	it("Everyone: agreement time shows no amount, and no money links", async () => {
		withClient(page());
		expect(
			await screen.findByRole("region", { name: "Acme Corp · agreement" }),
		).toBeTruthy();
		await waitFor(() =>
			expect(document.body.textContent).toContain("Delivery team"),
		);
		expect(screen.queryByRole("link", { name: /Payouts|Rates/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
		assertNativeSafe({ amounts: false });
	});

	it("Client hours: weeks per agreement, no names, no amounts", async () => {
		withClient(page("client"));
		expect(
			await screen.findByRole("region", { name: "Pixel Studio · agreement" }),
		).toBeTruthy();
		expect(document.body.textContent).not.toContain("Ana");
		assertNativeSafe({ amounts: false });
	});

	it("the link card for someone who only logs here", () => {
		state.perms = {
			access: { time: true },
			time: { log: true, view_team_logs: false },
		};
		withClient(page("everyone"));
		expect(
			screen.getByText("Your time on this project lives in Time."),
		).toBeTruthy();
		assertNativeSafe({ amounts: false });
	});
});

describe("Project settings › Time on native", () => {
	it("keeps every section free of money words, terms links and the calculator", async () => {
		withClient(<ProjectTimeSettings projectId={PROJECT_ID} />);
		const who = await screen.findByRole("region", {
			name: "Who can log time here",
		});
		await waitFor(() =>
			expect(who.textContent).toContain(
				"Leo Cruz(agreement with Pixel Studio · or 1 other choice)",
			),
		);
		const sees = screen.getByRole("region", { name: "Client sees" });
		await waitFor(() => expect(sees.textContent).toContain("Pixel Studio"));
		expect(sees.textContent).toContain("Hours by week");
		expect(sees.textContent).not.toContain("· agreement");
		expect(screen.queryByRole("link", { name: /View terms/ })).toBeNull();
		expect(
			await screen.findByText("Set up hour limits for this person on the web."),
		).toBeTruthy();
		expect(screen.queryByTestId("rate-calculator")).toBeNull();
		assertNativeSafe({ amounts: false });
	});

	it("toasts an hour-limit save failure without naming rates", async () => {
		// The team service rejects with "Failed to update rate" (or the 403
		// "Member rates are disabled…"); the app says something else.
		state.rates = [
			{
				id: "r1",
				end_date: null,
				weekly_limit_hours: null,
				monthly_limit_hours: null,
				overtime_requires_approval: false,
			},
		];
		vi.mocked(updateMemberRate).mockRejectedValue(
			new Error("Failed to update rate"),
		);
		withClient(<ProjectTimeSettings projectId={PROJECT_ID} />);
		fireEvent.change(await screen.findByLabelText("Weekly hours: Leo"), {
			target: { value: "20" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save: Leo" }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Proyekto couldn't save these hour limits. Try again.",
			),
		);
		expect(toast.error.mock.calls.flat().join(" ")).not.toMatch(BANNED);
	});
});
