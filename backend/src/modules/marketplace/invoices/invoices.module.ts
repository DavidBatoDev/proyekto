import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceCompositionService } from './invoice-composition.service';
import { InvoiceSchedulerService } from './invoice-scheduler.service';
import { ProjectsModule } from '../../execution/projects/projects.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { ContractsModule } from '../contracts/contracts.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { FinanceModule } from '../finance/finance.module';
import { QaFixturesModule } from '../../shared/qa-fixtures/qa-fixtures.module';

@Module({
  imports: [
    ProjectsModule,
    NotificationsModule,
    ContractsModule,
    UploadsModule,
    FinanceModule,
    QaFixturesModule,
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
