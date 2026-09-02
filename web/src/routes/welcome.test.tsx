/* @vitest-environment jsdom */

/**
 * The workspace step is REQUIRED and sits in front of every new user, over a
 * server-guaranteed invariant (onboarding completion provisions a default
 * workspace). What matters here is less the happy path than the ways it could
 * go wrong: advancing with no name, a revisit that creates a second workspace
 * instead of renaming the existing one, or the create fallback firing twice.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspaceStore";

// Each case walks several animated slides before it can assert anything, which
// runs comfortably under a second alone but exceeds the 5s default when the
// suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

const {
	listMyWorkspaces,
	createWorkspace,
	updateWorkspace,
	createWorkspaceInvite,
	navigate,
	toastError,
} = vi.hoisted(() => ({
	listMyWorkspaces: vi.fn(),
	createWorkspace: vi.fn(),
	updateWorkspace: vi.fn(),
	createWorkspaceInvite: vi.fn(),
	navigate: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/services/workspaces.service", () => ({
	listMyWorkspaces,
	createWorkspace,
	updateWorkspace,
	createWorkspaceInvite,
}));

// Partial mock: createFileRoute pulls in real router internals
// (lazyRouteComponent et al.), so only navigation is replaced.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	useNavigate: () => navigate,
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: vi.fn(), error: toastError, info: vi.fn() }),
}));

// Transitive imports (guestAuth, profile queries) reach for the real axios
// client and Supabase client at module load — keep both inert.
vi.mock("@/api", () => ({
	apiClient: { patch: vi.fn(), post: vi.fn(), get: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
	supabase: {
		auth: {
			getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
		},
	},
}));

vi.mock("@/lib/auth-api", () => ({ completeOnboarding: vi.fn() }));

vi.mock("@/stores/authStore", () => ({
	useAuthStore: Object.assign(
		(selector: (s: unknown) => unknown) =>
			selector({ user: { id: "user-1" }, profile: null }),
		{ getState: () => ({ isAuthenticated: true, isLoading: false }) },
	),
}));

const OWNED_WORKSPACE = {
	id: "ws-1",
	name: "Ada's Workspace",
	description: null,
	avatar_url: null,
	created_by: "user-1",
	created_at: "2026-01-02T00:00:00Z",
	updated_at: "2026-01-02T00:00:00Z",
	my_role: "owner" as const,
	slug: "owned-workspace",
	previous_slugs: [],
};

// Older than the owned one — the prefill must skip it anyway.
const MEMBER_WORKSPACE = {
	...OWNED_WORKSPACE,
	id: "ws-other",
	name: "Someone Else's Org",
	created_at: "2026-01-01T00:00:00Z",
	my_role: "member" as const,
	slug: "member-workspace",
	previous_slugs: [],
};

import { ClientTalentWelcomeDeck } from "./welcome";

function renderDeck() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ClientTalentWelcomeDeck firstName="Ada" />
		</QueryClientProvider>,
	);
}

function workspaceNameInput(): HTMLInputElement {
	return screen.getByLabelText(/workspace name/i) as HTMLInputElement;
}

async function clickNext() {
	fireEvent.click(await screen.findByRole("button", { name: /^next$/i }));
}

/**
 * Walk to a target slide. Each click is awaited because AnimatePresence swaps
 * slides asynchronously, and the theme slide is flag-gated so the slide count
 * isn't fixed.
 */
async function advanceUntil(marker: RegExp) {
	for (let i = 0; i < 5; i++) {
		try {
			await screen.findByText(marker, {}, { timeout: 400 });
			return;
		} catch {
			await clickNext();
		}
	}
	throw new Error(`never reached the slide matching ${marker}`);
}

async function advanceToWorkspaceSlide() {
	fireEvent.click(await screen.findByRole("button", { name: /get started/i }));
	await advanceUntil(/create your workspace/i);
}

async function advanceToInviteSlide() {
	await advanceUntil(/invite people to your workspace/i);
}

async function goBackToWorkspaceSlide() {
	for (let i = 0; i < 5; i++) {
		try {
			await screen.findByText(/create your workspace/i, {}, { timeout: 400 });
			return;
		} catch {
			fireEvent.click(await screen.findByRole("button", { name: /^back$/i }));
		}
	}
	throw new Error("never got back to the workspace slide");
}

beforeEach(() => {
	listMyWorkspaces.mockResolvedValue([]);
	createWorkspace.mockResolvedValue({
		...OWNED_WORKSPACE,
		id: "ws-new",
		name: "Acme Inc.",
	});
	updateWorkspace.mockResolvedValue(OWNED_WORKSPACE);
	createWorkspaceInvite.mockResolvedValue({ id: "invite-1" });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	useWorkspaceStore.getState().clear();
	window.localStorage.clear();
});

describe("welcome deck — workspace step", () => {
	it("blocks Next until the workspace has a name", async () => {
		renderDeck();
		await advanceToWorkspaceSlide();
		const next = screen.getByRole("button", { name: /next/i });
		expect((next as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(workspaceNameInput(), {
			target: { value: "Analytical Engines Ltd" },
		});
		expect(
			(screen.getByRole("button", { name: /next/i }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	it("prefills from the owned workspace on re-entry and updates instead of creating", async () => {
		listMyWorkspaces.mockResolvedValue([MEMBER_WORKSPACE, OWNED_WORKSPACE]);
		renderDeck();
		await advanceToWorkspaceSlide();

		await waitFor(() =>
			expect(workspaceNameInput().value).toBe("Ada's Workspace"),
		);

		fireEvent.change(workspaceNameInput(), {
			target: { value: "Analytical Engines Ltd" },
		});
		fireEvent.click(screen.getByRole("button", { name: /next/i }));

		await waitFor(() => expect(updateWorkspace).toHaveBeenCalledTimes(1));
		expect(updateWorkspace).toHaveBeenCalledWith("ws-1", {
			name: "Analytical Engines Ltd",
		});
		expect(createWorkspace).not.toHaveBeenCalled();
	});

	it("creates the workspace once when none is owned, then updates on a later edit", async () => {
		renderDeck();
		await advanceToWorkspaceSlide();

		fireEvent.change(workspaceNameInput(), {
			target: { value: "Acme Inc." },
		});
		fireEvent.click(screen.getByRole("button", { name: /next/i }));

		await waitFor(() => expect(createWorkspace).toHaveBeenCalledTimes(1));
		expect(createWorkspace).toHaveBeenCalledWith({ name: "Acme Inc." });
		await advanceToInviteSlide();

		// Coming back and editing must PATCH the workspace just created — a
		// second POST here would mean a duplicate org.
		await goBackToWorkspaceSlide();
		fireEvent.change(workspaceNameInput(), {
			target: { value: "Acme Corp" },
		});
		fireEvent.click(screen.getByRole("button", { name: /next/i }));

		await waitFor(() =>
			expect(updateWorkspace).toHaveBeenCalledWith("ws-new", {
				name: "Acme Corp",
			}),
		);
		expect(createWorkspace).toHaveBeenCalledTimes(1);
	});

	it("stays on the slide when the save fails, and retries on a second Next", async () => {
		createWorkspace.mockRejectedValue(new Error("network down"));
		renderDeck();
		await advanceToWorkspaceSlide();
		fireEvent.change(workspaceNameInput(), {
			target: { value: "Acme Inc." },
		});

		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
		// Still here — not advanced past the workspace slide.
		expect(screen.getByText(/create your workspace/i)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		await waitFor(() => expect(createWorkspace).toHaveBeenCalledTimes(2));
	});

	it("offers a skip when the workspace lookup itself failed", async () => {
		listMyWorkspaces.mockRejectedValue(new Error("lookup exploded"));
		renderDeck();
		await advanceToWorkspaceSlide();

		const skip = await screen.findByRole("button", { name: /skip for now/i });
		fireEvent.click(skip);

		await advanceToInviteSlide();
		expect(createWorkspace).not.toHaveBeenCalled();
		expect(updateWorkspace).not.toHaveBeenCalled();
	});
});

describe("welcome deck — invite step", () => {
	it("sends workspace invites, defaulting to the member role", async () => {
		listMyWorkspaces.mockResolvedValue([OWNED_WORKSPACE]);
		renderDeck();
		await advanceToWorkspaceSlide();
		await waitFor(() =>
			expect(workspaceNameInput().value).toBe("Ada's Workspace"),
		);
		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		await advanceToInviteSlide();

		fireEvent.change(screen.getByPlaceholderText(/teammate@company.com/i), {
			target: { value: "grace@example.com" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /send 1 invite & finish/i }),
		);

		await waitFor(() => expect(createWorkspaceInvite).toHaveBeenCalledTimes(1));
		expect(createWorkspaceInvite).toHaveBeenCalledWith("ws-1", {
			email: "grace@example.com",
			role: "member",
		});
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/w/$workspaceSlug/dashboard",
				params: { workspaceSlug: "owned-workspace" },
			}),
		);
	});
});

describe("welcome deck — finish routing", () => {
	it("routes to the guest-roadmap conversion route when one is pending", async () => {
		window.localStorage.setItem(
			"proyekto_pending_project_from_roadmap",
			JSON.stringify({
				roadmapId: "rm-1",
				createdAt: new Date().toISOString(),
				source: "roadmap_cta",
			}),
		);
		listMyWorkspaces.mockResolvedValue([OWNED_WORKSPACE]);
		renderDeck();
		await advanceToWorkspaceSlide();
		await waitFor(() =>
			expect(workspaceNameInput().value).toBe("Ada's Workspace"),
		);
		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		await advanceToInviteSlide();

		fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/project/roadmap/convert/$roadmapId",
				params: { roadmapId: "rm-1" },
			}),
		);
		// The convert route clears the pending key after a successful migration;
		// the deck must not clear it pre-emptively.
		expect(
			window.localStorage.getItem("proyekto_pending_project_from_roadmap"),
		).not.toBeNull();
	});
});
