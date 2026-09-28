import type { BillingStatus } from '../repositories/platform-billing.repository.interface';
import type {
  BillingInterval,
  PlanForPrice,
  PurchasablePlan,
} from '../plan-catalog';

/**
 * The seam between Proyekto's billing logic and a payment provider.
 *
 * Everything that decides WHAT should happen — the Linear seat model, the
 * owner-only money routes, idempotent webhook claiming, the monotonic write
 * guard, "an unknown price never downgrades", reconciliation — lives in the
 * provider-neutral services and is written once. An adapter only answers HOW a
 * given provider does it: which API call, which proration flag, which
 * signature header, which status spelling.
 *
 * Adding Polar or Paddle means one new class implementing this interface, one
 * line in the registry, and a widening of the `billing_provider` CHECK. No
 * column renames, no data migration, no change to the services — and rows from
 * two providers can coexist while subscribers move between them, because every
 * row records which provider owns its ids.
 */

/** Must match the `billing_provider` CHECK in 20260908120000. */
export type BillingProviderId = 'stripe' | 'polar' | 'paddle';

export const BILLING_PROVIDER_IDS: readonly BillingProviderId[] = [
  'stripe',
  'polar',
  'paddle',
];

export function isBillingProviderId(value: string): value is BillingProviderId {
  return (BILLING_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * How a seat-quantity change is billed. The neutral SeatSyncService chooses
 * one from the Linear policy; each adapter translates it into its own flag.
 *
 *   next_invoice         nothing charged or credited now; the new quantity is
 *                        billed at the next renewal.
 *                        Stripe 'none' · Polar 'next_period' · Paddle 'do_not_bill'
 *   charge_now           the prorated difference is invoiced immediately.
 *                        Stripe 'always_invoice' · Polar 'invoice' ·
 *                        Paddle 'prorated_immediately'
 *   credit_next_invoice  the prorated difference becomes credit against future
 *                        invoices and is NEVER refunded to the card.
 *                        Stripe 'create_prorations' · Polar 'prorate' ·
 *                        Paddle 'prorated_next_billing_period'
 */
export type SeatProration =
  | 'next_invoice'
  | 'charge_now'
  | 'credit_next_invoice';

/** A provider subscription, already translated into Proyekto's vocabulary. */
export interface ProviderSubscription {
  id: string;
  customerId: string | null;
  /**
   * null when the provider reported a status outside the normalized
   * vocabulary. Writing an unrecognised value would violate the status CHECK
   * and fail the whole write, so callers keep the stored status instead.
   */
  status: BillingStatus | null;
  /** The seat line, for providers that model one. See the column comment. */
  seatItemId: string | null;
  priceId: string | null;
  /** The quantity currently being billed. */
  quantity: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialEnd: string | null;
  /** The workspace id stamped on the subscription at checkout, if any. */
  workspaceId: string | null;
}

/** The display-only extras on the billing page. Every field is best-effort. */
export interface ProviderBillingDetails {
  billedQuantity: number | null;
  currency: string | null;
  nextInvoice: {
    amount_due_cents: number;
    currency: string;
    date: string | null;
    is_estimate: boolean;
  } | null;
  paymentMethod: {
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
  } | null;
  latestInvoice: { hosted_url: string | null; status: string | null } | null;
  billingEmail: string | null;
}

/**
 * What a webhook means, independent of which provider sent it. The neutral
 * webhook service switches on `kind`; nothing downstream ever sees a
 * provider-specific event type.
 */
export type BillingEventKind =
  | {
      kind: 'checkout_completed';
      workspaceId: string | null;
      subscriptionId: string | null;
      customerId: string | null;
    }
  /** Created, updated, trial ending: re-read the subscription and project it. */
  | { kind: 'subscription_changed'; subscriptionId: string }
  | {
      kind: 'subscription_ended';
      subscriptionId: string;
      canceledAt: string | null;
    }
  | {
      kind: 'payment_failed';
      customerId: string | null;
      subscriptionId: string | null;
      amountDueCents: number | null;
      currency: string | null;
      invoiceUrl: string | null;
    }
  | {
      kind: 'payment_succeeded';
      customerId: string | null;
      subscriptionId: string | null;
    }
  | { kind: 'dispute_opened'; reference: string }
  /** A verified event this codebase does not act on. Ledgered as ignored. */
  | { kind: 'unhandled' };

export interface ProviderEvent {
  /** The provider's own event id — half of the idempotency key. */
  id: string;
  /** The provider's raw event type, kept for the ledger and for logs. */
  type: string;
  createdAt: string;
  apiVersion: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** The verified payload, stored so the retry sweep can replay it. */
  payload: Record<string, unknown>;
  meaning: BillingEventKind;
}

export interface CheckoutInput {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  /** Reused when the workspace has bought before; the adapter may create one. */
  existingCustomerId: string | null;
  /** A receipt address, never an identity: the customer is the workspace. */
  receiptEmail: string | null;
  priceId: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  /**
   * Set when the adapter created the customer up front (Stripe). Providers that
   * create the customer during checkout (Polar, Paddle) leave it undefined and
   * the completion webhook fills it in.
   */
  customerId?: string;
}

export interface SeatUpdateInput {
  subscriptionId: string;
  seatItemId: string | null;
  quantity: number;
  proration: SeatProration;
}

export interface BillingProvider {
  readonly id: BillingProviderId;

  // ── catalog ────────────────────────────────────────────────────────────
  resolvePriceId(
    plan: PurchasablePlan,
    interval: BillingInterval,
  ): string | null;
  /** null = unrecognised: the caller keeps the stored plan, never "free". */
  resolvePlanForPrice(priceId: string | null | undefined): PlanForPrice | null;
  listPurchasablePlans(): PurchasablePlan[];

  // ── hosted pages ───────────────────────────────────────────────────────
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createPortal(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  // ── subscription state ─────────────────────────────────────────────────
  getSubscription(subscriptionId: string): Promise<ProviderSubscription>;
  getBillingDetails(subscriptionId: string): Promise<ProviderBillingDetails>;
  /**
   * Must be idempotent on the TARGET quantity, so a double-fire — two
   * instances, or a retry after a timeout — never prorates twice.
   */
  updateSeatQuantity(input: SeatUpdateInput): Promise<void>;
  cancelSubscription(subscriptionId: string): Promise<void>;

  // ── webhooks ───────────────────────────────────────────────────────────
  /**
   * Verifies the signature against the untouched request body and translates
   * the event. Throws on a missing body, a missing signature, or a signature
   * that does not verify — this is the endpoint's entire authentication.
   */
  verifyWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent;
  /** Re-translates a payload already verified and stored in the ledger. */
  parseStoredEvent(payload: Record<string, unknown>): ProviderEvent;
}
