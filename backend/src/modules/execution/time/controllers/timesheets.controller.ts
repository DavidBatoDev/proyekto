import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  ApprovalsQueryDto,
  ApproveBulkDto,
  TimesheetActionDto,
} from '../dto/timesheets.dto';
import { TimeGuestGuard } from '../guards/time-guest.guard';
import { TimesheetsService } from '../timesheets.service';
import type {
  ApprovalRow,
  Paged,
  TimesheetAction,
  TimesheetDetail,
  TimesheetRow,
} from '../time.types';

/** A malformed id is a miss (404), never a 400 that confirms the route shape. */
const ID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/**
 * Timesheets and the approval queue (§2.11, backend.md "Timesheet State Machine"). Every transition goes through
 * TimesheetsService.act, the only caller of time_timesheet_transition; misses are 404 and guests 404 on every
 * route (D08). Transitions answer 200 with the sheet as it now stands.
 */
@UseGuards(SupabaseAuthGuard, TimeGuestGuard)
@Controller('time')
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  /** Declared before `timesheets/:id` so `approve-bulk` is never read as an id. One RPC: all or none. */
  @Post('timesheets/approve-bulk')
  @HttpCode(HttpStatus.OK)
  approveBulk(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApproveBulkDto,
  ): Promise<TimesheetRow[]> {
    return this.timesheets.approveBulk(user.id, dto);
  }

  @Get('timesheets/:id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
  ): Promise<TimesheetDetail> {
    return this.timesheets.get(user.id, id);
  }

  @Post('timesheets/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: TimesheetActionDto,
  ): Promise<TimesheetRow> {
    return this.one(user, 'submit', id, dto);
  }

  @Post('timesheets/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: TimesheetActionDto,
  ): Promise<TimesheetRow> {
    return this.one(user, 'withdraw', id, dto);
  }

  @Post('timesheets/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: TimesheetActionDto,
  ): Promise<TimesheetRow> {
    return this.one(user, 'approve', id, dto);
  }

  /** A note is required (400 before the RPC when missing, D33). */
  @Post('timesheets/:id/return')
  @HttpCode(HttpStatus.OK)
  returnSheet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: TimesheetActionDto,
  ): Promise<TimesheetRow> {
    return this.one(user, 'return', id, dto);
  }

  /** Decider: approved → returned, note required. Member: own auto/self sheet → open, note optional. */
  @Post('timesheets/:id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: TimesheetActionDto,
  ): Promise<TimesheetRow> {
    return this.one(user, 'reopen', id, dto);
  }

  @Post('timesheets/:id/request-reopen')
  @HttpCode(HttpStatus.OK)
  requestReopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: TimesheetActionDto,
  ): Promise<TimesheetRow> {
    return this.one(user, 'request_reopen', id, dto);
  }

  /** Cross-workspace queue: `submitted` (waiting on the caller) or `decided` (their recent decisions). */
  @Get('approvals')
  queue(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: ApprovalsQueryDto,
  ): Promise<Paged<ApprovalRow>> {
    return this.timesheets.queue(user.id, {
      status: q.status ?? 'submitted',
      since: q.since,
      scope_kind: q.scope_kind,
      page: q.page ?? 1,
      limit: q.limit ?? 50,
    });
  }

  /** Dashboard card and bell badge. */
  @Get('approvals/count')
  count(@CurrentUser() user: AuthenticatedUser): Promise<{ waiting: number }> {
    return this.timesheets.queueCount(user.id);
  }

  private async one(
    user: AuthenticatedUser,
    action: TimesheetAction,
    id: string,
    dto: TimesheetActionDto,
  ): Promise<TimesheetRow> {
    const rows = await this.timesheets.act(
      user.id,
      action,
      [id],
      [dto.expected_revision],
      {
        note: dto.note,
        approveOvertime: action === 'approve' && dto.approve_overtime === true,
      },
    );
    return rows.find((r) => r.id === id) ?? rows[0];
  }
}
