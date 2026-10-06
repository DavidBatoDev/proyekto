/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import type {
	TeamMember,
	TeamMemberRate,
	TeamProjectAttachment,
} from "@/services/teams.service";

const mocks = vi.hoisted(() => ({
	native: false,
	access: null as unknown as TeamMoneyAccess,
	listTeamMembers: vi.fn(),
	listTeamProjects: vi.fn(),
	listMemberRates: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: () => mocks.access,
}));
vi.mock("@/services/teams.service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/services/teams.service")>();
	return {
		...actual,
		listTeamMembers: mocks.listTeamMembers,
		listTeamProjects: mocks.listTeamProjects,
		listMemberRates: mocks.listMemberRates,
	};
});

import { ratesPlanDetail, TeamRatesPanel } from "./TeamRatesPanel";

const member: TeamMember = {
	id: "tm-1",
	team_id: "team-1",
	user_id: "user-1",
	role: "member",
	position: null,
	joined_at: "",
	user: {
		id: "user-1",
		display_name: "Maria Santos",
		avatar_url: null,
		email: null,
		first_name: null,
		last_name: null,
	},
};

const rate: TeamMemberRate = {
	id: "rate-1",
	team_id: "team-1",
	user_id: "user-1",
	project_id: "p1",
	rate_type: "hourly",
	fixed_amount: null,
	fixed_period: "month",
	hourly_rate: 25,
	training_hourly_rate: 15,
	currency: "PHP",
	custom_id: null,
	start_date: "2026-09-01",
	end_date: null,
	weekly_limit_hours: null,
	monthly_limit_hours: null,
	overtime_requires_approval: false,
	created_at: "",
	updated_at: "",
};

const attachment = {
	project_id: "p1",
	team_id: "team-1",
	is_primary: true,
	attached_at: "",
	project: {
		id: "p1",
		title: "Acme Website",
		status: null,
		banner_url: null,
		owner_id: null,
		owner: null,
	},
} as TeamProjectAttachment;

function access(overrides: Partial<TeamMoneyAccess> = {}): TeamMoneyAccess {
	return {
		isLoading: false,
		error: null,
		team: undefined,
		isApprover: true,
		isTeamMember: true,
		timeTrackingEnabled: true,
		hasRates: true,
		canPay: true,
		planWorkspaceId: "ws-1",
		planWorkspace: null,
		isComplimentary: false,
		planStatus: "ready",
		payoutsPlanLimit: null,
		teamRulesPlanLimit: null,
		...overrides,
	};
}

function renderPanel(viewMemberTime?: (userId: string) => void) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<TeamRatesPanel
				teamId="team-1"
				links={viewMemberTime ? { viewMemberTime } : undefined}
			/>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.access = access();
	mocks.listTeamMembers.mockResolvedValue([member]);
	mocks.listTeamProjects.mockResolvedValue([attachment]);
	mocks.listMemberRates.mockResolvedValue([rate]);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.native = false;
});

describe("TeamRatesPanel", () => {
	it("prices the team's attached projects from the teams API", async () => {
		renderPanel();
		expect(await screen.findByText("Maria Santos")).toBeTruthy();
		expect(mocks.listTeamProjects).toHaveBeenCalledWith("team-1");
		await waitFor(() =>
			expect(mocks.listMemberRates).toHaveBeenCalledWith("team-1", "user-1"),
		);
		expect(await screen.findByText(/Acme Website/)).toBeTruthy();
	});

	it("opens the person's time through the host", async () => {
		const viewMemberTime = vi.fn();
		renderPanel(viewMemberTime);
		const view = await screen.findByRole("button", { name: /view time/i });
		fireEvent.click(view);
		expect(viewMemberTime).toHaveBeenCalledWith("user-1");
	});

	it("says why rates price nothing on a plan without team time rules", async () => {
		mocks.access = access({
			teamRulesPlanLimit: {
				limitKey: "time_team_rules",
				kind: "feature",
				label: "Team approvers and time rules",
				limit: null,
				used: null,
				plan: "pro",
				upgradePlan: "business",
				workspaceId: "ws-1",
				workspaceSlug: null,
				context: "enable",
				message: "",
			},
		});
		renderPanel();
		expect(
			await screen.findByText(
				"Team approvers and team time rules are part of Business.",
			),
		).toBeTruthy();
		expect(screen.getByText(ratesPlanDetail(null))).toBeTruthy();
		// The rate card stays editable.
		expect(await screen.findByText("Maria Santos")).toBeTruthy();
	});

	it("names the workspace in the plan detail", () => {
		expect(ratesPlanDetail("Acme")).toBe(
			"Saved rates are kept, and price approved time again when Acme is on Business.",
		);
	});
});
