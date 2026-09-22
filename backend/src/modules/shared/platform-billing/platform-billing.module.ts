import { Module } from '@nestjs/common';
import { CronSecretGuard } from '../../../common/guards/cron-secret.guard';
import { WorkspacesModule } from '../../execution/workspaces/workspaces.module';
import { EntitlementsCoreModule } from '../entitlements/entitlements-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingReconcileService } from './billing-reconcile.service';
import { PlatformBillingCoreModule } from './platform-billing-core.module';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingWebhookService } from './billing-webhook.service';
import { PlatformBillingService } from './platform-billing.service';
import { WorkspaceBillingController } from './workspace-billing.controller';

/**
 * Proyekto's own subscription billing.
 *
 * Named platform-billing rather than billing because "billing" already means
 * *contract billing period* across the marketplace modules
 * (marketplace/contracts/billing-period.ts) — money the client owes the
 * consultant, not money the workspace owes Proyekto.
 *
 * The module is split so the graph stays acyclic without forwardRef:
 * PlatformBillingCoreModule (Supabase only) holds seat sync and is imported by
 * WorkspacesModule; this module imports both and holds the HTTP surface.
 *
 * Provider-neutral: the payment provider sits behind BillingProvider
 * (providers/billing-provider.ts), and Stripe is only the first adapter.
 *
 * Registered unconditionally. With no provider credentials configured the
 * registry has no active provider and every path early-returns, so there is no
 * flag branching in app.module.ts.
 *
 * EntitlementsCoreModule (Supabase only) supplies the effective plan: every
 * provider write drops the workspace's cached plan state, and checkout refuses
 * to sell a plan a complimentary one already covers.
 */
@Module({
  imports: [
    PlatformBillingCoreModule,
    WorkspacesModule,
    NotificationsModule,
    EntitlementsCoreModule,
  ],
  controllers: [WorkspaceBillingController, BillingWebhookController],
  providers: [
    PlatformBillingService,
    BillingWebhookService,
    BillingReconcileService,
    CronSecretGuard,
  ],
  exports: [PlatformBillingService],
})
export class PlatformBillingModule {}
