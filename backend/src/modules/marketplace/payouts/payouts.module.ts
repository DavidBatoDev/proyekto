import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { QaFixturesModule } from '../../shared/qa-fixtures/qa-fixtures.module';
import { WorkspacesModule } from '../../execution/workspaces/workspaces.module';

@Module({
  imports: [
    SupabaseModule,
    NotificationsModule,
    UploadsModule,
    QaFixturesModule,
    WorkspacesModule,
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
