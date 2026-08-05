import { Module } from '@nestjs/common';
import { ConsultantFinanceAccessService } from './consultant-finance-access.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [ConsultantFinanceAccessService, FinanceService],
  exports: [ConsultantFinanceAccessService],
})
export class FinanceModule {}
