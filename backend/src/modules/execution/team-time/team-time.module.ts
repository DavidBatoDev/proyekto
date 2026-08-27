import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { EngagementEligibilityModule } from '../../marketplace/finance/eligibility/engagement-eligibility.module';
import { EntitlementGuard } from '../entitlements/entitlement.guard';
import { TeamTimeController } from './team-time.controller';
import { TeamTimeService } from './team-time.service';

@Module({
  imports: [
    SupabaseModule,
    AuthorizationModule,
    NotificationsModule,
    EngagementEligibilityModule,
  ],
  controllers: [TeamTimeController],
  providers: [TeamTimeService, EntitlementGuard],
  exports: [TeamTimeService],
})
export class TeamTimeModule {}
