import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RawResponse } from '../../../../common/decorators/raw-response.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { FinanceExportQueryDto } from './dto/finance-export.dto';
import { FinanceExportService } from './finance-export.service';

/**
 * Finance-book file exports. Like the rest of the book surface, no consultant
 * gate — authorization is the per-book `export` capability resolved in the
 * service. Binary body, so @RawResponse() + @Res() bypass the global `{ data }`
 * envelope entirely.
 */
@Controller('finance-books')
@UseGuards(SupabaseAuthGuard)
export class FinanceExportController {
  constructor(private readonly exports: FinanceExportService) {}

  @Get(':bookId/export')
  @RawResponse()
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Query() query: FinanceExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.exports.export(user.id, bookId, {
      kind: query.kind,
      format: query.format,
      from: query.from,
      to: query.to,
    });
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.buffer.length),
      'Cache-Control': 'no-store',
    });
    res.send(file.buffer);
  }
}
