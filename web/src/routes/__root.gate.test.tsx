/* @vitest-environment jsdom */

import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	redirect,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeDestinationFor } from "@/lib/platformSurfaces";

const mocks = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));

import { isNativeApp } from "@/lib/platform";

/**
 * The root gate's adapter, verified against a real router.
 *
 * `nativeDestinationFor` is covered exhaustively in platformSurfaces.test.ts;
 * what cannot be proven there is that `throw redirect({ href })` actually
 * moves a router — the one line the whole gate hangs on. The tree is a stub on
 * purpose: mounting the real __root pulls in half the app.
 */
const rootRoute = createRootRoute({
	beforeLoad: ({ location }) => {
		if (!isNativeApp()) return;
		const to = nativeDestinationFor(location.pathname);
		if (to) throw redirect({ href: to, replace: true });
	},
});

const page = (path: string, text: string) =>
	createRoute({
		getParentRoute: () => rootRoute,
		path,
		component: () => <div>{text}</div>,
	});

const routeTree = rootRoute.addChildren([
	page("/dashboard", "dashboard"),
	page("/pricing", "pricing page"),
	page("/marketplace", "marketplace page"),
	page("/home", "marketing landing"),
	page("/inbox", "inbox"),
	page("/not-available", "not available"),
]);

async function visit(path: string) {
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	render(<RouterProvider router={router} />);
	await waitFor(() => expect(router.state.status).toBe("idle"));
	return router;
}

afterEach(() => {
	mocks.native = false;
	vi.clearAllMocks();
});

describe("the root gate, against a real router", () => {
	it("leaves every path alone in a browser", async () => {
		for (const path of ["/pricing", "/marketplace", "/home"]) {
			const router = await visit(path);
			expect(router.state.location.pathname, path).toBe(path);
		}
		expect(await screen.findByText("marketing landing")).toBeTruthy();
	});

	it("explains a commerce surface in the app", async () => {
		mocks.native = true;
		const router = await visit("/pricing");

		expect(router.state.location.pathname).toBe("/not-available");
		expect(router.state.location.searchStr).toContain("surface=commerce");
		expect(await screen.findByText("not available")).toBeTruthy();
	});

	it("explains a marketplace surface in the app", async () => {
		mocks.native = true;
		const router = await visit("/marketplace");

		expect(router.state.location.pathname).toBe("/not-available");
		expect(router.state.location.searchStr).toContain("surface=marketplace");
	});

	it("sends the marketing landing home without a detour", async () => {
		mocks.native = true;
		const router = await visit("/home");

		expect(router.state.location.pathname).toBe("/dashboard");
	});

	it("does not touch the SaaS surfaces in the app", async () => {
		mocks.native = true;
		const router = await visit("/inbox");

		expect(router.state.location.pathname).toBe("/inbox");
		expect(await screen.findByText("inbox")).toBeTruthy();
	});
});
