import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { TimeModule } from '../../execution/time/time.module';
import { EntitlementsCoreModule } from '../../shared/entitlements/entitlements-core.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { QaFixturesModule } from '../../shared/qa-fixtures/qa-fixtures.module';

/**
 * TimeModule supplies TimePolicyService (team timezone, plan subject) and
 * TimeNotificationsService (the amount-free `time_payout_recorded`). It
 * imports no payouts module, so there is no cycle (D25).
 */
@Module({
  imports: [
    SupabaseModule,
    UploadsModule,
    QaFixturesModule,
    EntitlementsCoreModule,
    TimeModule,
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
