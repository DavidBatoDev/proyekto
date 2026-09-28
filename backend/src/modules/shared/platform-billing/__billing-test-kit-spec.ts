/**
 * Test doubles for the provider-neutral billing services.
 *
 * The neutral specs run against this fake rather than a Stripe mock on
 * purpose: if the services pass against a provider that is not Stripe, they
 * are not quietly depending on Stripe. The Stripe adapter has its own spec
 * (providers/stripe/stripe-billing.provider.spec.ts) for what is Stripe's.
 *
 * Named `-spec.ts`, not `.spec.ts`, deliberately: tsconfig.build.json excludes
 * every file ending in "spec.ts", so these jest globals never reach the
 * production build, while Jest's `.spec.ts` testRegex does not mistake this
 * file for a suite.
 */
import type {
  BillingProvider,
  BillingProviderId,
  ProviderEvent,
  ProviderSubscription,
} from './providers/billing-provider';
import type { WorkspaceSubscriptionRecord } from './repositories/platform-billing.repository.interface';

export function buildRecord(
  overrides: Partial<WorkspaceSubscriptionRecord> = {},
): WorkspaceSubscriptionRecord {
  return {
    workspace_id: 'ws-1',
    plan: 'pro',
    status: 'active',
    seat_limit: null,
    current_period_start: null,
    current_period_end: null,
    billing_provider: 'polar',
    provider_customer_id: 'cus_1',
    provider_subscription_id: 'sub_1',
    provider_subscription_item_id: null,
    provider_price_id: 'price_pro_month',
    billing_interval: 'month',
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    provider_updated_at: null,
    last_provider_event_id: null,
    metadata: {},
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function buildLiveSubscription(
  overrides: Partial<ProviderSubscription> = {},
): ProviderSubscription {
  return {
    id: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    seatItemId: null,
    priceId: 'price_pro_month',
    quantity: 3,
    currentPeriodStart: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEnd: null,
    workspaceId: 'ws-1',
    ...overrides,
  };
}

const PRICES: Record<
  string,
  { plan: 'pro' | 'business'; interval: 'month' | 'year' }
> = {
  price_pro_month: { plan: 'pro', interval: 'month' },
  price_pro_year: { plan: 'pro', interval: 'year' },
  price_business_month: { plan: 'business', interval: 'month' },
  price_business_year: { plan: 'business', interval: 'year' },
};

/**
 * Every member a plain jest.Mock property rather than a method, so specs can
 * assert on `provider.updateSeatQuantity` without tripping unbound-method.
 * Still assignable to BillingProvider wherever the services expect one.
 */
export type FakeProvider = { id: BillingProviderId } & {
  [K in Exclude<keyof BillingProvider, 'id'>]: jest.Mock;
};

/** A non-Stripe provider whose every method is a jest mock. */
export function buildFakeProvider(
  id: BillingProviderId = 'polar',
  live: ProviderSubscription = buildLiveSubscription(),
): FakeProvider {
  return {
    id,
    resolvePriceId: jest.fn(
      (plan: string, interval: string) =>
        Object.entries(PRICES).find(
          ([, v]) => v.plan === plan && v.interval === interval,
        )?.[0] ?? null,
    ),
    resolvePlanForPrice: jest.fn((priceId: string | null | undefined) =>
      priceId ? (PRICES[priceId] ?? null) : null,
    ),
    listPurchasablePlans: jest.fn(() => ['pro', 'business']),
    createCheckout: jest
      .fn()
      .mockResolvedValue({ url: 'https://pay.example/checkout' }),
    createPortal: jest
      .fn()
      .mockResolvedValue({ url: 'https://pay.example/portal' }),
    getSubscription: jest.fn().mockResolvedValue(live),
    getBillingDetails: jest.fn().mockResolvedValue({
      billedQuantity: live.quantity,
      currency: 'usd',
      nextInvoice: null,
      paymentMethod: null,
      latestInvoice: null,
      billingEmail: null,
    }),
    updateSeatQuantity: jest.fn().mockResolvedValue(undefined),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    verifyWebhook: jest.fn(),
    parseStoredEvent: jest.fn(),
  } as unknown as FakeProvider;
}

/** A registry double: one active provider, looked up by id for existing rows. */
export function buildRegistry(...providers: FakeProvider[]) {
  return {
    active: jest.fn(() => providers[0] ?? null),
    get: jest.fn(
      (id: string | null | undefined) =>
        providers.find((provider) => provider.id === id) ?? null,
    ),
  };
}

export function buildEvent(
  meaning: ProviderEvent['meaning'],
  overrides: Partial<ProviderEvent> = {},
): ProviderEvent {
  return {
    id: 'evt_1',
    type: 'test.event',
    createdAt: '2026-09-10T00:00:00.000Z',
    apiVersion: null,
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    payload: { id: 'evt_1' },
    meaning,
    ...overrides,
  };
}
