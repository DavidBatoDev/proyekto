import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RawResponse } from '../../../../common/decorators/raw-response.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { AuditExportQueryDto, ReportQueryDto } from '../dto/reports.dto';
import { TimeGuestGuard } from '../guards/time-guest.guard';
import { TimeReportsService } from '../time-reports.service';
import type {
  ExportFile,
  Paged,
  ReportSummary,
  TimeEntryView,
} from '../time.types';

/**
 * Time reports by scope (`?scope=team|project|workspace|engagement:<id>`, backend.md "Endpoints"). The service
 * runs each scope's authority query; a scope the caller may not read is a 404. Exports are file downloads, so
 * @RawResponse() + @Res() bypass the global `{ data }` envelope. Guests 404 on every route (D08).
 */
@UseGuards(SupabaseAuthGuard, TimeGuestGuard)
@Controller('time/reports')
export class TimeReportsController {
  constructor(private readonly reports: TimeReportsService) {}

  @Get('entries')
  entries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
  ): Promise<Paged<TimeEntryView>> {
    return this.reports.entries(user.id, query);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
  ): Promise<ReportSummary> {
    return this.reports.summary(user.id, query);
  }

  /** `time_reports_export` on the scope's plan subject. */
  @Get('export')
  @RawResponse()
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    send(res, await this.reports.export(user.id, query));
  }

  /** `time_audit_export`: timesheet events and policy changes of one workspace. */
  @Get('audit-export')
  @RawResponse()
  async auditExport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    send(res, await this.reports.auditExport(user.id, query));
  }
}

function send(res: Response, file: ExportFile): void {
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'Content-Length': String(file.body.length),
    'Cache-Control': 'no-store',
  });
  res.send(file.body);
}
