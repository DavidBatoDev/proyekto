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
  exports: [ProfileImportService],
})
export class ProfileImportModule {}
