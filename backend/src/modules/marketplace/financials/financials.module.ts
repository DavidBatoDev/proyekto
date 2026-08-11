import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { FinancialsController } from './financials.controller';
import { FinancialsService } from './financials.service';

/**
 * Reads revenue/cost straight from Supabase via the service-role client and
 * gates on project role, so it only needs AuthorizationModule — no dependency on
 * the invoices/team-time/payouts modules (which would pull in a wider graph).
 */
@Module({
  imports: [FinanceModule],
  controllers: [FinancialsController],
  providers: [FinancialsService],
})
export class FinancialsModule {}
