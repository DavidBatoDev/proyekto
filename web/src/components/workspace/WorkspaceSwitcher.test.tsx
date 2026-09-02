/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/services/workspaces.service";

const { navigate, resetQueries, setCurrentWorkspace, mutateAsync } = vi.hoisted(
	() => ({
		navigate: vi.fn(),
		resetQueries: vi.fn().mockResolvedValue(undefined),
		setCurrentWorkspace: vi.fn(),
		mutateAsync: vi.fn(),
	}),
);

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ resetQueries }),
}));

vi.mock("@/stores/authStore", () => ({
	useUser: () => ({ id: "user-1" }),
}));

vi.mock("@/stores/workspaceStore", () => ({
	useWorkspaceStore: (selector: (s: unknown) => unknown) =>
		selector({ setCurrentWorkspace }),
}));

const acme: Workspace = {
	id: "ws-acme",
	name: "Acme",
	description: null,
	avatar_url: null,
	created_by: "user-1",
	created_at: "2026-09-01T00:00:00.000Z",
	updated_at: "2026-09-01T00:00:00.000Z",
	my_role: "owner",
	slug: "acme",
	previous_slugs: [],
};
const globex: Workspace = {
	...acme,
	id: "ws-globex",
	name: "Globex",
	slug: "globex",
};

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: acme,
		workspaces: [acme, globex],
		isLoading: false,
	}),
	useCreateWorkspaceMutation: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("./WorkspaceInviteDialog", () => ({
	WorkspaceInviteDialog: () => null,
}));

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

describe("WorkspaceSwitcher", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		cleanup();
	});

	/**
	 * Switching is a navigation, not just a selection: wherever you were, you
	 * land on /w/<slug>/dashboard of the workspace you entered. The cache is
	 * RESET rather than invalidated so the dashboard shows its skeletons
	 * instead of the previous workspace's rows while the new data loads.
	 */
	it("selecting another workspace switches, resets the dashboard cache, and goes to its dashboard", () => {
		render(<WorkspaceSwitcher />);
		fireEvent.click(screen.getByRole("button", { name: /Acme/ }));
		fireEvent.click(screen.getByRole("menuitem", { name: /Globex/ }));

		expect(setCurrentWorkspace).toHaveBeenCalledWith("ws-globex", "user-1");
		expect(resetQueries).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
		expect(resetQueries).toHaveBeenCalledWith({
			queryKey: ["teams", "mine"],
		});
		expect(resetQueries).not.toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ["workspaces"] }),
		);
		expect(navigate).toHaveBeenCalledWith({
			to: "/w/$workspaceSlug/dashboard",
			params: { workspaceSlug: "globex" },
		});
	});

	it("creating a workspace from the switcher enters it the same way", async () => {
		mutateAsync.mockResolvedValue({
			...acme,
			id: "ws-new",
			name: "Initech",
			slug: "initech",
		});
		render(<WorkspaceSwitcher />);
		fireEvent.click(screen.getByRole("button", { name: /Acme/ }));
		fireEvent.click(screen.getByRole("menuitem", { name: /Create workspace/ }));
		fireEvent.change(screen.getByPlaceholderText("Workspace name"), {
			target: { value: "Initech" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await vi.waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/w/$workspaceSlug/dashboard",
				params: { workspaceSlug: "initech" },
			}),
		);
		expect(mutateAsync).toHaveBeenCalledWith({ name: "Initech" });
		expect(setCurrentWorkspace).toHaveBeenCalledWith("ws-new", "user-1");
	});
});
