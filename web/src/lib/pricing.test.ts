import { describe, expect, it } from "vitest";
import { PAID_PLAN_IDS, PLANS, planById } from "./pricing";

describe("pricing data invariants", () => {
	/**
	 * The guard that keeps checkout honest: a Stripe price id in the web bundle
	 * would be a tampering surface (anyone could check out against an archived or
	 * internal price), would keep selling at the old rate after a re-pricing
	 * because this bundle is long-cached, and would need a separate build per
	 * Stripe mode. The (plan, interval) -> price mapping lives in the backend.
	 */
	it("contains no Stripe price identifiers", () => {
		expect(JSON.stringify(PLANS)).not.toMatch(/price_/);
	});

	it("gives every purchasable plan both a monthly and a yearly price", () => {
		for (const id of PAID_PLAN_IDS) {
			const plan = planById(id);
			expect(plan?.priceMonthly).toBeTypeOf("number");
			expect(plan?.priceYearly).toBeTypeOf("number");
			expect(plan?.intervals).toEqual(["month", "year"]);
		}
	});

	it("keeps enterprise quoted and annual-only", () => {
		const enterprise = planById("enterprise");
		expect(enterprise?.priceMonthly).toBeNull();
		expect(enterprise?.priceYearly).toBeNull();
		expect(enterprise?.cta.kind).toBe("sales");
		expect(enterprise?.intervals).toEqual(["year"]);
	});

	it("offers no interval on free, which is never bought", () => {
		expect(planById("free")?.intervals).toEqual([]);
	});

	it("marks exactly the paid plans as subscribable", () => {
		const subscribable = PLANS.filter(
			(plan) => plan.cta.kind === "subscribe",
		).map((plan) => plan.id);
		expect(subscribable).toEqual([...PAID_PLAN_IDS]);
	});

	it("prices yearly below monthly, since yearly billing is the discount", () => {
		for (const id of PAID_PLAN_IDS) {
			const plan = planById(id);
			expect(plan?.priceYearly as number).toBeLessThan(
				plan?.priceMonthly as number,
			);
		}
	});
});
