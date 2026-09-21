import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../../config/supabase.module';
import { EngagementEligibilityService } from './engagement-eligibility.service';

/**
 * Deliberately dependency-free (Supabase only), so both execution modules
 * (team-time's timer gate) and marketplace modules (finance books, payouts)
 * can import the one contract-engagement predicate without cycles.
 */
@Module({
  imports: [SupabaseModule],
  providers: [EngagementEligibilityService],
  exports: [EngagementEligibilityService],
})
export class EngagementEligibilityModule {}
