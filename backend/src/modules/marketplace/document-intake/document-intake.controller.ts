import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  DocumentIntakeService,
  type UploadedIntakeFile,
} from './document-intake.service';
import {
  CreateIntakeBatchDto,
  CreateIntakeRelationshipDto,
  RereadIntakeFieldDto,
  SplitIntakeDocumentDto,
  UpdateIntakeClausesDto,
  UpdateIntakeDocumentDto,
  UpdateIntakeFieldDto,
  UpdateIntakeRelationshipDto,
} from './dto/document-intake.dto';
import { IntakeReplicateService } from './intake-replicate.service';

/**
 * Document intake: bring the paper behind work that started outside
 * Proyekto (contracts, amendments, invoices, receipts) into Proyekto.
 * docs/13-proposals/document-intake.md
 *
 * An intake is private to the person who started it. The model's reading is
 * a draft; records are created only by replicate, after a person confirms
 * every document.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('intake')
export class DocumentIntakeController {
  constructor(
    private readonly intake: DocumentIntakeService,
    private readonly replicator: IntakeReplicateService,
  ) {}

  @Post('batches')
  createBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateIntakeBatchDto,
  ) {
    return this.intake.createBatch(user.id, dto);
  }

  @Get('batches')
  listBatches(@CurrentUser() user: AuthenticatedUser) {
    return this.intake.listBatches(user.id);
  }

  /** Acquisition metrics. Platform admins only. */
  @Get('metrics')
  @UseGuards(AdminGuard)
  metrics() {
    return this.intake.metrics();
  }

  @Get('batches/:id')
  getBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intake.getBatch(user.id, id);
  }

  /** Many files at once: PDFs, phone photos, scans. */
  @Post('batches/:id/files')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: UploadedIntakeFile[],
  ) {
    return this.intake.uploadFiles(user.id, id, files);
  }

  /** Propose relationships and match payments to invoices. */
  @Post('batches/:id/group')
  @HttpCode(HttpStatus.OK)
  group(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intake.group(user.id, id);
  }

  @Post('batches/:id/relationships')
  createRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateIntakeRelationshipDto,
  ) {
    return this.intake.createRelationship(user.id, id, dto.counterparty_name);
  }

  @Get('documents/:id/file')
  @Header('Cache-Control', 'private, max-age=300')
  async file(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.intake.documentFile(user.id, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.fileName)}"`,
    );
    res.send(file.body);
  }

  @Post('documents/:id/classify')
  @HttpCode(HttpStatus.OK)
  classify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intake.classify(user.id, id);
  }

  @Post('documents/:id/extract')
  @HttpCode(HttpStatus.OK)
  extract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intake.extract(user.id, id);
  }

  @Post('documents/:id/reread')
  @HttpCode(HttpStatus.OK)
  reread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RereadIntakeFieldDto,
  ) {
    return this.intake.reread(user.id, id, dto);
  }

  @Patch('documents/:id')
  updateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntakeDocumentDto,
  ) {
    return this.intake.updateDocument(user.id, id, dto);
  }

  @Patch('documents/:id/fields')
  updateField(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntakeFieldDto,
  ) {
    return this.intake.updateField(user.id, id, dto);
  }

  @Patch('documents/:id/clauses')
  updateClauses(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntakeClausesDto,
  ) {
    return this.intake.updateClauses(user.id, id, dto);
  }

  @Post('documents/:id/split')
  split(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SplitIntakeDocumentDto,
  ) {
    return this.intake.split(user.id, id, dto.at_page);
  }

  @Post('documents/:id/merge/:withId')
  merge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('withId', ParseUUIDPipe) withId: string,
  ) {
    return this.intake.merge(user.id, id, withId);
  }

  @Post('documents/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intake.confirm(user.id, id);
  }

  @Patch('relationships/:id')
  updateRelationship(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntakeRelationshipDto,
  ) {
    return this.intake.updateRelationship(user.id, id, dto);
  }

  /** Create the Proyekto records for one confirmed relationship. */
  @Post('relationships/:id/replicate')
  @HttpCode(HttpStatus.OK)
  replicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.replicator.replicate(user.id, id);
  }
}
