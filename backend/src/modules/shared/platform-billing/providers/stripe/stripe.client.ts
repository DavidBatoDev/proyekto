import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

/**
 * The Stripe API version this code was written against.
 *
 * Pinned here rather than inherited from the account default on purpose: the
 * account default can be changed from the Stripe dashboard by anyone with
 * access, and a silent version bump changes response shapes under a running
 * deployment. Upgrading is then a deliberate code change with a diff.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

/**
 * Resolves to `null` when STRIPE_SECRET_KEY is unset, which is the shipped
 * state. BillingProviderRegistry treats null as "Stripe is not configured"
 * rather than throwing, exactly as the Redis client provider does. That is what
 * lets the whole module be registered unconditionally in app.module.ts while
 * still being genuinely inert.
 */
export const stripeClientProvider: Provider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Stripe | null => {
    const logger = new Logger('StripeClient');
    const secretKey = config.get<string>('STRIPE_SECRET_KEY')?.trim();

    if (!secretKey) {
      logger.log('STRIPE_SECRET_KEY is unset — platform billing is inert.');
      return null;
    }

    logger.log(
      `Stripe client initialised (api ${STRIPE_API_VERSION}, ${
        secretKey.startsWith('sk_live') ? 'LIVE' : 'test'
      } mode).`,
    );

    return new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
      // Well inside the 25s RequestTimeoutInterceptor, so a slow Stripe call
      // surfaces as our own handled failure rather than a truncated response.
      timeout: 8_000,
      maxNetworkRetries: 2,
      telemetry: false,
      appInfo: { name: 'Proyekto' },
    });
  },
};
