import { Module } from '@nestjs/common';
import { AgentInternalClient } from '../../../common/agent/agent-internal.client';
import { ProjectsModule } from '../../execution/projects/projects.module';
import { EntitlementsCoreModule } from '../../shared/entitlements/entitlements-core.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { ContractsModule } from '../contracts/contracts.module';
import { FinanceImportsModule } from '../finance-imports/finance-imports.module';
import { ProfileImportModule } from '../profile-import/profile-import.module';
import { DocumentIntakeController } from './document-intake.controller';
import { DocumentIntakeService } from './document-intake.service';
import { IntakeReplicateService } from './intake-replicate.service';

/**
 * Document intake (docs/13-proposals/document-intake.md). Builds on finance
 * imports (finance_documents, importInvoice) and off-platform adoption
 * (recorded agreements); the model calls run on the agent service.
 */
@Module({
  imports: [
    UploadsModule,
    ProfileImportModule,
    EntitlementsCoreModule,
    ContractsModule,
    FinanceImportsModule,
    ProjectsModule,
  ],
  controllers: [DocumentIntakeController],
  providers: [
    DocumentIntakeService,
    IntakeReplicateService,
    AgentInternalClient,
  ],
})
export class DocumentIntakeModule {}
