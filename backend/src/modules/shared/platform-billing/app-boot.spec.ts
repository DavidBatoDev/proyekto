import './__boot-env';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../app.module';
import { BillingProviderRegistry } from './providers/billing-provider.registry';
import { STRIPE_CLIENT } from './providers/stripe/stripe.client';
import { PLATFORM_BILLING_REPOSITORY } from './repositories/platform-billing.repository.interface';
import { SeatSyncService } from './seat-sync.service';
import { PlatformBillingService } from './platform-billing.service';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingReconcileService } from './billing-reconcile.service';

/**
 * Compiles the REAL AppModule.
 *
 * Billing introduced the one dependency shape that a unit test cannot catch: a
 * potential cycle between WorkspacesModule (which needs seat sync) and
 * PlatformBillingModule (which needs the workspace authz helpers). The split
 * into PlatformBillingCoreModule is what keeps the graph acyclic, and nothing
 * except an actual container compile proves it stayed that way.
 *
 * It also pins the unconfigured contract: with no provider credentials the
 * registry has no active provider rather than a half-configured one.
 */
describe('AppModule wiring — platform billing', () => {
  jest.setTimeout(60_000);

  it('compiles with the billing modules registered and no dependency cycle', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(SeatSyncService, { strict: false })).toBeDefined();
    expect(
      moduleRef.get(PlatformBillingService, { strict: false }),
    ).toBeDefined();
    expect(
      moduleRef.get(BillingWebhookService, { strict: false }),
    ).toBeDefined();
    expect(
      moduleRef.get(BillingReconcileService, { strict: false }),
    ).toBeDefined();
    expect(
      moduleRef.get(PLATFORM_BILLING_REPOSITORY, { strict: false }),
    ).toBeDefined();

    await moduleRef.close();
  });

  it('has no active billing provider when no credentials are configured', async () => {
    // No key means every billing path early-returns and nothing can reach a
    // provider, with no flag branching in app.module.ts.
    delete process.env.STRIPE_SECRET_KEY;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(STRIPE_CLIENT, { strict: false })).toBeNull();
    expect(
      moduleRef.get(BillingProviderRegistry, { strict: false }).active(),
    ).toBeNull();

    await moduleRef.close();
  });
});
