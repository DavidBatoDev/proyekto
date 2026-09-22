/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN_LIMITS } from "@/lib/planLimits";
import type { AdminWorkspaceRow } from "@/services/admin.service";
import { AdminWorkspacesPage } from "./AdminWorkspacesPage";

const mocks = vi.hoisted(() => ({
	getMe: vi.fn(),
	listWorkspaces: vi.fn(),
	getWorkspace: vi.fn(),
	setWorkspaceComp: vi.fn(),
	clearWorkspaceComp: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/services/admin.service", () => ({
	adminService: {
		getMe: mocks.getMe,
		listWorkspaces: mocks.listWorkspaces,
		getWorkspace: mocks.getWorkspace,
		setWorkspaceComp: mocks.setWorkspaceComp,
		clearWorkspaceComp: mocks.clearWorkspaceComp,
	},
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

vi.mock("@/hooks/usePlanLimits", () => ({
	usePublicPlanLimits: () => ({
		limits: DEFAULT_PLAN_LIMITS,
		isLive: false,
		version: null,
	}),
}));

const freeRow: AdminWorkspaceRow = {
	id: "ws-1",
	name: "Acme",
	slug: "acme",
	created_at: "2026-01-01T00:00:00Z",
	owner: { id: "u-1", email: "owner@acme.test" },
	members: 12,
	pending_invites: 2,
	projects: 3,
	teams: 1,
	subscription: {
		plan: "free",
		status: null,
		has_provider_subscription: false,
	},
	complimentary: null,
	effective_plan: "free",
	plan_source: "default",
	over_limit: ["members", "projects"],
};

const compedRow: AdminWorkspaceRow = {
	id: "ws-2",
	name: "Globex",
	slug: "globex",
	created_at: "2026-02-01T00:00:00Z",
	owner: { id: "u-2", email: "owner@globex.test" },
	members: 30,
	pending_invites: 0,
	projects: 14,
	teams: 5,
	subscription: {
		plan: "pro",
		status: "active",
		has_provider_subscription: true,
	},
	complimentary: {
		plan: "business",
		since: "2026-09-01T00:00:00Z",
		until: null,
		active: true,
	},
	effective_plan: "business",
	plan_source: "complimentary",
	over_limit: [],
};

function renderPage(accessLevel: string) {
	mocks.getMe.mockResolvedValue({ id: "a-1", access_level: accessLevel });
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<AdminWorkspacesPage />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.listWorkspaces.mockImplementation(async () => ({
		items: [freeRow, compedRow],
		page: 1,
		page_size: 25,
		total: 2,
	}));
	mocks.getWorkspace.mockResolvedValue({
		...freeRow,
		largest_roadmaps: [],
		audit: [],
	});
	mocks.clearWorkspaceComp.mockResolvedValue({ workspace: compedRow });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const rowFor = (name: string) =>
	screen.getByText(name).closest("tr") as HTMLElement;

describe("AdminWorkspacesPage", () => {
	it("lists plans, comps and over-limit counts", async () => {
		renderPage("super_admin");
		await screen.findByText("Acme");
		expect(mocks.listWorkspaces).toHaveBeenCalledWith({
			search: undefined,
			filter: "all",
			page: 1,
			page_size: 25,
		});

		const acme = rowFor("Acme");
		expect(within(acme).getByText("owner@acme.test")).toBeTruthy();
		expect(within(acme).getByText("+2 invited")).toBeTruthy();
		const members = within(acme).getByText("12");
		expect(members.getAttribute("data-over-limit")).toBe("true");
		expect(members.className).toContain("text-destructive");
		expect(within(acme).getByText("1").getAttribute("data-over-limit")).toBe(
			null,
		);

		const globex = rowFor("Globex");
		expect(within(globex).getByText("Business")).toBeTruthy();
		expect(within(globex).getByText("Complimentary")).toBeTruthy();
		expect(within(globex).getByText("billing: Pro")).toBeTruthy();
		expect(
			within(globex).getByRole("button", { name: "Edit comp" }),
		).toBeTruthy();
		expect(
			within(acme).getByRole("button", { name: "Comp plan…" }),
		).toBeTruthy();
	});

	it("hides comp actions from admins below super admin", async () => {
		renderPage("support");
		await screen.findByText("Acme");
		// The profile query may land after the list; wait for it to settle.
		await waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Comp plan…" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Remove comp" })).toBeNull();
		expect(screen.queryByText("Actions")).toBeNull();
	});

	it("debounces the search and filters by pill", async () => {
		renderPage("super_admin");
		await screen.findByText("Acme");
		mocks.listWorkspaces.mockClear();

		fireEvent.change(screen.getByLabelText("Search workspaces"), {
			target: { value: "globex" },
		});
		expect(mocks.listWorkspaces).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(mocks.listWorkspaces).toHaveBeenCalledWith({
				search: "globex",
				filter: "all",
				page: 1,
				page_size: 25,
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: "Complimentary" }));
		await waitFor(() =>
			expect(mocks.listWorkspaces).toHaveBeenCalledWith({
				search: "globex",
				filter: "comped",
				page: 1,
				page_size: 25,
			}),
		);
	});

	it("confirms before removing a comp and says what it falls back to", async () => {
		renderPage("super_admin");
		await screen.findByText("Globex");
		fireEvent.click(
			await within(rowFor("Globex")).findByRole("button", {
				name: "Remove comp",
			}),
		);

		const dialog = await screen.findByRole("dialog", {
			name: "Remove Globex's complimentary plan?",
		});
		expect(
			within(dialog).getByText(
				"Falls back to Pro. Nothing is deleted; anything over its limits stays but can't grow.",
			),
		).toBeTruthy();
		expect(mocks.clearWorkspaceComp).not.toHaveBeenCalled();

		fireEvent.change(within(dialog).getByLabelText("Note (optional)"), {
			target: { value: "Partnership ended" },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove comp" }),
		);

		await waitFor(() =>
			expect(mocks.clearWorkspaceComp).toHaveBeenCalledWith(
				"ws-2",
				"Partnership ended",
			),
		);
		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith(
				"Removed Globex's complimentary plan.",
			),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("cancelling the remove confirm changes nothing", async () => {
		renderPage("super_admin");
		await screen.findByText("Globex");
		fireEvent.click(
			await within(rowFor("Globex")).findByRole("button", {
				name: "Remove comp",
			}),
		);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(mocks.clearWorkspaceComp).not.toHaveBeenCalled();
	});

	it("opens the comp dialog for a workspace without one", async () => {
		renderPage("super_admin");
		await screen.findByText("Acme");
		fireEvent.click(
			await within(rowFor("Acme")).findByRole("button", {
				name: "Comp plan…",
			}),
		);
		expect(
			await screen.findByRole("dialog", { name: "Comp a plan" }),
		).toBeTruthy();
	});
});
