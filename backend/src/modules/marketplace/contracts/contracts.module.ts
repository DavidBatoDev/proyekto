import { Module } from '@nestjs/common';
import { MailModule } from '../../../common/mail/mail.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { ContractSignatureLinksController } from './contract-signature-links.controller';
import { ContractSignatureLinksService } from './contract-signature-links.service';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ProjectActivationController } from './project-activation.controller';
import { ProjectActivationService } from './project-activation.service';
import { QaFixturesModule } from '../../shared/qa-fixtures/qa-fixtures.module';

/**
 * Depends on AuthorizationModule rather than the whole ProjectsModule, so
 * ProjectsModule can import THIS module (for the activation gate) without a
 * circular dependency.
 *
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
    ProjectActivationController,
  ],
  providers: [
    ContractsService,
    ContractSignatureLinksService,
    ProjectActivationService,
  ],
  exports: [ContractsService, ProjectActivationService],
})
export class ContractsModule {}
