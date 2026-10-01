/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	FinanceHub,
	FinanceHubTeam,
} from "@/services/financeBooks.service";
import type { TeamFinanceProject } from "@/services/teamFinance.service";

const TEAM_ID = "dc583f8a-0000-4000-8000-000000000000";

const mocks = vi.hoisted(() => ({
	hub: vi.fn(),
	financeProjects: vi.fn(),
}));

vi.mock("@/services/financeBooks.service", () => ({
	financeBooksService: { hub: mocks.hub },
}));
vi.mock("@/services/teamFinance.service", () => ({
	teamFinanceService: { financeProjects: mocks.financeProjects },
}));
vi.mock("@/components/finance/FinanceShareDialog", () => ({
	FINANCE_ROLE_LABELS: { owner: "Owner", manager: "Manager" },
}));
// Router-bound chrome: the tab bar and trail need a router; the gate does not.
vi.mock("@/components/common/AppTabs", () => ({
	AppTabs: ({ items }: { items: Array<{ key: string }> }) => (
		<nav data-testid="tabs">{items.map((item) => item.key).join(",")}</nav>
	),
}));
vi.mock("@/components/finance/nav/FinanceTrail", () => ({
	FinanceTrail: () => null,
}));
vi.mock("@/components/finance/portfolio/FinanceFiltersBar", () => ({
	FinanceFiltersBar: () => null,
}));

import { TeamFinanceChrome } from "./TeamFinanceChrome";

function hubWith(team: Partial<FinanceHubTeam>): FinanceHub {
	return {
		personal: null,
		shared: [],
		teams: [
			{
				team_id: TEAM_ID,
				team_name: "Prodigitality Services Inc. Team",
				avatar_url: null,
				my_team_role: "admin",
				book: null,
				can_create: false,
				book_role: null,
				project_books: [],
				...team,
			},
		],
	} as unknown as FinanceHub;
}

const readable: TeamFinanceProject = {
	id: "project-1",
	title: "Readable project",
	status: "active",
	currency: "PHP",
	can_manage_invoices: true,
};

function renderChrome(section: "imports" | "time-logs" | "expenses") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<TeamFinanceChrome teamId={TEAM_ID} section={section}>
				<p>page body</p>
			</TeamFinanceChrome>
		</QueryClientProvider>,
	);
}

describe("TeamFinanceChrome access gate", () => {
	beforeEach(() => {
		mocks.hub.mockReset();
		mocks.financeProjects.mockReset();
	});
	afterEach(cleanup);

	it("refuses imports for a team admin with no finance-readable project, without mounting the page", async () => {
		mocks.hub.mockResolvedValue(hubWith({ my_team_role: "admin" }));
		mocks.financeProjects.mockResolvedValue([]);

		renderChrome("imports");

		expect(
			await screen.findByText(
				"You don't have finance access to any of this team's projects.",
			),
		).toBeTruthy();
		expect(screen.queryByText("page body")).toBeNull();
		expect(screen.getByTestId("tabs").textContent).toBe(
			"overview,time-logs,rates,payouts,members",
		);
	});

	it("mounts imports once a project's finance is readable, and draws its tab", async () => {
		mocks.hub.mockResolvedValue(hubWith({ my_team_role: "admin" }));
		mocks.financeProjects.mockResolvedValue([readable]);

		renderChrome("imports");

		expect(await screen.findByText("page body")).toBeTruthy();
		expect(screen.getByTestId("tabs").textContent).toContain("imports");
	});

	it("shows team-level tabs to that admin regardless of project finance", async () => {
		mocks.hub.mockResolvedValue(hubWith({ my_team_role: "admin" }));
		mocks.financeProjects.mockResolvedValue([]);

		renderChrome("time-logs");

		expect(await screen.findByText("page body")).toBeTruthy();
	});

	it("refuses expenses to a team admin without a finance role", async () => {
		mocks.hub.mockResolvedValue(hubWith({ my_team_role: "admin" }));
		mocks.financeProjects.mockResolvedValue([]);

		renderChrome("expenses");

		expect(
			await screen.findByText("You don't have access to this team's expenses."),
		).toBeTruthy();
		expect(screen.queryByText("page body")).toBeNull();
	});

	it("refuses a team the caller has no finance standing on", async () => {
		mocks.hub.mockResolvedValue({ personal: null, shared: [], teams: [] });

		renderChrome("time-logs");

		expect(
			await screen.findByText("You don't have finance access to this team."),
		).toBeTruthy();
		expect(mocks.financeProjects).not.toHaveBeenCalled();
	});

	it("says the project list failed instead of refusing when it errors", async () => {
		mocks.hub.mockResolvedValue(hubWith({ my_team_role: "admin" }));
		mocks.financeProjects.mockRejectedValue(
			Object.assign(new Error("Server exploded"), { status: 500 }),
		);

		renderChrome("imports");

		// A real failure is retried (twice, with backoff); a refusal never is.
		await waitFor(
			() => expect(screen.getByText("Couldn't load this")).toBeTruthy(),
			{ timeout: 8000 },
		);
		expect(screen.queryByText("page body")).toBeNull();
	}, 10000);
});
