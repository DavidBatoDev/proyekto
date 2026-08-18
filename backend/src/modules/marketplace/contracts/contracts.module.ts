import { Module } from '@nestjs/common';
import { MailModule } from '../../../common/mail/mail.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { ContractPageInitialsService } from './contract-page-initials.service';
import { ContractSignatureLinksController } from './contract-signature-links.controller';
import { ContractSignatureLinksService } from './contract-signature-links.service';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ProjectEconomicsController } from './project-economics.controller';
import { ProjectEconomicsService } from './project-economics.service';
import { QaFixturesModule } from '../../shared/qa-fixtures/qa-fixtures.module';

/**
 * ContractSignatureLinksController is listed FIRST deliberately: it owns the
 * literal `contracts/sign/:token` paths, and ContractsController's
 * `@Get(':id')` (with a ParseUUIDPipe) would otherwise swallow them.
 */
@Module({
  imports: [
    AuthorizationModule,
    FinanceModule,
    NotificationsModule,
    UploadsModule,
    MailModule,
    QaFixturesModule,
  ],
  controllers: [
    ContractSignatureLinksController,
    ContractsController,
    ProjectEconomicsController,
  ],
  providers: [
    ContractsService,
    ContractPageInitialsService,
    ContractSignatureLinksService,
    ProjectEconomicsService,
  ],
  exports: [ContractsService],
})
export class ContractsModule {}
