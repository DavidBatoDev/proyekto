import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  FinanceDocumentKind,
  ImportInvoiceDto,
  ListFinanceDocumentsQueryDto,
  UploadFinanceDocumentDto,
} from './dto/finance-imports.dto';
import { FinanceImportsService } from './finance-imports.service';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Historical finance imports.
 *
 * Deliberately NOT under `/finance`, which is consultant-gated at the class
 * level: recording a project's own past invoices is a project finance action
 * (`finance.manage_invoices`), not a marketplace-consultant one, and the
 * service applies that gate per project.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('finance-imports')
export class FinanceImportsController {
  constructor(private readonly imports: FinanceImportsService) {}

  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike,
    @Body() dto: UploadFinanceDocumentDto,
  ) {
    return this.imports.uploadDocument(user.id, dto.project_id, dto.kind, file);
  }

  @Get('documents')
  listDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceDocumentsQueryDto,
  ) {
    return this.imports.listDocuments(user.id, query.project_id, query.kind);
  }

  @Get('documents/:id')
  getDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.imports.getDocument(user.id, id);
  }

  /**
   * The raw file, for the renderer.
   *
   * `@Res` rather than a returned value: the global ResponseInterceptor wraps
   * everything a controller returns in a JSON envelope, and a PDF is not
   * envelope material.
   */
  @Get('documents/:id/file')
  @Header('Cache-Control', 'private, max-age=300')
  async getDocumentFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const file = await this.imports.getDocumentFile(user.id, id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.fileName)}"`,
    );
    response.send(file.body);
  }

  /** Draft the fields from the document's text. Safe to call again. */
  @Post('documents/:id/read')
  @HttpCode(HttpStatus.OK)
  readDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.imports.readDocument(user.id, id);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.imports.deleteDocument(user.id, id);
  }

  @Post('invoices')
  importInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportInvoiceDto,
  ) {
    return this.imports.importInvoice(user.id, dto);
  }

  @Get('invoices/:invoiceId/snips')
  listInvoiceSnips(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.imports.listInvoiceSnips(user.id, invoiceId);
  }
}

export { FinanceDocumentKind };
