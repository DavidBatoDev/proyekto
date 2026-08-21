/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardHeader from "./DashboardHeader";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		hash,
	}: {
		children?: ReactNode;
		to: string;
		hash?: string;
	}) => <a href={hash ? `${to}#${hash}` : to}>{children}</a>,
}));

vi.mock("@/components/brand/BrandMark", () => ({
	BrandMark: () => <span>Proyekto</span>,
}));

vi.mock("@/stores/authStore", () => ({
	useAuthStore: () => ({ isAuthenticated: true, profile: { id: "u1" } }),
	useIsLoading: () => false,
}));

vi.mock("@/ui/button", () => ({
	Button: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("./MobileNavDrawer", () => ({
	MobileNavDrawer: () => <div />,
}));

vi.mock("./NotificationBell", () => ({
	NotificationBell: () => <div />,
}));

vi.mock("./UserMenu", () => ({
	default: () => <span>User menu</span>,
}));

afterEach(cleanup);

describe("DashboardHeader navigation", () => {
	it("links to both halves of the product, marketplace first", () => {
		// The header is the only nav that spans both halves of the product. The
		// marketplace's public pages render no sidebar at all, so losing this
		// entry would leave them reachable only by typing the URL.
		render(<DashboardHeader />);

		const href = (name: string) =>
			screen.getByRole("link", { name }).getAttribute("href");

		expect(href("Marketplace")).toBe("/marketplace");
		expect(href("Execution")).toBe("/dashboard");

		// Order matters: the marketplace reads first in the header.
		const labels = screen
			.getAllByRole("link")
			.map((link) => link.textContent)
			.filter((label) => label === "Marketplace" || label === "Execution");
		expect(labels).toEqual(["Marketplace", "Execution"]);
	});
});
