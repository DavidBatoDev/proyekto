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

const mocks = vi.hoisted(() => ({
	profile: null as Record<string, unknown> | null,
	pathname: "/w/acme/dashboard",
	update: vi.fn(),
	setProfile: vi.fn(),
}));

vi.mock("@/hooks/useProfileQuery", () => ({
	useProfileQuery: () => ({ data: mocks.profile }),
}));
vi.mock("@tanstack/react-router", () => ({
	useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
		select({ location: { pathname: mocks.pathname } }),
}));
vi.mock("@/lib/guestAuth", () => ({ isGuestSession: () => false }));
vi.mock("@/queries/profile", () => ({
	profileKeys: { byUser: (id: string) => ["profile", id] },
	updateProfileData: (...args: unknown[]) => mocks.update(...args),
}));
vi.mock("@/stores/authStore", () => {
	const state = {
		isAuthenticated: true,
		user: { id: "user-1" },
		setProfile: (p: unknown) => mocks.setProfile(p),
	};
	const useAuthStore = (select: (s: typeof state) => unknown) => select(state);
	useAuthStore.getState = () => state;
	return { useAuthStore };
});

import { DisplayNameGate } from "./DisplayNameGate";

function renderGate() {
	const client = new QueryClient();
	return render(
		<QueryClientProvider client={client}>
			<DisplayNameGate />
		</QueryClientProvider>,
	);
}

describe("DisplayNameGate", () => {
	beforeEach(() => {
		mocks.update.mockReset();
		mocks.setProfile.mockReset();
		mocks.pathname = "/w/acme/dashboard";
	});
	afterEach(cleanup);

	it("asks an existing account with no name, prefilled from first/last name, and saves it", async () => {
		mocks.profile = {
			display_name: null,
			first_name: "Jamie",
			last_name: "Cruz",
		};
		mocks.update.mockResolvedValue({ display_name: "Jamie Cruz" });
		renderGate();
		const input = screen.getByLabelText("Display name") as HTMLInputElement;
		expect(input.value).toBe("Jamie Cruz");
		// No way out but naming yourself.
		expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith("user-1", {
				display_name: "Jamie Cruz",
			}),
		);
		expect(mocks.setProfile).toHaveBeenCalledWith({
			display_name: "Jamie Cruz",
		});
	});

	it("refuses an email address as a name", async () => {
		mocks.profile = { display_name: "" };
		renderGate();
		fireEvent.change(screen.getByLabelText("Display name"), {
			target: { value: "jamie@example.com" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("shows nothing for a named person or on the sign-in pages", () => {
		mocks.profile = { display_name: "Jamie" };
		renderGate();
		expect(screen.queryByLabelText("Display name")).toBeNull();
		cleanup();
		mocks.profile = { display_name: null };
		mocks.pathname = "/auth/callback";
		renderGate();
		expect(screen.queryByLabelText("Display name")).toBeNull();
	});
});
