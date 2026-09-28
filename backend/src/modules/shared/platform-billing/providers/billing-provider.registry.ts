import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import {
  isBillingProviderId,
  type BillingProvider,
  type BillingProviderId,
} from './billing-provider';
import { StripeBillingProvider } from './stripe/stripe-billing.provider';
import { STRIPE_CLIENT } from './stripe/stripe.client';

/**
 * Which payment providers this deployment can talk to, and which one sells.
 *
 * Two questions, deliberately separate:
 *
 *   active()   the provider NEW checkouts go through — BILLING_PROVIDER, default
 *              'stripe'. null when that provider is not configured, which is
 *              what "billing is off on this environment" means.
 *   get(id)    the provider that owns an EXISTING row's ids. A workspace that
 *              subscribed through Stripe keeps syncing seats and receiving
 *              webhooks through Stripe even after BILLING_PROVIDER moves to
 *              Polar, so switching providers never strands a paying customer.
 *
 * A provider is "configured" when its credentials are present. There is no
 * feature flag: an environment without a key simply has no provider.
 */
@Injectable()
export class BillingProviderRegistry {
  private readonly logger = new Logger(BillingProviderRegistry.name);
  private readonly providers = new Map<BillingProviderId, BillingProvider>();
  private readonly activeId: BillingProviderId;

  constructor(
    config: ConfigService,
    @Inject(STRIPE_CLIENT) stripe: Stripe | null,
  ) {
    if (stripe) {
      this.providers.set('stripe', new StripeBillingProvider(stripe, config));
    }
    // Polar / Paddle adapters register here, each behind its own credentials.

    const requested =
      config.get<string>('BILLING_PROVIDER')?.trim() || 'stripe';
    if (!isBillingProviderId(requested)) {
      throw new Error(
        `BILLING_PROVIDER "${requested}" is not a known provider.`,
      );
    }
    this.activeId = requested;
    if (!this.providers.has(requested)) {
      this.logger.log(
        `Billing provider "${requested}" is not configured — checkout is unavailable.`,
      );
    }
  }

  /** The provider new subscriptions are sold through, or null when off. */
  active(): BillingProvider | null {
    return this.providers.get(this.activeId) ?? null;
  }

  /** The provider that owns a row's ids, or null when it is not configured. */
  get(id: string | null | undefined): BillingProvider | null {
    if (!id || !isBillingProviderId(id)) return null;
    return this.providers.get(id) ?? null;
  }
}
