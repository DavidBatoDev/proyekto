/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	COMPLIMENTARY_NOTE,
	COMPLIMENTARY_PLAN_CHANGES_NOTE,
	COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE,
	MEMBER_ONLY_NOTE,
} from "@/lib/billingCopy";
import type { BillingSummary } from "@/services/billing.service";
import type { Workspace } from "@/services/workspaces.service";

const state = vi.hoisted(() => ({
	summary: null as BillingSummary | null,
	role: "owner" as "owner" | "admin" | "member",
}));

const workspace = (): Workspace => ({
	id: "ws-1",
	name: "Acme",
	slug: "acme",
	previous_slugs: [],
	description: null,
	avatar_url: null,
	created_by: "user-me",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	my_role: state.role,
});

vi.mock("@/components/workspace/settings/WorkspaceSettingsGate", () => ({
	WorkspaceSettingsGate: ({
		children,
	}: {
		children: (workspace: Workspace) => ReactNode;
	}) => <>{children(workspace())}</>,
}));

vi.mock("@/hooks/useBilling", () => ({
	useBillingSummaryQuery: () => ({ data: state.summary, isLoading: false }),
	useCreateCheckoutSessionMutation: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
	}),
	useCreatePortalSessionMutation: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
	}),
	useInvalidateBilling: () => vi.fn(),
}));

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useWorkspaceInvitesQuery: () => ({ data: [] }),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		className,
	}: {
		children: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
	}) => (
		<a
			href={to.replace("$workspaceSlug", params?.workspaceSlug ?? "")}
			className={className}
		>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
	useSearch: () => ({}),
}));

import { ownerBillingMode, WorkspaceBillingPage } from "./WorkspaceBillingPage";

const baseSummary: BillingSummary = {
	plan: "free",
	status: "active",
	interval: null,
	seats_used: 3,
	billed_quantity: null,
	seat_limit: null,
	current_period_start: null,
	current_period_end: null,
	cancel_at_period_end: false,
	canceled_at: null,
	trial_end: null,
	currency: null,
	next_invoice: null,
	payment_method: null,
	latest_invoice: null,
	billing_email: null,
	provider: null,
	has_billing_account: false,
	portal_available: false,
	purchasable_plans: ["pro", "business"],
	seat_delta_effect: "next_invoice",
	effective_plan: "free",
	plan_source: "default",
	complimentary: null,
	has_live_subscription: false,
};

const comped: BillingSummary = {
	...baseSummary,
	effective_plan: "pro",
	plan_source: "complimentary",
	complimentary: {
		plan: "pro",
		since: "2026-09-01T00:00:00Z",
		until: null,
		active: true,
	},
	purchasable_plans: ["business"],
};

const checkoutButtons = () =>
	screen.queryAllByRole("button", { name: /billed yearly|monthly/ });

afterEach(() => {
	cleanup();
	state.summary = null;
	state.role = "owner";
});

describe("WorkspaceBillingPage", () => {
	it("offers checkout on a workspace nobody has comped", () => {
		state.summary = baseSummary;
		render(<WorkspaceBillingPage />);

		expect(screen.getByText("Free")).toBeTruthy();
		expect(checkoutButtons().length).toBeGreaterThan(0);
		expect(screen.queryByText("Complimentary")).toBeNull();
	});

	it("shows a comped plan with no checkout when nothing is being paid for", () => {
		state.summary = comped;
		render(<WorkspaceBillingPage />);

		// The effective plan, not the Free subscription row.
		expect(screen.getByText("Pro")).toBeTruthy();
		expect(screen.getByText("Complimentary")).toBeTruthy();
		expect(screen.getByText(COMPLIMENTARY_NOTE)).toBeTruthy();
		expect(checkoutButtons()).toHaveLength(0);
		expect(screen.queryByRole("button", { name: /Manage billing/ })).toBeNull();
		expect(
			screen.getByText(new RegExp(COMPLIMENTARY_PLAN_CHANGES_NOTE)),
		).toBeTruthy();
		const sales = screen.getByRole("link", { name: "sales@proyekto.tech" });
		expect(sales.getAttribute("href")).toBe("mailto:sales@proyekto.tech");
	});

	it("keeps Manage billing for a comped workspace whose subscription ended", () => {
		// The subscription is gone but the billing account (and its invoices and
		// saved card) remains, so the portal stays reachable. Only checkout is
		// withheld under a comp.
		state.summary = {
			...comped,
			status: "canceled",
			portal_available: true,
			has_billing_account: true,
			has_live_subscription: false,
		};
		render(<WorkspaceBillingPage />);

		expect(screen.getByText("Complimentary")).toBeTruthy();
		expect(screen.getByText(COMPLIMENTARY_NOTE)).toBeTruthy();
		expect(
			screen.getByText(new RegExp(COMPLIMENTARY_PLAN_CHANGES_NOTE)),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Update your saved payment method or download past invoices.",
			),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /Manage billing/ })).toBeTruthy();
		expect(checkoutButtons()).toHaveLength(0);
	});

	it("offers only Manage billing when a comped workspace still has a subscription", () => {
		state.summary = {
			...comped,
			plan: "pro",
			status: "active",
			interval: "month",
			portal_available: true,
			has_billing_account: true,
			has_live_subscription: true,
			complimentary: { ...comped.complimentary!, plan: "business" },
			effective_plan: "business",
		};
		render(<WorkspaceBillingPage />);

		expect(screen.getByText("Business")).toBeTruthy();
		expect(screen.getByText(COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE)).toBeTruthy();
		expect(screen.queryByText(COMPLIMENTARY_NOTE)).toBeNull();
		expect(screen.getByRole("button", { name: /Manage billing/ })).toBeTruthy();
		expect(checkoutButtons()).toHaveLength(0);
		// The running subscription's portal handles changes: no sales detour.
		expect(
			screen.queryByText(new RegExp(COMPLIMENTARY_PLAN_CHANGES_NOTE)),
		).toBeNull();
		// The interval is the paid subscription's, not the granted plan's.
		expect(screen.queryByText(/billed monthly/)).toBeNull();
	});

	it("links to the Usage page", () => {
		state.summary = baseSummary;
		render(<WorkspaceBillingPage />);

		const link = screen.getByRole("link", { name: /See usage/ });
		expect(link.getAttribute("href")).toBe("/w/acme/settings/usage");
	});

	it("links a plain member to the Usage page too", () => {
		state.role = "member";
		render(<WorkspaceBillingPage />);

		expect(screen.getByText(MEMBER_ONLY_NOTE)).toBeTruthy();
		expect(screen.getByRole("link", { name: /See usage/ })).toBeTruthy();
	});

	it("names each checkout button by plan and interval", () => {
		state.summary = baseSummary;
		render(<WorkspaceBillingPage />);

		for (const name of [
			"Pro · monthly",
			"Pro · billed yearly",
			"Business · monthly",
			"Business · billed yearly",
		]) {
			expect(screen.getByRole("button", { name })).toBeTruthy();
		}
	});

	it("shows both seat counts when the provider bills a different number", () => {
		state.summary = { ...baseSummary, plan: "pro", billed_quantity: 4 };
		render(<WorkspaceBillingPage />);

		expect(screen.getByText("Seats in use")).toBeTruthy();
		expect(screen.getByText("Seats billed")).toBeTruthy();
		expect(
			screen.getByText(
				"Your next invoice catches up with this difference automatically.",
			),
		).toBeTruthy();
	});

	it("keeps card digits and the invoice link for the owner", () => {
		const paying: BillingSummary = {
			...baseSummary,
			plan: "pro",
			portal_available: true,
			has_billing_account: true,
			payment_method: {
				brand: "visa",
				last4: "4242",
				exp_month: 4,
				exp_year: 2028,
			},
			latest_invoice: {
				hosted_url: "https://invoice.example.test/i/1",
				status: "paid",
			},
		};
		state.summary = paying;
		render(<WorkspaceBillingPage />);

		expect(screen.getByText("4242")).toBeTruthy();
		expect(screen.getByText("Expires 04/2028")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /View invoice/ }).getAttribute("href"),
		).toBe("https://invoice.example.test/i/1");

		cleanup();
		state.role = "admin";
		render(<WorkspaceBillingPage />);

		expect(screen.getByText("A payment method is on file.")).toBeTruthy();
		expect(screen.queryByText("4242")).toBeNull();
		expect(screen.queryByRole("link", { name: /View invoice/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /Manage billing/ })).toBeNull();
	});

	it("falls back to the subscription plan when an older backend sends no effective plan", () => {
		const {
			effective_plan: _effective,
			plan_source: _source,
			complimentary: _comp,
			has_live_subscription: _live,
			...legacy
		} = baseSummary;
		state.summary = { ...legacy, plan: "pro", portal_available: true };
		render(<WorkspaceBillingPage />);

		expect(screen.getByText("Pro")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Manage billing/ })).toBeTruthy();
	});
});

describe("ownerBillingMode", () => {
	it("never sells over a granted plan", () => {
		expect(
			ownerBillingMode({
				plan_source: "complimentary",
				has_live_subscription: false,
				portal_available: true,
			}),
		).toBe("complimentary");
		expect(
			ownerBillingMode({
				plan_source: "complimentary",
				has_live_subscription: true,
				portal_available: true,
			}),
		).toBe("complimentary_with_subscription");
	});

	it("keeps the portal and checkout paths for everyone else", () => {
		expect(
			ownerBillingMode({ plan_source: "subscription", portal_available: true }),
		).toBe("portal");
		expect(
			ownerBillingMode({ plan_source: "default", portal_available: false }),
		).toBe("checkout");
		expect(ownerBillingMode({ portal_available: false })).toBe("checkout");
	});
});
