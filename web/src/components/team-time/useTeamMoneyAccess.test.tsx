/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Team, TeamMember } from "@/services/teams.service";

const mocks = vi.hoisted(() => ({
	user: { id: "user-1" } as { id: string } | null,
	team: null as unknown as Team,
	members: [] as TeamMember[],
	features: new Set<string>(),
	status: "ready" as "ready" | "loading" | "unavailable",
	entitlementsFor: vi.fn(),
	hasAnyActiveRate: vi.fn(),
}));

vi.mock("@/stores/authStore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/stores/authStore")>();
	return { ...actual, useUser: () => mocks.user };
});
vi.mock("@/services/teams.service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/services/teams.service")>();
	return {
		...actual,
		getTeam: async () => mocks.team,
		listTeamMembers: async () => mocks.members,
		hasAnyActiveRate: mocks.hasAnyActiveRate,
	};
});
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({
		data: [
			{
				id: "ws-1",
				name: "Acme",
				slug: "acme",
				my_role: "owner",
				previous_slugs: [],
				description: null,
				avatar_url: null,
				created_by: null,
				created_at: "",
				updated_at: "",
			},
		],
	}),
}));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (workspaceId?: string | null) => {
		mocks.entitlementsFor(workspaceId);
		const ready = mocks.status === "ready" && Boolean(workspaceId);
		return {
			status: workspaceId ? mocks.status : "unavailable",
			usage: ready ? { workspace_id: workspaceId, features: [] } : null,
			plan: ready ? "pro" : null,
			upgradePlan: "business",
			isComplimentary: false,
			hasFeature: (key: string) => mocks.features.has(key),
		};
	},
}));

import { useTeamMoneyAccess } from "./useTeamMoneyAccess";

function team(overrides: Partial<Team> = {}): Team {
	return {
		id: "team-1",
		owner_id: "owner-1",
		workspace_id: "ws-1",
		name: "Prodigitality Services Inc. Team",
		description: null,
		avatar_url: null,
		is_personal: false,
		time_tracking_enabled: true,
		member_rates_enabled: true,
		payouts_enabled: true,
		created_at: "",
		updated_at: "",
		...overrides,
	};
}

function member(role: TeamMember["role"], userId = "user-1"): TeamMember {
	return {
		id: `tm-${userId}`,
		team_id: "team-1",
		user_id: userId,
		role,
		position: null,
		joined_at: "",
	};
}

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	mocks.team = team();
	mocks.members = [member("admin")];
	mocks.features = new Set(["time_payouts", "time_team_rules"]);
	mocks.status = "ready";
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.user = { id: "user-1" };
});

describe("useTeamMoneyAccess", () => {
	it("reads the team's switches and the caller's standing", async () => {
		const { result } = renderHook(() => useTeamMoneyAccess("team-1"), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current).toMatchObject({
			isApprover: true,
			isTeamMember: true,
			timeTrackingEnabled: true,
			hasRates: true,
			canPay: true,
			planWorkspaceId: "ws-1",
			planStatus: "ready",
			payoutsPlanLimit: null,
			teamRulesPlanLimit: null,
		});
		expect(result.current.planWorkspace?.slug).toBe("acme");
		expect(mocks.entitlementsFor).toHaveBeenLastCalledWith("ws-1");
		// Logging no longer needs a rate, so nobody asks for one any more.
		expect(mocks.hasAnyActiveRate).not.toHaveBeenCalled();
	});

	it("counts the owner and owner/admin members as managers, nobody else", async () => {
		mocks.members = [member("member")];
		const { result } = renderHook(() => useTeamMoneyAccess("team-1"), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.isApprover).toBe(false);

		mocks.user = { id: "owner-1" };
		const owner = renderHook(() => useTeamMoneyAccess("team-1"), { wrapper });
		await waitFor(() => expect(owner.result.current.isLoading).toBe(false));
		expect(owner.result.current.isApprover).toBe(true);
		expect(owner.result.current.isTeamMember).toBe(false);
	});

	it("names the plan features the team's workspace lacks", async () => {
		mocks.features = new Set();
		const { result } = renderHook(() => useTeamMoneyAccess("team-1"), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.payoutsPlanLimit?.limitKey).toBe("time_payouts");
		expect(result.current.teamRulesPlanLimit?.limitKey).toBe("time_team_rules");
	});

	it("fails open while the plan is unknown", async () => {
		mocks.features = new Set();
		mocks.status = "loading";
		const { result } = renderHook(() => useTeamMoneyAccess("team-1"), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.planStatus).toBe("loading");
		expect(result.current.payoutsPlanLimit).toBeNull();
	});
});
