/* @vitest-environment jsdom */

import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/services/workspaces.service";

const { listMyWorkspaces, getTeam } = vi.hoisted(() => ({
	listMyWorkspaces: vi.fn(),
	getTeam: vi.fn(),
}));

vi.mock("@/services/workspaces.service", () => ({ listMyWorkspaces }));
vi.mock("@/services/teams.service", () => ({ getTeam }));
vi.mock("@/stores/authStore", () => {
	const state = { isAuthenticated: true, user: { id: "user-1" } };
	return {
		useAuthStore: Object.assign(() => state, { getState: () => state }),
		useUser: () => state.user,
	};
});
// The dashboard stub's fallback component pulls in the whole shell; the
// guard is what these tests exercise.
vi.mock("@/components/layout/DashboardShell", () => ({
	DashboardShell: () => null,
}));
vi.mock("@/components/workspace/CreateWorkspaceCard", () => ({
	CreateWorkspaceCard: () => null,
}));

import { useWorkspaceStore } from "@/stores/workspaceStore";
import { Route as DashboardStub } from "./dashboard";
import { Route as TeamStub } from "./teams/$teamId";
import { Route as TeamsStub } from "./teams/index";

type RedirectOptions = {
	to?: string;
	params?: unknown;
	search?: unknown;
	replace?: boolean;
};

type BeforeLoad = (args: {
	params: Record<string, string>;
	context: { queryClient: QueryClient };
	location: { href: string; pathname: string };
}) => Promise<unknown>;

function workspace(id: string, slug: string, my_role: Workspace["my_role"]) {
	return {
		id,
		slug,
		my_role,
		previous_slugs: [],
		name: slug,
		description: null,
		avatar_url: null,
		created_by: null,
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: "2026-09-01T00:00:00.000Z",
	} satisfies Workspace;
}

const ACME = workspace("ws-acme", "acme", "owner");
const GLOBEX = workspace("ws-globex", "globex", "member");

async function redirectFrom(
	promise: Promise<unknown>,
): Promise<RedirectOptions> {
	try {
		await promise;
	} catch (err) {
		if (isRedirect(err)) return (err as { options: RedirectOptions }).options;
		throw err;
	}
	throw new Error("expected a redirect");
}

function guard(route: { options: { beforeLoad?: unknown } }): BeforeLoad {
	return route.options.beforeLoad as BeforeLoad;
}

function call(
	route: { options: { beforeLoad?: unknown } },
	pathname: string,
	params = {},
) {
	return guard(route)({
		params,
		context: { queryClient: new QueryClient() },
		location: { href: pathname, pathname },
	});
}

beforeEach(() => {
	window.localStorage.clear();
	useWorkspaceStore.getState().clear();
	listMyWorkspaces.mockReset().mockResolvedValue([GLOBEX, ACME]);
	getTeam.mockReset();
});

describe("bare /dashboard", () => {
	it("forwards to the last-visited workspace, carrying the search string", async () => {
		window.localStorage.setItem(
			"proyekto_current_workspace:user-1",
			"ws-globex",
		);
		const options = await redirectFrom(call(DashboardStub, "/dashboard"));
		expect(options).toMatchObject({
			to: "/w/$workspaceSlug/dashboard",
			params: { workspaceSlug: "globex" },
			search: true,
			replace: true,
		});
	});

	it("falls back to the owned workspace when nothing is stored", async () => {
		const options = await redirectFrom(call(DashboardStub, "/dashboard"));
		expect(options.params).toEqual({ workspaceSlug: "acme" });
	});

	/** The only place a zero-workspace account can land: it renders, not loops. */
	it("renders the fallback instead of redirecting when there is no workspace", async () => {
		listMyWorkspaces.mockResolvedValue([]);
		await expect(call(DashboardStub, "/dashboard")).resolves.toBeUndefined();
	});
});

describe("bare /teams", () => {
	it("forwards to the workspace team list", async () => {
		const options = await redirectFrom(call(TeamsStub, "/teams"));
		expect(options).toMatchObject({
			to: "/w/$workspaceSlug/teams",
			params: { workspaceSlug: "acme" },
		});
	});
});

describe("bare /teams/$teamId/…", () => {
	/**
	 * A push link to a team's time logs must open in THAT team's workspace,
	 * not whichever one this device visited last.
	 */
	it("prefers the team's own workspace and keeps the rest of the path", async () => {
		window.localStorage.setItem("proyekto_current_workspace:user-1", "ws-acme");
		getTeam.mockResolvedValue({ id: "t1", workspace_id: "ws-globex" });
		const options = await redirectFrom(
			call(TeamStub, "/teams/t1/time/team-logs", { teamId: "t1" }),
		);
		expect(options.to).toBe("/w/globex/teams/t1/time/team-logs");
		expect(options.search).toBe(true);
	});

	it("falls back to the last-visited workspace when the team cannot be read", async () => {
		window.localStorage.setItem("proyekto_current_workspace:user-1", "ws-acme");
		getTeam.mockRejectedValue(new Error("403"));
		const options = await redirectFrom(
			call(TeamStub, "/teams/t1/settings/projects", { teamId: "t1" }),
		);
		expect(options.to).toBe("/w/acme/teams/t1/settings/projects");
	});
});
