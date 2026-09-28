/**
 * Every sentence the product says about money.
 *
 * Kept in one pure module rather than scattered across components for two
 * reasons: it reviews as a single diff, and it is regression-locked by a single
 * test file. These strings are a contract — a customer reads "nothing is
 * charged today" before clicking, and the billing system has to make that true.
 *
 * Two rules hold everywhere in here:
 *
 *  1. No computed amounts. Prices in `pricing.ts` are marketing list prices;
 *     this customer may have a coupon, a tax line, or a pending proration
 *     credit. Any figure shown must come from the provider through the API, or be
 *     omitted. Promising "$84" and charging $91.40 is worse than saying nothing.
 *
 *  2. Money only — no limit vocabulary. Plan limits (members, projects,
 *     teams, …) are enforced, but they are stated in exactly one place:
 *     `usageCopy.ts`, which is handed the live, admin-edited numbers. Limit
 *     wording here would be a static second copy that drifts from what the
 *     backend enforces, so words like "limit", "exceeded" or "locked" stay out
 *     of this file. A test asserts their absence.
 */

import type { BillingStatus, BillingSummary } from "@/services/billing.service";

export type SeatChangeReason = "invite" | "remove";

export interface SeatChangeCopyInput {
	plan: BillingSummary["plan"];
	seatDeltaEffect: BillingSummary["seat_delta_effect"];
	status: BillingStatus;
	reason: SeatChangeReason;
	/** Formatted date of the next invoice, when known. */
	nextInvoiceDate?: string | null;
	/** Whether the reader can actually change the plan. */
	isOwner: boolean;
	/**
	 * Proyekto covers the plan and no paid subscription is running, so a seat
	 * change moves no money at all.
	 */
	isComplimentary?: boolean;
}

/**
 * What an owner or admin is told before they invite or remove someone.
 *
 * The hazard this exists for is specific: seats are consumed on ACCEPTANCE, not
 * on invitation, so an owner invites five people, sees no charge, and the bill
 * moves days later when other people click a link. Saying so at the moment of
 * the invite is the whole point.
 */
export function seatChangeCopy(input: SeatChangeCopyInput): string[] {
	const lines: string[] = [];

	if (input.isComplimentary) {
		lines.push(
			"This workspace's plan is complimentary. Adding people doesn't cost anything.",
		);
		return lines;
	}

	if (input.plan === "free") {
		lines.push(
			"Your workspace is on Free. Adding people doesn't cost anything.",
		);
		return lines;
	}

	const when = input.nextInvoiceDate
		? `your next invoice on ${input.nextInvoiceDate}`
		: "your next invoice";

	if (input.reason === "invite") {
		if (input.seatDeltaEffect === "next_invoice") {
			lines.push(
				`Seats are billed monthly. Nothing is charged today — when someone accepts, ${when} covers their seat.`,
			);
			lines.push("Invitations that are never accepted are never billed.");
		} else {
			lines.push(
				"Seats are billed yearly. When someone accepts, we charge for the rest of your term straight away, then their seat renews with everything else.",
			);
			lines.push("Invitations that are never accepted are never billed.");
		}
	} else if (input.seatDeltaEffect === "next_invoice") {
		lines.push(
			`Their seat comes off ${when}. Nothing is refunded for the rest of this month.`,
		);
	} else {
		lines.push("We'll credit the unused part of their seat to this workspace.");
		// The single most important sentence in the product's billing copy.
		// "Credit, not refund" is the number one complaint in per-seat annual
		// billing, and saying it before the click is the difference between a
		// support ticket and a chargeback.
		lines.push(
			"Credit is applied to future invoices and is not refunded to your card.",
		);
	}

	if (input.status === "past_due") {
		lines.push(
			"This workspace has an unpaid invoice. People are still added; the seat is billed once payment succeeds.",
		);
	}

	if (!input.isOwner) {
		lines.push("The workspace owner is billed for this.");
	}

	return lines;
}

/** The one-line status banner, or null when there is nothing to say. */
export function billingStatusCopy(
	summary: Pick<
		BillingSummary,
		"status" | "cancel_at_period_end" | "current_period_end" | "plan"
	>,
	formatDate: (iso: string) => string,
): { tone: "info" | "warning"; message: string } | null {
	if (summary.status === "past_due" || summary.status === "unpaid") {
		return {
			tone: "warning",
			message:
				"We couldn't take the last payment. Update your payment method to keep this workspace on its current plan.",
		};
	}
	if (summary.status === "incomplete") {
		return {
			tone: "warning",
			message:
				"This subscription is waiting on a payment confirmation. It becomes active once the payment clears.",
		};
	}
	if (summary.cancel_at_period_end && summary.current_period_end) {
		return {
			tone: "info",
			message: `Your plan ends on ${formatDate(summary.current_period_end)}. Until then nothing changes.`,
		};
	}
	if (summary.status === "trialing") {
		return { tone: "info", message: "You're on a trial of this plan." };
	}
	return null;
}

/**
 * How seats read on the page. Two numbers when the DB and the provider disagree,
 * because they legitimately do between a membership change and the next sync —
 * and showing one while the invoice says the other is how trust is lost.
 */
export function seatsCopy(
	seatsUsed: number,
	billedQuantity: number | null,
): { headline: string; note: string | null } {
	if (billedQuantity === null || billedQuantity === seatsUsed) {
		return {
			headline: `${seatsUsed} ${seatsUsed === 1 ? "seat" : "seats"} in use`,
			note: null,
		};
	}
	return {
		headline: `${seatsUsed} in use · ${billedQuantity} billed`,
		note: "Your next invoice catches up with this difference automatically.",
	};
}

/** Shown next to the pending-invitation list, where the fact actually matters. */
export const PENDING_INVITES_NOTE =
	"Pending invitations do not use a seat until they're accepted.";

/** Beside a plan Proyekto has granted, when nothing is being paid for. */
export const COMPLIMENTARY_NOTE =
	"Proyekto covers this workspace's plan, so there's nothing to pay.";

/**
 * Beside a granted plan while the workspace's own subscription is still
 * running. Granting a plan does not cancel a subscription, and the owner has
 * to hear that from us rather than from their next invoice.
 */
export const COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE =
	"Proyekto covers this workspace's plan. Your own subscription is still active and keeps billing until you cancel it in Manage billing.";

/** Replaces checkout on a granted plan: changing it is a conversation with us. */
export const COMPLIMENTARY_PLAN_CHANGES_NOTE =
	"Plan changes for this workspace go through Proyekto.";

export const SALES_EMAIL = "sales@proyekto.tech";

/** Shown to a plain member, who can see nothing else about billing. */
export const MEMBER_ONLY_NOTE =
	"Billing is managed by this workspace's owners.";

/** Shown to an admin, who can read the plan but cannot move money. */
export const ADMIN_READ_ONLY_NOTE =
	"You can see the plan and seat count because you manage members here. Only an owner can change the plan or payment method.";

/** After returning from the provider's checkout, before the webhook has landed. */
export const CHECKOUT_SETTLING = "Payment received — activating your plan.";

/**
 * The webhook can lag the browser redirect. This must never read as a failure:
 * the money has already moved.
 */
export const CHECKOUT_SLOW =
	"This is taking longer than usual. Your payment went through and this page will update shortly.";

export const CHECKOUT_CANCELLED =
	"Checkout was cancelled. Nothing was charged.";
