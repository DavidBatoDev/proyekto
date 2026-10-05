import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceCompositionService } from './invoice-composition.service';
import { InvoiceSchedulerService } from './invoice-scheduler.service';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { ContractsModule } from '../contracts/contracts.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { FinanceModule } from '../finance/finance.module';
import { QaFixturesModule } from '../../shared/qa-fixtures/qa-fixtures.module';
import { EngagementsCoreModule } from '../engagements/engagements-core.module';
import { TimeModule } from '../../execution/time/time.module';

/**
 * InvoiceCompositionService reads engagement scope and rates through EngagementsCoreModule (D25: never
 * EngagementsModule) and the contract's policy timezone through TimeModule's TimePolicyService. TimeModule
 * imports none of the invoice or finance modules, so there is no cycle.
 */
@Module({
  imports: [
    AuthorizationModule,
    NotificationsModule,
    ContractsModule,
    UploadsModule,
    FinanceModule,
    QaFixturesModule,
    EngagementsCoreModule,
    TimeModule,
  ],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoiceCompositionService,
    InvoiceSchedulerService,
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
