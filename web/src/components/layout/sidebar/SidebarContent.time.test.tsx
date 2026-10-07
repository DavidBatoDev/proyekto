/* @vitest-environment jsdom */

// ux.md › Chrome: Time is per workspace. The primary Time item shows when
// the person has time, approvals or the time policy in the open workspace
// (or personal time in their default one), and its badge counts only what
// waits there. A team's own Time item is the Report, so
// only that team's owners and admins see it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({
	location: {
		pathname: "/w/acme/dashboard",
		search: {} as Record<string, unknown>,
	},
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useRouterState: (options?: { select?: (state: unknown) => unknown }) =>
			options?.select ? options.select(routerState) : routerState,
		Link: ({
			children,
			to,
			search,
			params: _params,
			...rest
		}: {
			children?: ReactNode;
			to: string;
			search?: Record<string, string>;
			params?: unknown;
		} & Record<string, unknown>) => {
			const query = new URLSearchParams(search ?? {}).toString();
			return (
				<a href={query ? `${to}?${query}` : to} {...rest}>
					{children}
				</a>
			);
		},
	};
});
vi.mock("@/components/workspace/WorkspaceSwitcher", () => ({
	WorkspaceSwitcher: () => null,
}));
vi.mock("@/components/workspace/WorkspaceInviteDialog", () => ({
	WorkspaceInviteDialog: () => null,
}));
vi.mock("@/hooks/useDashboardProjectsQuery", () => ({
	useDashboardProjectsQuery: () => ({ data: [], isPending: false }),
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: { id: "w1", slug: "acme", my_role: "member" },
		workspaces: [{ id: "w1", slug: "acme" }],
		isLoading: false,
	}),
}));

const teams = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/services/teams.service", () => ({
	listMyTeams: () => Promise.resolve(teams.list),
	updateWorkspaceDefaults: () => Promise.resolve(),
}));

import type { Team } from "@/services/teams.service";
import { timeService } from "@/services/time.service";
import type { TimeOverview } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";
import { SidebarContent } from "./SidebarContent";
import { isTeamTimeManager, TeamSidebarGroup } from "./TeamSidebarGroup";

const USER = "viewer";
const clients: QueryClient[] = [];

function overview(over: Partial<TimeOverview> = {}): TimeOverview {
	return {
		can_log: false,
		approver_mode: false,
		contexts: [],
		approvals_waiting: 0,
		workspace_time_admin: [],
		...over,
	};
}

function team(over: Partial<Team> = {}): Team {
	return {
		id: "t1",
		owner_id: "someone-else",
		workspace_id: "w1",
		name: "Northwind Studio",
		description: null,
		avatar_url: null,
		is_personal: false,
		time_tracking_enabled: true,
		member_rates_enabled: false,
		payouts_enabled: false,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		viewer_role: "member",
		...over,
	};
}

function withClient(node: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>{node}</QueryClientProvider>,
	);
}

beforeEach(() => {
	teams.list = [];
	routerState.location = { pathname: "/w/acme/dashboard", search: {} };
	useAuthStore.setState({ user: { id: USER } as User, profile: null });
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("SidebarContent › Time", () => {
	it("shows Time to someone who logs personal time in their default workspace", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({
				can_log: true,
				contexts: [
					{ kind: "personal", id: null, label: "Just me", sheet_scope: null },
				],
			} as Partial<TimeOverview>),
		);

		withClient(<SidebarContent />);

		const link = await screen.findByRole("link", { name: "Time" });
		expect(link.getAttribute("href")).toBe("/time");
		expect(screen.queryByTestId("sidebar-nav-badge")).toBeNull();
		// The personal group (Inbox, Meetings) comes first, above the
		// workspace switcher; the workspace's pages, Time last, follow.
		const labels = screen
			.getAllByRole("link")
			.map((el) => el.textContent)
			.filter((text) =>
				["Dashboard", "Inbox", "Command center", "Meetings", "Time"].includes(
					text ?? "",
				),
			);
		expect(labels).toEqual([
			"Inbox",
			"Meetings",
			"Dashboard",
			"Command center",
			"Time",
		]);
		const personal = screen.getByTestId("sidebar-personal-nav");
		expect(personal.textContent).toContain("Meetings");
		expect(personal.textContent).not.toContain("Time");
	});

	it("badges Time with the timesheets waiting in this workspace only", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({ approvals_waiting: 4 }),
		);
		const waiting = (id: string, ws: string) => ({
			id,
			policy_workspace_id: ws,
			policy_workspace: { id: ws, name: ws },
		});
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [
				waiting("a", "w1"),
				waiting("b", "w1"),
				waiting("c", "w1"),
				waiting("d", "w2"),
			],
			total: 4,
			page: 1,
			limit: 50,
		} as never);

		withClient(<SidebarContent />);

		const badge = await screen.findByTestId("sidebar-nav-badge");
		expect(badge.textContent).toContain("3");
		expect(badge.textContent).toContain("3 timesheets waiting");
		expect(badge.closest("a")?.getAttribute("href")).toBe("/time");
	});

	it("shows Time to a workspace's time admin who neither logs nor approves", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({
				workspace_time_admin: [
					{
						workspace_id: "w1",
						name: "Acme",
						slug: "acme",
						has_time_tracking: true,
						policy_unconfirmed: true,
					},
				],
			}),
		);

		withClient(<SidebarContent />);

		expect(await screen.findByRole("link", { name: "Time" })).toBeTruthy();
	});

	it("hides Time where the person has nothing, even with time elsewhere", async () => {
		teams.list = [team({ id: "t9", workspace_id: "w2" })];
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({
				can_log: false,
				contexts: [
					{ kind: "workspace", id: "w2", label: "Other", sheet_scope: null },
					{ kind: "team", id: "t9", label: "Team", sheet_scope: null },
				],
			} as Partial<TimeOverview>),
		);

		withClient(<SidebarContent />);

		await screen.findByRole("link", { name: "Meetings" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(screen.queryByRole("link", { name: "Time" })).toBeNull();
	});

	it("hides Time from everyone else, and while the overview loads", async () => {
		const getOverview = vi
			.spyOn(timeService, "getOverview")
			.mockResolvedValue(overview());

		withClient(<SidebarContent />);

		expect(screen.queryByRole("link", { name: "Time" })).toBeNull();
		await waitFor(() => expect(getOverview).toHaveBeenCalled());
		await screen.findByRole("link", { name: "Meetings" });
		expect(screen.queryByRole("link", { name: "Time" })).toBeNull();
	});
});

describe("TeamSidebarGroup › Time", () => {
	function renderGroup(t: Team) {
		return withClient(
			<TeamSidebarGroup
				team={t}
				isExpanded
				onToggle={() => {}}
				currentPath="/teams/t1"
				workspaceSlug="acme"
			/>,
		);
	}

	it("links a team manager to the team's Report", () => {
		renderGroup(team({ viewer_role: "admin" }));
		expect(
			screen.getByRole("link", { name: "Time" }).getAttribute("href"),
		).toBe("/w/acme/teams/t1/time");
	});

	it("shows members no team Time item", () => {
		renderGroup(team({ viewer_role: "member" }));
		expect(screen.queryByRole("link", { name: "Time" })).toBeNull();
		expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
	});

	it("shows nobody a Time item while the team's time is off", () => {
		renderGroup(team({ owner_id: USER, time_tracking_enabled: false }));
		expect(screen.queryByRole("link", { name: "Time" })).toBeNull();
	});

	it("treats the owner, owners and admins as managers", () => {
		expect(isTeamTimeManager(team({ owner_id: USER }), USER)).toBe(true);
		expect(isTeamTimeManager(team({ viewer_role: "owner" }), USER)).toBe(true);
		expect(isTeamTimeManager(team({ viewer_role: "admin" }), USER)).toBe(true);
		expect(isTeamTimeManager(team({ viewer_role: "member" }), USER)).toBe(
			false,
		);
		expect(isTeamTimeManager(team({ viewer_role: null }), USER)).toBe(false);
		expect(isTeamTimeManager(team({ owner_id: USER }), null)).toBe(false);
	});
});
