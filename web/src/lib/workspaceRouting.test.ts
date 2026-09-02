/* @vitest-environment jsdom */

import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/services/workspaces.service";

const { listMyWorkspaces, authState } = vi.hoisted(() => ({
	listMyWorkspaces: vi.fn(),
	authState: {
		isAuthenticated: true,
		user: { id: "user-1" } as { id: string } | null,
	},
}));

vi.mock("@/services/workspaces.service", () => ({ listMyWorkspaces }));

vi.mock("@/stores/authStore", () => ({
	useAuthStore: Object.assign(() => authState, { getState: () => authState }),
}));

import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
	pickDefaultWorkspace,
	resolveLastVisitedWorkspace,
	resolveWorkspaceSlug,
} from "./workspaceRouting";

function workspace(
	id: string,
	slug: string,
	extra: Partial<Workspace> = {},
): Workspace {
	return {
		id,
		slug,
		previous_slugs: [],
		name: slug,
		description: null,
		avatar_url: null,
		created_by: null,
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: "2026-09-01T00:00:00.000Z",
		my_role: "member",
		...extra,
	};
}

const ACME = workspace("ws-acme", "acme", {
	my_role: "owner",
	previous_slugs: ["acme-old"],
});
const GLOBEX = workspace("ws-globex", "globex");

describe("resolveWorkspaceSlug", () => {
	it("finds a live slug", () => {
		expect(resolveWorkspaceSlug([ACME, GLOBEX], "globex").current).toBe(GLOBEX);
	});

	it("reports a retired slug's current workspace", () => {
		const result = resolveWorkspaceSlug([ACME, GLOBEX], "acme-old");
		expect(result.current).toBeNull();
		expect(result.renamedTo).toBe(ACME);
	});

	/** Not a member (or nobody's) reads the same: not found. */
	it("finds nothing for a slug outside the membership list", () => {
		expect(resolveWorkspaceSlug([ACME], "initech")).toEqual({
			current: null,
			renamedTo: null,
		});
	});
});

describe("pickDefaultWorkspace", () => {
	it("prefers an owned workspace in list order, then the first", () => {
		expect(pickDefaultWorkspace([GLOBEX, ACME])).toBe(ACME);
		expect(pickDefaultWorkspace([GLOBEX])).toBe(GLOBEX);
		expect(pickDefaultWorkspace([])).toBeNull();
	});
});

describe("resolveLastVisitedWorkspace", () => {
	beforeEach(() => {
		window.localStorage.clear();
		useWorkspaceStore.getState().clear();
		listMyWorkspaces.mockReset().mockResolvedValue([GLOBEX, ACME]);
		authState.isAuthenticated = true;
		authState.user = { id: "user-1" };
	});

	it("returns the stored selection when it is still a membership", async () => {
		window.localStorage.setItem(
			"proyekto_current_workspace:user-1",
			"ws-globex",
		);
		const result = await resolveLastVisitedWorkspace(new QueryClient(), {
			href: "/dashboard",
		});
		expect(result).toBe(GLOBEX);
		// Hydrated as a side effect, so the reconciler later finds nothing to do.
		expect(useWorkspaceStore.getState().hydratedForUserId).toBe("user-1");
	});

	it("falls back to the default when nothing is stored or it is stale", async () => {
		window.localStorage.setItem("proyekto_current_workspace:user-1", "ws-gone");
		const result = await resolveLastVisitedWorkspace(new QueryClient(), {
			href: "/dashboard",
		});
		expect(result).toBe(ACME);
	});

	it("redirects to login when unauthenticated, keeping the destination", async () => {
		authState.isAuthenticated = false;
		authState.user = null;
		await expect(
			resolveLastVisitedWorkspace(new QueryClient(), {
				href: "/teams/t1/time/my-logs",
			}),
		).rejects.toSatisfy((err: unknown) => isRedirect(err));
		expect(listMyWorkspaces).not.toHaveBeenCalled();
	});
});
