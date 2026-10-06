/* @vitest-environment jsdom */

import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { Clock } from "lucide-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarNavLink } from "./SidebarPrimitives";

afterEach(cleanup);

type LinkProps = ComponentProps<typeof SidebarNavLink>;

async function renderLink(props: Partial<LinkProps> = {}) {
	const rootRoute = createRootRoute({
		component: () => (
			<SidebarNavLink
				to="/time"
				icon={Clock}
				label="Time"
				active={false}
				{...props}
			/>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(<RouterProvider router={router} />);
	return screen.findByRole("link");
}

describe("SidebarNavLink badge", () => {
	it("renders no pill without a count", async () => {
		await renderLink();
		expect(screen.queryByTestId("sidebar-nav-badge")).toBeNull();
	});

	it("hides the pill at zero, null and nonsense", async () => {
		for (const badge of [0, null, -2, Number.NaN]) {
			cleanup();
			await renderLink({ badge });
			expect(
				screen.queryByTestId("sidebar-nav-badge"),
				String(badge),
			).toBeNull();
		}
	});

	it("shows the count and names it for screen readers", async () => {
		const link = await renderLink({
			badge: 3,
			badgeLabel: "3 timesheets waiting",
		});
		const pill = screen.getByTestId("sidebar-nav-badge");
		expect(pill.textContent).toBe("33 timesheets waiting");
		expect(link.textContent).toContain("Time");
		expect(pill.querySelector("[aria-hidden='true']")?.textContent).toBe("3");
	});

	it("caps a large count at 99+", async () => {
		await renderLink({ badge: 140 });
		const pill = screen.getByTestId("sidebar-nav-badge");
		expect(pill.querySelector("[aria-hidden='true']")?.textContent).toBe("99+");
		// The spoken value stays exact.
		expect(pill.querySelector(".sr-only")?.textContent).toBe("140");
	});

	it("inverts the pill on the solid active row", async () => {
		await renderLink({ badge: 2, active: true });
		expect(screen.getByTestId("sidebar-nav-badge").className).toContain(
			"bg-sidebar-primary-foreground",
		);
		cleanup();
		await renderLink({ badge: 2, active: false });
		expect(screen.getByTestId("sidebar-nav-badge").className).toContain(
			"bg-primary",
		);
	});
});
