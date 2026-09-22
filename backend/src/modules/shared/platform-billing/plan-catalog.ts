import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The plan <-> provider-price mapping, and the only place in the codebase where
 * a provider's sellable id (a Stripe `price_...`, a Polar product, a Paddle
 * `pri_...`) becomes a Proyekto plan or vice versa.
 *
 * Provider-neutral: each adapter builds one catalog from its own env prefix
 * (STRIPE_PRICE_PRO_MONTHLY, POLAR_PRICE_PRO_MONTHLY, ...), so the mapping logic
 * and the safety rules below are written and tested exactly once.
 *
 * Kept free of injectable state so the whole mapping is unit-testable without a
 * Nest container, and so the 12x pricing hazard below can be pinned by a spec
 * rather than by review attention.
 */

/** The plans a customer can buy without talking to us. */
export type PurchasablePlan = 'pro' | 'business';

export type BillingInterval = 'month' | 'year';

export const PURCHASABLE_PLANS: readonly PurchasablePlan[] = [
  'pro',
  'business',
];

export const BILLING_INTERVALS: readonly BillingInterval[] = ['month', 'year'];

export function isPurchasablePlan(value: string): value is PurchasablePlan {
  return (PURCHASABLE_PLANS as readonly string[]).includes(value);
}

export function isBillingInterval(value: string): value is BillingInterval {
  return (BILLING_INTERVALS as readonly string[]).includes(value);
}

export interface PlanForPrice {
  plan: PurchasablePlan;
  interval: BillingInterval;
}

const PLAN_KEY: Record<PurchasablePlan, string> = {
  pro: 'PRO',
  business: 'BUSINESS',
};

const INTERVAL_KEY: Record<BillingInterval, string> = {
  month: 'MONTHLY',
  year: 'YEARLY',
};

/**
 * CAREFUL — the published price is a per-month display of an annual charge.
 * `/pricing` advertises Pro as "$10 per user/month, billed yearly", so the
 * yearly price object is 120.00 per year, not 10.00. Every provider:
 *
 *   <PREFIX>_PRICE_PRO_MONTHLY        12.00 / month
 *   <PREFIX>_PRICE_PRO_YEARLY        120.00 / year
 *   <PREFIX>_PRICE_BUSINESS_MONTHLY   24.00 / month
 *   <PREFIX>_PRICE_BUSINESS_YEARLY   240.00 / year
 *
 * All per seat, USD. Enterprise is quoted and has no self-serve price.
 */
export class PriceCatalog {
  private readonly logger: Logger;

  /** @param envPrefix e.g. 'STRIPE' reads STRIPE_PRICE_PRO_MONTHLY. */
  constructor(
    private readonly config: ConfigService,
    private readonly envPrefix: string,
  ) {
    this.logger = new Logger(`PriceCatalog:${envPrefix}`);
  }

  envKey(plan: PurchasablePlan, interval: BillingInterval): string {
    return `${this.envPrefix}_PRICE_${PLAN_KEY[plan]}_${INTERVAL_KEY[interval]}`;
  }

  /**
   * The provider price id for a plan and interval, or null when unconfigured.
   * Null is a normal state before the env vars are set, not an error — callers
   * turn it into a 503 rather than crashing at boot.
   */
  resolvePriceId(
    plan: PurchasablePlan,
    interval: BillingInterval,
  ): string | null {
    const raw = this.config.get<string>(this.envKey(plan, interval))?.trim();
    return raw ? raw : null;
  }

  /**
   * The reverse map: which plan a subscription's current price represents.
   *
   * Returns null for anything unrecognised — an Enterprise custom price, a price
   * archived during a re-pricing, or a price belonging to a different
   * environment that shares the provider account.
   *
   * Callers MUST treat null as "leave the stored plan alone", never as "free".
   * Defaulting an unknown price to free is how you silently un-bill your largest
   * customer the day someone negotiates a custom rate.
   */
  resolvePlanForPrice(priceId: string | null | undefined): PlanForPrice | null {
    if (!priceId) return null;
    for (const plan of PURCHASABLE_PLANS) {
      for (const interval of BILLING_INTERVALS) {
        if (this.resolvePriceId(plan, interval) === priceId) {
          return { plan, interval };
        }
      }
    }
    this.logger.warn(
      `Unrecognised price ${priceId} — leaving the stored plan unchanged.`,
    );
    return null;
  }

  /**
   * Which plans this deployment can actually sell. A plan whose price id is not
   * configured is absent, so the web never offers a button that would 503.
   */
  listPurchasablePlans(): PurchasablePlan[] {
    return PURCHASABLE_PLANS.filter((plan) =>
      BILLING_INTERVALS.some(
        (interval) => this.resolvePriceId(plan, interval) !== null,
      ),
    );
  }
}
