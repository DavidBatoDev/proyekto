import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { EntitlementsCoreModule } from '../../shared/entitlements/entitlements-core.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TeamTimeController } from './team-time.controller';
import { TeamTimeService } from './team-time.service';

@Module({
  imports: [
    SupabaseModule,
    AuthorizationModule,
    NotificationsModule,
    WorkspacesModule,
    // The time_tracking plan gate (see assertTimeTrackingPlan).
    EntitlementsCoreModule,
  ],
  controllers: [TeamTimeController],
  providers: [TeamTimeService],
  exports: [TeamTimeService],
})
export class TeamTimeModule {}
