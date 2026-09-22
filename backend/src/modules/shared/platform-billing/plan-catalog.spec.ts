import { ConfigService } from '@nestjs/config';
import { PriceCatalog } from './plan-catalog';

const PRICES: Record<string, string> = {
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_month',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_year',
  STRIPE_PRICE_BUSINESS_MONTHLY: 'price_business_month',
  STRIPE_PRICE_BUSINESS_YEARLY: 'price_business_year',
};

function buildCatalog(
  values: Record<string, string> = PRICES,
  prefix = 'STRIPE',
): PriceCatalog {
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new PriceCatalog(config, prefix);
}

describe('PriceCatalog.resolvePriceId', () => {
  it('resolves every purchasable plan and interval', () => {
    const catalog = buildCatalog();
    expect(catalog.resolvePriceId('pro', 'month')).toBe('price_pro_month');
    expect(catalog.resolvePriceId('pro', 'year')).toBe('price_pro_year');
    expect(catalog.resolvePriceId('business', 'month')).toBe(
      'price_business_month',
    );
    expect(catalog.resolvePriceId('business', 'year')).toBe(
      'price_business_year',
    );
  });

  it("reads only its own provider's env prefix", () => {
    // Two adapters configured side by side must never read each other's
    // prices — a Polar checkout against a Stripe price id would simply fail,
    // but a silent mix-up in the reverse map could mislabel a plan.
    const catalog = buildCatalog(
      { ...PRICES, POLAR_PRICE_PRO_MONTHLY: 'polar_pro_month' },
      'POLAR',
    );
    expect(catalog.resolvePriceId('pro', 'month')).toBe('polar_pro_month');
    expect(catalog.resolvePriceId('pro', 'year')).toBeNull();
    expect(catalog.envKey('business', 'year')).toBe(
      'POLAR_PRICE_BUSINESS_YEARLY',
    );
  });

  it('returns null for an unconfigured price rather than throwing', () => {
    // Unconfigured is the shipped state, not an error: the module must boot
    // with none of these set.
    expect(buildCatalog({}).resolvePriceId('pro', 'month')).toBeNull();
  });

  it('treats a whitespace-only env var as unconfigured', () => {
    const catalog = buildCatalog({ STRIPE_PRICE_PRO_MONTHLY: '   ' });
    expect(catalog.resolvePriceId('pro', 'month')).toBeNull();
  });
});

describe('PriceCatalog.resolvePlanForPrice', () => {
  /**
   * The 12x guard.
   *
   * `/pricing` shows a yearly plan as a per-month figure ("$10 per user/month,
   * billed yearly"), so the yearly price is 120.00/year, not 10.00/month.
   * Wiring the yearly price id to a monthly interval — or vice versa — would
   * bill an order of magnitude wrong in either direction, and nothing else in
   * the system would notice. Pin the mapping.
   */
  it('maps each yearly price id to the year interval, never month', () => {
    const catalog = buildCatalog();
    expect(catalog.resolvePlanForPrice('price_pro_year')).toEqual({
      plan: 'pro',
      interval: 'year',
    });
    expect(catalog.resolvePlanForPrice('price_business_year')).toEqual({
      plan: 'business',
      interval: 'year',
    });
  });

  it('maps each monthly price id to the month interval', () => {
    const catalog = buildCatalog();
    expect(catalog.resolvePlanForPrice('price_pro_month')).toEqual({
      plan: 'pro',
      interval: 'month',
    });
    expect(catalog.resolvePlanForPrice('price_business_month')).toEqual({
      plan: 'business',
      interval: 'month',
    });
  });

  it('round-trips every plan and interval through both directions', () => {
    const catalog = buildCatalog();
    for (const plan of ['pro', 'business'] as const) {
      for (const interval of ['month', 'year'] as const) {
        const priceId = catalog.resolvePriceId(plan, interval);
        expect(catalog.resolvePlanForPrice(priceId)).toEqual({
          plan,
          interval,
        });
      }
    }
  });

  it('returns null for an unknown price so the caller keeps the stored plan', () => {
    // An Enterprise custom price, a price archived during a re-pricing, or a
    // price from another environment sharing the account all land here.
    // Resolving those to `free` would silently un-bill the largest customers.
    expect(buildCatalog().resolvePlanForPrice('price_negotiated')).toBeNull();
  });

  it('returns null for a missing price id', () => {
    expect(buildCatalog().resolvePlanForPrice(null)).toBeNull();
    expect(buildCatalog().resolvePlanForPrice(undefined)).toBeNull();
  });

  it('does not match a price id that is only unconfigured-empty', () => {
    // Guards against resolvePriceId returning null on both sides and an
    // equality check calling that a match, which would map every unknown price
    // to the first plan in the table.
    expect(buildCatalog({}).resolvePlanForPrice('price_pro_month')).toBeNull();
  });
});

describe('PriceCatalog.listPurchasablePlans', () => {
  it('omits a plan whose prices are unconfigured, so the web never offers a 503', () => {
    const catalog = buildCatalog({
      STRIPE_PRICE_PRO_MONTHLY: 'price_pro_month',
    });
    expect(catalog.listPurchasablePlans()).toEqual(['pro']);
  });

  it('is empty when nothing is configured', () => {
    expect(buildCatalog({}).listPurchasablePlans()).toEqual([]);
  });

  it('never offers enterprise, which is quoted rather than self-serve', () => {
    expect(buildCatalog().listPurchasablePlans()).not.toContain('enterprise');
  });
});
