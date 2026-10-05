import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { FinancialsController } from './financials.controller';
import { FinancialsService } from './financials.service';

/**
 * Reads revenue/cost straight from Supabase via the service-role client and
 * gates on project role. Everything it injects comes through FinanceModule
 * (ConsultantFinanceAccessService, and EngagementsService re-exported from
 * EngagementsCoreModule) — no dependency on the invoices, time or payouts
 * modules (which would pull in a wider graph).
 */
@Module({
  imports: [FinanceModule],
  controllers: [FinancialsController],
  providers: [FinancialsService],
})
export class FinancialsModule {}
