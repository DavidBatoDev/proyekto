import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { EntitlementsCoreModule } from '../../shared/entitlements/entitlements-core.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { PlatformBillingCoreModule } from '../../shared/platform-billing/platform-billing-core.module';
import { UserThrottlerGuard } from '../../../common/guards/user-throttler.guard';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * The organization tier. Imports nothing from teams or projects — they import
 * this — so there is no cycle to break with forwardRef. PlatformBillingCoreModule
 * is safe to import for the same reason: it depends only on Supabase, while the
 * billing controllers that need this module live in PlatformBillingModule.
 * EntitlementsCoreModule follows the same split: the plan-limit checks live
 * there, and the HTTP surface that needs this module is EntitlementsModule.
 */
@Module({
  imports: [
    SupabaseModule,
    NotificationsModule,
    PlatformBillingCoreModule,
    EntitlementsCoreModule,
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, UserThrottlerGuard],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
