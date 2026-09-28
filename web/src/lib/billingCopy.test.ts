import { describe, expect, it } from "vitest";
import {
	ADMIN_READ_ONLY_NOTE,
	billingStatusCopy,
	CHECKOUT_CANCELLED,
	CHECKOUT_SETTLING,
	CHECKOUT_SLOW,
	COMPLIMENTARY_NOTE,
	COMPLIMENTARY_PLAN_CHANGES_NOTE,
	COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE,
	MEMBER_ONLY_NOTE,
	PENDING_INVITES_NOTE,
	seatChangeCopy,
	seatsCopy,
} from "./billingCopy";

const base = {
	plan: "pro" as const,
	status: "active" as const,
	isOwner: true,
	nextInvoiceDate: "1 March 2027",
};

describe("seatChangeCopy — monthly", () => {
	it("promises no charge today when inviting", () => {
		const text = seatChangeCopy({
			...base,
			seatDeltaEffect: "next_invoice",
			reason: "invite",
		}).join(" ");
		expect(text).toContain("Nothing is charged today");
		expect(text).toContain("1 March 2027");
	});

	it("says an unaccepted invitation is never billed", () => {
		// The whole hazard this copy exists for: seats are consumed on
		// acceptance, so the bill moves days later when someone else clicks a
		// link the owner has already forgotten about.
		const text = seatChangeCopy({
			...base,
			seatDeltaEffect: "next_invoice",
			reason: "invite",
		}).join(" ");
		expect(text).toContain("never accepted are never billed");
	});

	it("promises no refund for the rest of the month when removing", () => {
		const text = seatChangeCopy({
			...base,
			seatDeltaEffect: "next_invoice",
			reason: "remove",
		}).join(" ");
		expect(text).toContain("Nothing is refunded");
	});
});

describe("seatChangeCopy — annual", () => {
	it("warns that adding charges immediately", () => {
		const text = seatChangeCopy({
			...base,
			seatDeltaEffect: "prorated",
			reason: "invite",
		}).join(" ");
		expect(text).toContain("straight away");
	});

	/**
	 * The single most important string in the build. "Credit, not refund" is the
	 * number one complaint in per-seat annual billing, and saying it before the
	 * click is the difference between a support ticket and a chargeback.
	 */
	it("says credit goes to future invoices and NOT back to the card", () => {
		const text = seatChangeCopy({
			...base,
			seatDeltaEffect: "prorated",
			reason: "remove",
		}).join(" ");
		expect(text).toContain("not refunded to your card");
	});
});

describe("seatChangeCopy — context", () => {
	it("keeps the member cap out of money copy (usageCopy states it)", () => {
		// The Free member cap is enforced, but it is stated only by usageCopy.ts
		// from the live, admin-edited matrix. Quoting "10" here would be a static
		// second copy that goes stale the day an admin changes the limit.
		const text = seatChangeCopy({
			...base,
			plan: "free",
			seatDeltaEffect: "next_invoice",
			reason: "invite",
		}).join(" ");
		expect(text).toContain("doesn't cost anything");
		expect(text).not.toContain("10");
	});

	it("tells an admin that the owner pays", () => {
		const text = seatChangeCopy({
			...base,
			isOwner: false,
			seatDeltaEffect: "next_invoice",
			reason: "invite",
		}).join(" ");
		expect(text).toContain("owner is billed");
	});

	it("does not block anyone while past_due — payment state never gates access", () => {
		const text = seatChangeCopy({
			...base,
			status: "past_due",
			seatDeltaEffect: "next_invoice",
			reason: "invite",
		}).join(" ");
		expect(text).toContain("still added");
	});
});

describe("billing copy — money only, no limit vocabulary", () => {
	const FORBIDDEN =
		/\b(limit|over your|exceeded|locked|automatically downgraded)\b/i;

	const everyString: string[] = [
		MEMBER_ONLY_NOTE,
		ADMIN_READ_ONLY_NOTE,
		PENDING_INVITES_NOTE,
		CHECKOUT_SETTLING,
		CHECKOUT_SLOW,
		CHECKOUT_CANCELLED,
		COMPLIMENTARY_NOTE,
		COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE,
		COMPLIMENTARY_PLAN_CHANGES_NOTE,
		seatsCopy(6, null).headline,
		seatsCopy(6, 5).headline,
		seatsCopy(6, 5).note ?? "",
	];

	for (const plan of ["free", "pro", "business", "enterprise"] as const) {
		for (const effect of ["next_invoice", "prorated"] as const) {
			for (const reason of ["invite", "remove"] as const) {
				for (const isOwner of [true, false]) {
					for (const isComplimentary of [false, true]) {
						everyString.push(
							...seatChangeCopy({
								plan,
								seatDeltaEffect: effect,
								status: "active",
								reason,
								isOwner,
								isComplimentary,
								nextInvoiceDate: "1 March 2027",
							}),
						);
					}
				}
			}
		}
	}

	/**
	 * Limits are enforced, but they are worded in exactly one module —
	 * usageCopy.ts, fed the live, admin-edited matrix. A limit word in money
	 * copy would be a static second statement of a rule an admin can change,
	 * so none may appear here.
	 */
	it.each(everyString)("uses no limit vocabulary: %s", (line) => {
		expect(line).not.toMatch(FORBIDDEN);
	});

	it("never emits a currency amount — figures must come from the provider", () => {
		// A number computed from pricing.ts cannot see coupons, tax, or a pending
		// proration credit, so promising one is how you say $84 and charge $91.40.
		for (const line of everyString) {
			expect(line).not.toMatch(/[$£€]\s?\d/);
		}
	});
});

describe("complimentary copy", () => {
	it("complimentary copy promises nothing is charged and names no amount", () => {
		expect(COMPLIMENTARY_NOTE).toContain("nothing to pay");
		for (const plan of ["free", "pro", "business", "enterprise"] as const) {
			for (const effect of ["next_invoice", "prorated"] as const) {
				for (const reason of ["invite", "remove"] as const) {
					// One line whatever the subscription row says: a granted plan
					// moves no money, so proration, invoice dates and past-due
					// warnings would all describe charges that never happen.
					expect(
						seatChangeCopy({
							plan,
							seatDeltaEffect: effect,
							status: "past_due",
							reason,
							isOwner: false,
							isComplimentary: true,
							nextInvoiceDate: "1 March 2027",
						}),
					).toEqual([
						"This workspace's plan is complimentary. Adding people doesn't cost anything.",
					]);
				}
			}
		}
		for (const line of [
			COMPLIMENTARY_NOTE,
			COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE,
			COMPLIMENTARY_PLAN_CHANGES_NOTE,
		]) {
			expect(line).not.toMatch(/[$£€\d]/);
		}
	});

	it("tells an owner a granted plan does not cancel their own subscription", () => {
		expect(COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE).toContain("still active");
		expect(COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE).toContain("Manage billing");
		expect(COMPLIMENTARY_WITH_SUBSCRIPTION_NOTE).not.toContain(
			"nothing to pay",
		);
	});
});

describe("seatsCopy", () => {
	it("shows one number when the database and the provider agree", () => {
		expect(seatsCopy(6, 6)).toEqual({ headline: "6 seats in use", note: null });
	});

	it("shows both numbers when they diverge, rather than picking one", () => {
		// They legitimately diverge between a membership change and the next
		// sync. Showing one while the invoice says the other is how trust goes.
		const copy = seatsCopy(6, 5);
		expect(copy.headline).toBe("6 in use · 5 billed");
		expect(copy.note).toContain("catches up");
	});

	it("handles a single seat without saying '1 seats'", () => {
		expect(seatsCopy(1, 1).headline).toBe("1 seat in use");
	});
});

describe("billingStatusCopy", () => {
	const fmt = (iso: string) => iso;

	it("warns on past_due without threatening a lockout", () => {
		const copy = billingStatusCopy(
			{
				status: "past_due",
				cancel_at_period_end: false,
				current_period_end: null,
				plan: "pro",
			},
			fmt,
		);
		expect(copy?.tone).toBe("warning");
		expect(copy?.message).not.toMatch(/lock|suspend|disable/i);
	});

	it("says when a cancelled plan actually ends", () => {
		const copy = billingStatusCopy(
			{
				status: "active",
				cancel_at_period_end: true,
				current_period_end: "2027-03-01",
				plan: "pro",
			},
			fmt,
		);
		expect(copy?.message).toContain("2027-03-01");
		expect(copy?.tone).toBe("info");
	});

	it("is silent on a healthy subscription", () => {
		expect(
			billingStatusCopy(
				{
					status: "active",
					cancel_at_period_end: false,
					current_period_end: "2027-03-01",
					plan: "pro",
				},
				fmt,
			),
		).toBeNull();
	});
});
