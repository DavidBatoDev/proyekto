import { Module } from '@nestjs/common';
import { ProfileImportController } from './profile-import.controller';
import { ProfileImportService } from './profile-import.service';
import { CvExtractorService } from './services/cv-extractor.service';
import { PdfjsLoaderService } from './services/pdfjs-loader.service';
import { PdfTextExtractorService } from './services/pdf-text-extractor.service';

/**
 * Kept separate from ProfileModule: this one drags in pdfjs and an OpenAI
 * call path, and ProfileModule is already the largest controller surface in
 * the app.
 */
@Module({
  controllers: [ProfileImportController],
  providers: [
    ProfileImportService,
    PdfTextExtractorService,
    PdfjsLoaderService,
    CvExtractorService,
  ],
  // The pdf text layer is reused by the finance import workspace, which reads
  // uploaded invoices; the loader travels with it because the extractor holds
  // the only reference to it.
  exports: [ProfileImportService, PdfTextExtractorService, PdfjsLoaderService],
})
export class ProfileImportModule {}
