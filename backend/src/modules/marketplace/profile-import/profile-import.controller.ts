import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { ImportedProfileDto } from './dto/imported-profile.dto';
import {
  ProfileImportService,
  type UploadedPdf,
} from './profile-import.service';

/**
 * Parse and apply are two calls on purpose: the user reviews and edits the
 * draft in between, so `apply` must take the edited version rather than
 * re-reading the file.
 */
@Controller('profile/import')
@UseGuards(SupabaseAuthGuard)
export class ProfileImportController {
  constructor(private readonly importService: ProfileImportService) {}

  /**
   * No body DTO here. The global ValidationPipe runs `forbidNonWhitelisted`,
   * which would reject multer's own multipart fields — the existing
   * `POST /uploads/file` sidesteps it the same way.
   *
   * Throttled harder than a normal route: each call runs a PDF parser and may
   * spend an OpenAI call on an arbitrary upload.
   */
  @Post('parse')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  parse(@UploadedFile() file: UploadedPdf): Promise<ImportedProfileDto> {
    return this.importService.parse(file);
  }

  @Post('apply')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() draft: ImportedProfileDto,
  ) {
    return this.importService.apply(user.id, draft);
  }
}
