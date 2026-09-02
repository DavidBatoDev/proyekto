import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
vi.mock("@/stores/authStore", () => ({
	useAuthStore: Object.assign(() => auth, { getState: () => auth }),
}));
// The landing sections are irrelevant to the guard and heavy to import.
vi.mock("@/components/root/PresentationContainer", () => ({
	PresentationContainer: () => null,
}));

import { Route } from "./index";

const beforeLoad = Route.options.beforeLoad as unknown as () => void;

describe("/ for a signed-in user", () => {
	it("forwards to the dashboard", () => {
		auth.isAuthenticated = true;
		expect(() => beforeLoad()).toThrow(
			expect.toSatisfy((err: unknown) => isRedirect(err)),
		);
	});

	it("shows the landing while auth is still loading, and to visitors", () => {
		auth.isAuthenticated = true;
		auth.isLoading = true;
		expect(() => beforeLoad()).not.toThrow();
		auth.isAuthenticated = false;
		auth.isLoading = false;
		expect(() => beforeLoad()).not.toThrow();
	});
});
