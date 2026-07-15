/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children?: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useLocation: () => ({ pathname: "/roadmap-templates" }),
	useNavigate: () => vi.fn(),
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
	it("keeps account actions without rendering marketing navigation", () => {
		render(<Header />);

		expect(screen.queryByRole("navigation")).toBeNull();
		expect(screen.queryByText("Use It Your Way")).toBeNull();
		expect(screen.queryByText("How It Works")).toBeNull();
		expect(screen.queryByText("Why Proyekto")).toBeNull();
		expect(screen.queryByText("Templates")).toBeNull();
		expect(screen.queryByText("Features")).toBeNull();
		expect(screen.getByRole("link", { name: "Login" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Get Started" })).toBeTruthy();
	});
});
