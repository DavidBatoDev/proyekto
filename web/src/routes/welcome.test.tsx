/* @vitest-environment jsdom */

/**
 * The welcome deck had no test at all, and this change puts a REQUIRED step in
 * front of every new user. What matters here is less the happy path than the
 * ways it could strand someone: a failed save, a revisit that silently creates
 * a second team, or a personal team getting renamed by the deck.
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

// Each case walks five animated slides before it can assert anything, which
// runs comfortably under a second alone but exceeds the 5s default when the
// suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

const { createTeam, listMyTeams, updateTeam, navigate, toastError } =
	vi.hoisted(() => ({
		createTeam: vi.fn(),
		listMyTeams: vi.fn(),
		updateTeam: vi.fn(),
		navigate: vi.fn(),
		toastError: vi.fn(),
	}));

vi.mock("@/services/teams.service", () => ({
	createTeam,
	listMyTeams,
	updateTeam,
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

vi.mock("@/api", () => ({
	apiClient: { patch: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn() },
}));

vi.mock("@/lib/auth-api", () => ({ completeOnboarding: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: () =>
						Promise.resolve({
							data: { project: { id: "ws-1", title: "My workspace" } },
							error: null,
						}),
				}),
			}),
		}),
	},
}));

vi.mock("@/stores/authStore", () => ({
	useAuthStore: Object.assign(
		(selector: (s: unknown) => unknown) =>
			selector({ user: { id: "user-1" }, profile: null }),
		{ getState: () => ({ isAuthenticated: true, isLoading: false }) },
	),
}));

const TEAM = {
	id: "team-1",
	owner_id: "user-1",
	name: "Engineering Squad",
	description: "Builds things",
	tags: ["design"],
	is_personal: false,
	created_at: "2026-01-01T00:00:00Z",
};

import { ClientFreelancerWelcomeDeck } from "./welcome";

function renderDeck() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ClientFreelancerWelcomeDeck firstName="Ada" />
		</QueryClientProvider>,
	);
}

/**
 * Walk from slide 1 to the team slide. Each click is awaited because
 * AnimatePresence swaps slides asynchronously.
 */
async function clickNext() {
	fireEvent.click(await screen.findByRole("button", { name: /^next$/i }));
}

async function advanceToTeamSlide() {
	fireEvent.click(await screen.findByRole("button", { name: /get started/i }));
	// Click through however many slides precede the team step — the theme slide
	// is flag-gated, so the count isn't fixed.
	for (let i = 0; i < 5; i++) {
		try {
			await screen.findByText(/create your team/i, {}, { timeout: 400 });
			return;
		} catch {
			await clickNext();
		}
	}
	throw new Error("never reached the team slide");
}

beforeEach(() => {
	listMyTeams.mockResolvedValue([]);
	createTeam.mockResolvedValue({ ...TEAM, tags: [] });
	updateTeam.mockResolvedValue(TEAM);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("welcome deck — team step", () => {
	it("blocks Next until the team has a name", async () => {
		renderDeck();
		await advanceToTeamSlide();
		const next = screen.getByRole("button", { name: /next/i });
		expect((next as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByPlaceholderText(/engineering squad/i), {
			target: { value: "Analytical Engines" },
		});
		expect(
			(screen.getByRole("button", { name: /next/i }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	it("creates the team once and advances to the invite step", async () => {
		renderDeck();
		await advanceToTeamSlide();
		fireEvent.change(screen.getByPlaceholderText(/engineering squad/i), {
			target: { value: "Analytical Engines" },
		});
		fireEvent.click(screen.getByRole("button", { name: /next/i }));

		await waitFor(() => expect(createTeam).toHaveBeenCalledTimes(1));
		expect(createTeam).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Analytical Engines" }),
		);
		await screen.findByText(/invite people to your workspace/i);
	});

	it("stays on the slide when the save fails, and retries on a second Next", async () => {
		createTeam.mockRejectedValue(new Error("network down"));
		renderDeck();
		await advanceToTeamSlide();
		fireEvent.change(screen.getByPlaceholderText(/engineering squad/i), {
			target: { value: "Analytical Engines" },
		});

		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
		// Still here — not advanced to the invite slide.
		expect(screen.getByText(/create your team/i)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /next/i }));
		await waitFor(() => expect(createTeam).toHaveBeenCalledTimes(2));
	});

	it("prefills from an owned team on re-entry and updates instead of creating", async () => {
		listMyTeams.mockResolvedValue([TEAM]);
		renderDeck();
		await advanceToTeamSlide();

		await waitFor(() =>
			expect(
				(screen.getByPlaceholderText(/engineering squad/i) as HTMLInputElement)
					.value,
			).toBe("Engineering Squad"),
		);

		fireEvent.change(screen.getByPlaceholderText(/engineering squad/i), {
			target: { value: "Renamed Squad" },
		});
		fireEvent.click(screen.getByRole("button", { name: /next/i }));

		await waitFor(() => expect(updateTeam).toHaveBeenCalledTimes(1));
		expect(createTeam).not.toHaveBeenCalled();
	});

	/**
	 * The personal team belongs to consultant vetting. If the deck prefilled
	 * from it, continuing would rename it — so it must be ignored entirely.
	 */
	it("ignores a personal team and creates a new non-personal one", async () => {
		listMyTeams.mockResolvedValue([{ ...TEAM, is_personal: true }]);
		renderDeck();
		await advanceToTeamSlide();

		const input = screen.getByPlaceholderText(
			/engineering squad/i,
		) as HTMLInputElement;
		expect(input.value).toBe("");

		fireEvent.change(input, { target: { value: "Fresh Team" } });
		fireEvent.click(screen.getByRole("button", { name: /next/i }));

		await waitFor(() => expect(createTeam).toHaveBeenCalledTimes(1));
		expect(updateTeam).not.toHaveBeenCalled();
	});

	it("offers a skip when the team lookup itself failed", async () => {
		listMyTeams.mockRejectedValue(new Error("lookup exploded"));
		renderDeck();
		await advanceToTeamSlide();

		const skip = await screen.findByRole("button", { name: /skip for now/i });
		fireEvent.click(skip);

		await screen.findByText(/invite people to your workspace/i);
		expect(createTeam).not.toHaveBeenCalled();
		expect(updateTeam).not.toHaveBeenCalled();
	});
});
