import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { BillingProviderRegistry } from './providers/billing-provider.registry';
import { stripeClientProvider } from './providers/stripe/stripe.client';
import { SupabasePlatformBillingRepository } from './repositories/platform-billing.repository.supabase';
import { PLATFORM_BILLING_REPOSITORY } from './repositories/platform-billing.repository.interface';
import { SeatSyncService } from './seat-sync.service';

/**
 * The half of platform billing that WorkspacesModule may import.
 *
 * The split exists to keep the dependency graph acyclic without forwardRef:
 * WorkspacesService needs seat sync, and PlatformBillingService needs the
 * workspace authz helpers. Everything the workspaces side needs lives here and
 * depends only on Supabase; the controllers and the webhook/reconcile services live
 * in PlatformBillingModule, which imports both this and WorkspacesModule.
 *
 *   PlatformBillingModule -> WorkspacesModule -> PlatformBillingCoreModule
 */
@Module({
  imports: [SupabaseModule],
  providers: [
    stripeClientProvider,
    BillingProviderRegistry,
    {
      provide: PLATFORM_BILLING_REPOSITORY,
      useClass: SupabasePlatformBillingRepository,
    },
    SeatSyncService,
  ],
  exports: [
    BillingProviderRegistry,
    PLATFORM_BILLING_REPOSITORY,
    SeatSyncService,
  ],
})
export class PlatformBillingCoreModule {}
