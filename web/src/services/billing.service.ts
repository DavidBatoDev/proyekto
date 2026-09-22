import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import type { PlanId } from "@/lib/pricing";

export type BillingInterval = "month" | "year";

export type BillingStatus =
	| "active"
	| "trialing"
	| "past_due"
	| "canceled"
	| "incomplete"
	| "incomplete_expired"
	| "unpaid"
	| "paused";

export interface BillingSummary {
	plan: PlanId;
	status: BillingStatus;
	interval: BillingInterval | null;
	/** Live COUNT(workspace_members) — the seat pool. */
	seats_used: number;
	/**
	 * What the payment provider is currently billing. Diverges from `seats_used` between a
	 * membership change and the next sync, which is why the UI renders both
	 * rather than picking one and hoping.
	 */
	billed_quantity: number | null;
	/** Nothing enforces this. The UI must never render it. */
	seat_limit: number | null;
	current_period_start: string | null;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
	canceled_at: string | null;
	trial_end: string | null;
	currency: string | null;
	next_invoice: {
		amount_due_cents: number;
		currency: string;
		date: string | null;
		is_estimate: boolean;
	} | null;
	payment_method: {
		brand: string | null;
		last4: string | null;
		exp_month: number | null;
		exp_year: number | null;
	} | null;
	latest_invoice: { hosted_url: string | null; status: string | null } | null;
	billing_email: string | null;
	/** Which payment provider holds this workspace's billing account, if any. */
	provider: "stripe" | "polar" | "paddle" | null;
	has_billing_account: boolean;
	portal_available: boolean;
	purchasable_plans: Array<"pro" | "business">;
	/**
	 * Derived on the server so the "monthly = next invoice, annual = prorated"
	 * rule lives in exactly one place. Never re-derive it here from `interval`.
	 */
	seat_delta_effect: "next_invoice" | "prorated";
}

export async function getBillingSummary(
	workspaceId: string,
): Promise<BillingSummary> {
	try {
		const { data } = await apiClient.get<{ data: BillingSummary }>(
			`/api/workspaces/${workspaceId}/billing`,
		);
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(error, "Failed to load billing details."),
		);
	}
}

/**
 * Note what is NOT sent: a provider price id. The web only names a plan and an
 * interval, and the backend resolves the price from its own configuration.
 * Accepting a price id from the client would let anyone check out against an
 * archived or internal price, and a price id baked into a long-cached bundle
 * would keep selling at the old rate after a re-pricing.
 */
export async function createCheckoutSession(
	workspaceId: string,
	body: {
		plan: "pro" | "business";
		interval: BillingInterval;
		success_path?: string;
		cancel_path?: string;
	},
): Promise<{ url: string }> {
	try {
		const { data } = await apiClient.post<{ data: { url: string } }>(
			`/api/workspaces/${workspaceId}/billing/checkout-session`,
			body,
		);
		return data.data;
	} catch (error) {
		throw new Error(extractApiErrorMessage(error, "Could not start checkout."));
	}
}

export async function createPortalSession(
	workspaceId: string,
	body: { return_path?: string } = {},
): Promise<{ url: string }> {
	try {
		const { data } = await apiClient.post<{ data: { url: string } }>(
			`/api/workspaces/${workspaceId}/billing/portal-session`,
			body,
		);
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(error, "Could not open the billing portal."),
		);
	}
}
