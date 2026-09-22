import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import type { BillingStatus } from '../../repositories/platform-billing.repository.interface';
import {
  PriceCatalog,
  type BillingInterval,
  type PlanForPrice,
  type PurchasablePlan,
} from '../../plan-catalog';
import type {
  BillingEventKind,
  BillingProvider,
  CheckoutInput,
  CheckoutResult,
  ProviderBillingDetails,
  ProviderEvent,
  ProviderSubscription,
  SeatProration,
  SeatUpdateInput,
} from '../billing-provider';

/**
 * The neutral seat policy, spelled in Stripe.
 *
 * - next_invoice → 'none': Stripe records the new quantity and raises no
 *   invoice item, so the next invoice simply bills the new number.
 * - charge_now → 'always_invoice': invoice the prorated difference now. Plain
 *   'create_prorations' would park it until the next renewal — up to a year.
 * - credit_next_invoice → 'create_prorations': leave a negative pending item
 *   that offsets the next invoice. NOT 'always_invoice', which on a decrease
 *   attempts a credit note or refund to the card.
 */
export const STRIPE_PRORATION: Record<
  SeatProration,
  Stripe.SubscriptionItemUpdateParams.ProrationBehavior
> = {
  next_invoice: 'none',
  charge_now: 'always_invoice',
  credit_next_invoice: 'create_prorations',
};

/** Stripe's subscription statuses that already match the normalized set. */
const KNOWN_STATUSES: readonly string[] = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
];

export class StripeBillingProvider implements BillingProvider {
  readonly id = 'stripe' as const;
  private readonly logger = new Logger(StripeBillingProvider.name);
  private readonly catalog: PriceCatalog;

  constructor(
    private readonly stripe: Stripe,
    private readonly config: ConfigService,
  ) {
    this.catalog = new PriceCatalog(config, 'STRIPE');
  }

  // ── catalog ────────────────────────────────────────────────────────────

  resolvePriceId(
    plan: PurchasablePlan,
    interval: BillingInterval,
  ): string | null {
    return this.catalog.resolvePriceId(plan, interval);
  }

  resolvePlanForPrice(priceId: string | null | undefined): PlanForPrice | null {
    return this.catalog.resolvePlanForPrice(priceId);
  }

  listPurchasablePlans(): PurchasablePlan[] {
    return this.catalog.listPurchasablePlans();
  }

  // ── hosted pages ───────────────────────────────────────────────────────

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const customerId =
      input.existingCustomerId ?? (await this.createCustomer(input));

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: input.priceId,
          quantity: input.quantity,
          // Seats are derived from membership, never hand-edited at checkout.
          adjustable_quantity: { enabled: false },
        },
      ],
      // Both, because the webhook resolves a workspace from either and
      // client_reference_id survives on the session while metadata rides the
      // subscription for every later event.
      client_reference_id: input.workspaceId,
      subscription_data: { metadata: { workspace_id: input.workspaceId } },
      allow_promotion_codes: true,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });

    if (!session.url) {
      throw new ServiceUnavailableException(
        'Stripe did not return a checkout URL.',
      );
    }
    return { url: session.url, customerId };
  }

  /**
   * One Stripe Customer per workspace, bound by metadata.workspace_id and an
   * idempotency key, so two owners racing to check out share one customer.
   */
  private async createCustomer(input: CheckoutInput): Promise<string> {
    const customer = await this.stripe.customers.create(
      {
        name: input.workspaceName,
        email: input.receiptEmail ?? undefined,
        metadata: {
          workspace_id: input.workspaceId,
          workspace_slug: input.workspaceSlug,
        },
      },
      { idempotencyKey: `workspace-customer:${input.workspaceId}` },
    );
    return customer.id;
  }

  async createPortal(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  // ── subscription state ─────────────────────────────────────────────────

  async getSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const subscription = await this.stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ['items.data.price'] },
    );
    const item = subscription.items.data[0];
    return {
      id: subscription.id,
      customerId: idOf(subscription.customer),
      status: KNOWN_STATUSES.includes(subscription.status)
        ? (subscription.status as BillingStatus)
        : null,
      seatItemId: item?.id ?? null,
      priceId: item?.price?.id ?? null,
      quantity: item?.quantity ?? null,
      currentPeriodStart: toIso(item?.current_period_start),
      currentPeriodEnd: toIso(item?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      canceledAt: toIso(subscription.canceled_at),
      trialEnd: toIso(subscription.trial_end),
      workspaceId: subscription.metadata?.workspace_id ?? null,
    };
  }

  async getBillingDetails(
    subscriptionId: string,
  ): Promise<ProviderBillingDetails> {
    const subscription = await this.stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ['default_payment_method', 'latest_invoice', 'customer'] },
    );

    const customer = subscription.customer;
    const invoice = subscription.latest_invoice;
    const details: ProviderBillingDetails = {
      billedQuantity: subscription.items.data[0]?.quantity ?? null,
      currency: subscription.currency ?? null,
      nextInvoice: null,
      paymentMethod: extractCard(subscription.default_payment_method),
      latestInvoice:
        invoice && typeof invoice !== 'string'
          ? {
              hosted_url: invoice.hosted_invoice_url ?? null,
              status: invoice.status ?? null,
            }
          : null,
      billingEmail:
        customer && typeof customer !== 'string' && !customer.deleted
          ? (customer.email ?? null)
          : null,
    };

    // The upcoming-invoice preview is the only honest source for "what you will
    // pay next": it already accounts for coupons, tax and pending prorations,
    // none of which a seats x list-price multiplication can see.
    try {
      const upcoming = await this.stripe.invoices.createPreview({
        subscription: subscriptionId,
      });
      details.nextInvoice = {
        amount_due_cents: upcoming.amount_due,
        currency: upcoming.currency,
        date: toIso(upcoming.next_payment_attempt ?? upcoming.period_end),
        is_estimate: true,
      };
    } catch (error: unknown) {
      this.logger.debug(
        `No upcoming invoice preview for ${subscriptionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return details;
  }

  async updateSeatQuantity(input: SeatUpdateInput): Promise<void> {
    if (!input.seatItemId) {
      throw new Error(
        `Stripe subscription ${input.subscriptionId} has no seat item to update.`,
      );
    }
    await this.stripe.subscriptionItems.update(
      input.seatItemId,
      {
        quantity: input.quantity,
        proration_behavior: STRIPE_PRORATION[input.proration],
      },
      // Keyed on the target state, not the attempt, so a double-fire is a
      // no-op instead of a second proration.
      { idempotencyKey: `seat-sync:${input.seatItemId}:${input.quantity}` },
    );
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
  }

  // ── webhooks ───────────────────────────────────────────────────────────

  verifyWebhook(
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'STRIPE_WEBHOOK_SECRET is not configured.',
      );
    }
    // A missing raw body means the bootstrap regressed (main.ts must create the
    // app with `rawBody: true`). Fail loudly rather than quietly accepting an
    // unverifiable payload.
    if (!rawBody) {
      throw new BadRequestException(
        'Raw request body unavailable; webhook signatures cannot be verified.',
      );
    }
    const header = headers['stripe-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header.');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (error: unknown) {
      throw new BadRequestException(
        `Stripe signature verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return translateStripeEvent(event);
  }

  parseStoredEvent(payload: Record<string, unknown>): ProviderEvent {
    return translateStripeEvent(payload as unknown as Stripe.Event);
  }
}

/** Exported for the adapter spec. Pure: a Stripe event in, a neutral event out. */
export function translateStripeEvent(event: Stripe.Event): ProviderEvent {
  const object = event.data.object as unknown as Record<string, unknown>;
  const customerId = idOf(object.customer as never);
  const subscriptionId = event.type.startsWith('customer.subscription.')
    ? typeof object.id === 'string'
      ? object.id
      : null
    : idOf(object.subscription as never);

  return {
    id: event.id,
    type: event.type,
    createdAt: new Date(event.created * 1000).toISOString(),
    apiVersion: event.api_version ?? null,
    customerId,
    subscriptionId,
    payload: event as unknown as Record<string, unknown>,
    meaning: meaningOf(event, customerId, subscriptionId),
  };
}

function meaningOf(
  event: Stripe.Event,
  customerId: string | null,
  subscriptionId: string | null,
): BillingEventKind {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      return {
        kind: 'checkout_completed',
        workspaceId:
          session.client_reference_id ?? session.metadata?.workspace_id ?? null,
        subscriptionId: idOf(session.subscription),
        customerId,
      };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.trial_will_end':
      return {
        kind: 'subscription_changed',
        subscriptionId: event.data.object.id,
      };
    case 'customer.subscription.deleted':
      return {
        kind: 'subscription_ended',
        subscriptionId: event.data.object.id,
        canceledAt: toIso(event.data.object.canceled_at),
      };
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      return {
        kind: 'payment_failed',
        customerId,
        subscriptionId,
        amountDueCents: invoice.amount_due ?? null,
        currency: invoice.currency ?? null,
        invoiceUrl: invoice.hosted_invoice_url ?? null,
      };
    }
    case 'invoice.payment_succeeded':
      return { kind: 'payment_succeeded', customerId, subscriptionId };
    case 'charge.dispute.created':
      return {
        kind: 'dispute_opened',
        reference: `${event.data.object.id} on charge ${
          idOf(event.data.object.charge) ?? 'unknown'
        }`,
      };
    default:
      return { kind: 'unhandled' };
  }
}

function extractCard(
  paymentMethod: string | Stripe.PaymentMethod | null | undefined,
): ProviderBillingDetails['paymentMethod'] {
  if (!paymentMethod || typeof paymentMethod === 'string') return null;
  const card = paymentMethod.card;
  if (!card) return null;
  return {
    brand: card.brand ?? null,
    last4: card.last4 ?? null,
    exp_month: card.exp_month ?? null,
    exp_year: card.exp_year ?? null,
  };
}

/** Stripe fields are `string | Expandable<T> | null` depending on expansion. */
function idOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : (value.id ?? null);
}

function toIso(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number'
    ? new Date(seconds * 1000).toISOString()
    : null;
}
