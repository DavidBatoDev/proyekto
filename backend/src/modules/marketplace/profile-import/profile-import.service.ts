import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { ImportedProfileDto } from './dto/imported-profile.dto';
import { detectLinkedIn, parseLinkedIn } from './lib/linkedin-parser';
import { CvExtractorService } from './services/cv-extractor.service';
import { PdfTextExtractorService } from './services/pdf-text-extractor.service';

export interface ImportCounts {
  skills_created: number;
  skills_linked: number;
  languages: number;
  experiences: number;
  educations: number;
  certifications: number;
}

export interface UploadedPdf {
  buffer: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

@Injectable()
export class ProfileImportService {
  private readonly logger = new Logger(ProfileImportService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly pdfText: PdfTextExtractorService,
    private readonly cvExtractor: CvExtractorService,
  ) {}

  /**
   * Reads an uploaded PDF into a draft. Writes nothing.
   *
   * The file is parsed in memory and discarded — it is never uploaded to a
   * bucket. A CV is dense personal data with no product use once read, so
   * storing it would be pure liability.
   */
  async parse(file: UploadedPdf | undefined): Promise<ImportedProfileDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file was uploaded.');
    }
    if ((file.size ?? file.buffer.length) > MAX_BYTES) {
      throw new BadRequestException('That file is larger than 10 MB.');
    }

    const doc = await this.pdfText.extract(file.buffer);
    const detection = detectLinkedIn(doc);
    this.logger.log(
      `import detect: score=${detection.score} linkedin=${detection.isLinkedIn} (${detection.reasons.join('; ')})`,
    );

    if (detection.isLinkedIn) {
      // Deterministic, local, and free — nothing leaves the server.
      return parseLinkedIn(doc);
    }
    return this.cvExtractor.extract(doc.plainText);
  }

  /**
   * Applies the draft the user reviewed.
   *
   * One RPC, one transaction. See 20260820100100 for why this is not a series
   * of per-row endpoint calls.
   */
  async apply(
    userId: string,
    draft: ImportedProfileDto,
  ): Promise<ImportCounts> {
    const payload = {
      basics: draft.basics ?? {},
      skills: draft.skills ?? [],
      languages: draft.languages ?? [],
      experiences: draft.experiences ?? [],
      educations: draft.educations ?? [],
      certifications: draft.certifications ?? [],
      specialization: draft.specialization ?? {},
    };

    const { data, error } = (await this.supabase.rpc(
      'import_talent_profile',
      { p_user_id: userId, p_payload: payload },
    )) as { data: ImportCounts | null; error: { message: string } | null };

    if (error) {
      this.logger.error(`import_talent_profile failed: ${error.message}`);
      throw new BadRequestException(
        'We could not save your profile. Please try again.',
      );
    }

    return (
      data ?? {
        skills_created: 0,
        skills_linked: 0,
        languages: 0,
        experiences: 0,
        educations: 0,
        certifications: 0,
      }
    );
  }
}
