import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { ConsultantFinanceAccessService } from './consultant-finance-access.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { TeamFinanceAccessService } from './team-finance-access.service';
import { TeamFinanceController } from './team-finance.controller';
import { TeamFinanceService } from './team-finance.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [FinanceController, TeamFinanceController],
  providers: [
    ConsultantFinanceAccessService,
    FinanceService,
    TeamFinanceAccessService,
    TeamFinanceService,
  ],
  exports: [ConsultantFinanceAccessService, TeamFinanceAccessService],
})
export class FinanceModule {}
