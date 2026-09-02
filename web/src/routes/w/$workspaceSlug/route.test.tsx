/* @vitest-environment jsdom */

import { QueryClient } from "@tanstack/react-query";

// The app client keeps data fresh for 30s; a stale list must still be
// re-read before a slug is declared missing or an account workspace-less.
const newClient = () =>
	new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

import { isNotFound, isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/services/workspaces.service";

const { listMyWorkspaces } = vi.hoisted(() => ({ listMyWorkspaces: vi.fn() }));

vi.mock("@/services/workspaces.service", () => ({ listMyWorkspaces }));
vi.mock("@/components/layout/NotFoundRoute", () => ({
	NotFoundRoute: () => null,
}));
vi.mock("@/stores/authStore", () => {
	const state = { isAuthenticated: true, user: { id: "user-1" } };
	return {
		useAuthStore: Object.assign(() => state, { getState: () => state }),
		useUser: () => state.user,
	};
});

import { Route } from "./route";

type BeforeLoad = (args: {
	params: { workspaceSlug: string };
	context: { queryClient: QueryClient };
	location: { href: string; pathname: string };
}) => Promise<{ workspace: Workspace }>;

const beforeLoad = Route.options.beforeLoad as unknown as BeforeLoad;

function workspace(
	id: string,
	slug: string,
	previous: string[] = [],
): Workspace {
	return {
		id,
		slug,
		previous_slugs: previous,
		name: slug,
		description: null,
		avatar_url: null,
		created_by: null,
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: "2026-09-01T00:00:00.000Z",
		my_role: "member",
	};
}

const ACME = workspace("ws-acme", "acme", ["acme-old"]);

function run(slug: string, pathname = `/w/${slug}/dashboard`) {
	return beforeLoad({
		params: { workspaceSlug: slug },
		context: { queryClient: newClient() },
		location: { href: pathname, pathname },
	});
}

type RedirectOptions = {
	to?: string;
	params?: unknown;
	search?: unknown;
	replace?: boolean;
};

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

describe("/w/$workspaceSlug beforeLoad", () => {
	beforeEach(() => {
		listMyWorkspaces.mockReset().mockResolvedValue([ACME]);
	});

	it("hands a live slug's workspace to the children", async () => {
		await expect(run("acme")).resolves.toEqual({ workspace: ACME });
	});

	/**
	 * A renamed workspace keeps its old links: the retired slug redirects to
	 * the current one with the rest of the path intact. No `to` means "this
	 * match's template", so only the param changes.
	 */
	it("redirects a retired slug to the current one, keeping the path", async () => {
		const options = await redirectFrom(run("acme-old", "/w/acme-old/teams/t1"));
		expect(options.to).toBeUndefined();
		const update = options.params as (prev: object) => object;
		expect(update({ workspaceSlug: "acme-old", teamId: "t1" })).toEqual({
			workspaceSlug: "acme",
			teamId: "t1",
		});
		expect(options.search).toBe(true);
		expect(options.replace).toBe(true);
	});

	/**
	 * Non-member and nonexistent read the same — not found — so the URL cannot
	 * be used to enumerate organizations. One forced refetch first, so a slug
	 * renamed in another tab is never a false 404.
	 */
	it("is not found for a slug outside the membership list, after one refetch", async () => {
		await expect(run("initech")).rejects.toSatisfy((err: unknown) =>
			isNotFound(err),
		);
		expect(listMyWorkspaces).toHaveBeenCalledTimes(2);
	});

	it("resolves a new workspace's slug over a fresh-but-stale cached list", async () => {
		const client = newClient();
		client.setQueryData(["workspaces", "mine", "user-1"], []);
		const GLOBEX = workspace("ws-globex", "globex");
		listMyWorkspaces.mockResolvedValue([ACME, GLOBEX]);
		await expect(
			beforeLoad({
				params: { workspaceSlug: "globex" },
				context: { queryClient: client },
				location: {
					href: "/w/globex/dashboard",
					pathname: "/w/globex/dashboard",
				},
			}),
		).resolves.toEqual({ workspace: GLOBEX });
		expect(listMyWorkspaces).toHaveBeenCalledTimes(1);
	});

	it("resolves a slug that only the refetch knows about", async () => {
		const GLOBEX = workspace("ws-globex", "globex");
		listMyWorkspaces
			.mockResolvedValueOnce([ACME])
			.mockResolvedValueOnce([ACME, GLOBEX]);
		await expect(run("globex")).resolves.toEqual({ workspace: GLOBEX });
	});

	it("sends the bare workspace root to its dashboard", async () => {
		const options = await redirectFrom(run("acme", "/w/acme"));
		expect(options.to).toBe("/w/$workspaceSlug/dashboard");
		expect(options.params).toEqual({ workspaceSlug: "acme" });
	});
});
