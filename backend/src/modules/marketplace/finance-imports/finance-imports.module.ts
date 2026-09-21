import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ProfileImportModule } from '../profile-import/profile-import.module';
import { UploadsModule } from '../../shared/uploads/uploads.module';
import { FinanceImportsController } from './finance-imports.controller';
import { FinanceImportsService } from './finance-imports.service';
import { InvoiceReaderService } from './invoice-reader.service';

/**
 * Kept out of InvoicesModule: this one drags in pdfjs and an OpenAI call path
 * for reading uploaded documents, and the invoice lifecycle should not have to
 * carry those to issue a native invoice.
 */
@Module({
  imports: [FinanceModule, InvoicesModule, ProfileImportModule, UploadsModule],
  controllers: [FinanceImportsController],
  providers: [FinanceImportsService, InvoiceReaderService],
  exports: [FinanceImportsService],
})
export class FinanceImportsModule {}
