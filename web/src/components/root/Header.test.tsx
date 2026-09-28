/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children?: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useLocation: () => ({ pathname: "/roadmap-templates" }),
	useNavigate: () => vi.fn(),
	// The mobile drawer watches the path so it closes on navigation.
	useRouterState: () => "/roadmap-templates",
}));

vi.mock("framer-motion", () => ({
	motion: {
		div: ({
			children,
			className,
		}: {
			children?: ReactNode;
			className?: string;
		}) => <div className={className}>{children}</div>,
		header: ({
			children,
			className,
		}: {
			children?: ReactNode;
			className?: string;
		}) => <header className={className}>{children}</header>,
	},
}));

vi.mock("@/components/brand/BrandMark", () => ({
	BrandMark: () => <span>Proyekto</span>,
}));

vi.mock("@/contexts/PresentationContext", () => ({
	usePresentationContext: () => ({ goToSection: vi.fn() }),
}));

vi.mock("@/stores/authStore", () => ({
	useAuthStore: () => ({ isAuthenticated: false }),
}));

vi.mock("@/ui/button", () => ({
	Button: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../auth/UserMenu", () => ({
	default: () => <span>User menu</span>,
}));

afterEach(cleanup);

describe("Header", () => {
	it("never becomes the landing deck's section navigation", () => {
		// This is what the assertion below has always been about: the header is
		// global, the deck's sections are not, and a header that scrolls the
		// page is wrong on every other route that mounts it. Links to real
		// pages are a different thing and are asserted separately.
		render(<Header />);

		expect(screen.queryByText("Use It Your Way")).toBeNull();
		expect(screen.queryByText("How It Works")).toBeNull();
		expect(screen.queryByText("Why Proyekto")).toBeNull();
		expect(screen.queryByText("Templates")).toBeNull();
		expect(screen.queryByText("Features")).toBeNull();
	});

	it("keeps the account actions", () => {
		render(<Header />);

		expect(screen.getByRole("link", { name: "Login" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Get Started" })).toBeTruthy();
	});

	it("links to the marketing pages", () => {
		render(<Header />);

		const nav = screen.getByRole("navigation", { name: "Marketing" });
		const hrefs = Array.from(nav.querySelectorAll("a")).map((a) =>
			a.getAttribute("href"),
		);
		expect(hrefs).toEqual(["/product", "/docs", "/pricing"]);
	});

	it("reaches those pages on a phone, where the nav is hidden", () => {
		// The nav is `hidden sm:flex`, so the drawer is the only way to the
		// marketing pages from a phone browser.
		render(<Header />);

		const toggle = screen.getByRole("button", { name: "Open menu" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		// The drawer carries the account actions too, which the old dropdown
		// did not — so every header destination is reachable one-handed.
		const drawer = screen.getByRole("dialog", { name: "Menu" });
		const labels = Array.from(drawer.querySelectorAll("a")).map(
			(a) => a.textContent,
		);
		expect(labels).toEqual([
			"Product",
			"Docs",
			"Pricing",
			"Login",
			"Get Started",
		]);
	});
});
