import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  CreateCommentDto,
  CreateEntryDto,
  ListMyEntriesQueryDto,
  MySummaryQueryDto,
  OverviewQueryDto,
  StartEntryDto,
  StopEntryDto,
  UpdateEntryDto,
} from '../dto/entries.dto';
import {
  LoggingForQueryDto,
  parseLoggingForRef,
  PolicyQueryDto,
  PutLoggingForDto,
} from '../dto/logging-for.dto';
import { UpdateTimePreferencesDto } from '../dto/preferences.dto';
import { MyTimesheetsQueryDto } from '../dto/timesheets.dto';
import {
  AllowGuestEmptyShape,
  TimeGuestGuard,
} from '../guards/time-guest.guard';
import { LoggingContextService } from '../logging-context.service';
import { TimeEntriesService } from '../time-entries.service';
import { TimesheetsService } from '../timesheets.service';
import { EMPTY_TIME_OVERVIEW } from '../time.types';
import type {
  CommentRow,
  EntryWithWarnings,
  LoggingForResult,
  MySummary,
  Paged,
  ResolvedTimePolicy,
  SegmentRow,
  TimeEntryView,
  TimeOverview,
  TimesheetSummary,
  UserTimePreferences,
  WorkItemsResult,
} from '../time.types';

/** A malformed id is a miss (404), never a 400 that confirms the route shape. */
const ID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/** `?at=` for the picker: a valid instant, else now. */
function atOrNow(value: string | undefined): Date {
  if (!value) return new Date();
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? new Date() : new Date(ms);
}

/**
 * The person's own time (backend.md "Endpoints", §2.11): the For picker, the timer, manual time, edits, deletes,
 * segments, comments and the `me/*` reads. Misses are 404 (someone else's entry, a project without access).
 * Guests 404 on every route except `me/overview` (the empty shape) and `me/running` (`null`), which every signed-in
 * client polls (D08).
 */
@UseGuards(SupabaseAuthGuard, TimeGuestGuard)
@Controller('time')
export class TimeEntriesController {
  constructor(
    private readonly entries: TimeEntriesService,
    private readonly loggingContext: LoggingContextService,
    private readonly timesheets: TimesheetsService,
  ) {}

  // ── Project pickers ────────────────────────────────────────────────────────────────────────────────────

  /** Who this time can be for (cached 30 s for reads of now, L60). */
  @Get('projects/:projectId/logging-for')
  loggingFor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ID_PIPE) projectId: string,
    @Query() query: LoggingForQueryDto,
  ): Promise<LoggingForResult> {
    return this.loggingContext.resolve(user.id, projectId, {
      at: atOrNow(query.at),
      purpose: 'read',
    });
  }

  /** Remembers the choice (one of the caller's own options, else 422) and answers the picker as it now reads. */
  @Put('projects/:projectId/logging-for')
  async putLoggingFor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ID_PIPE) projectId: string,
    @Body() dto: PutLoggingForDto,
  ): Promise<LoggingForResult> {
    const at = new Date();
    await this.loggingContext.select(user.id, projectId, {
      requested: { kind: dto.logging_for.kind, id: dto.logging_for.id ?? null },
      at,
      purpose: 'manual',
      remember: true,
    });
    return this.loggingContext.resolve(user.id, projectId, {
      at,
      purpose: 'read',
    });
  }

  /** The policy of one of the caller's options (`?for=<kind>:<id>`, `personal:`); unknown options 404. */
  @Get('projects/:projectId/policy')
  projectPolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ID_PIPE) projectId: string,
    @Query() query: PolicyQueryDto,
  ): Promise<ResolvedTimePolicy> {
    return this.loggingContext.policyFor(
      user.id,
      projectId,
      parseLoggingForRef(query.for),
      new Date(),
    );
  }

  /** Tasks and the presets the policy shows (`access.roadmap`, L1). */
  @Get('projects/:projectId/work-items')
  workItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ID_PIPE) projectId: string,
  ): Promise<WorkItemsResult> {
    return this.entries.workItems(user.id, projectId);
  }

  // ── Me ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** ≤ 1 row; guests get `null` (polled by every signed-in client, D08). */
  @Get('me/running')
  @AllowGuestEmptyShape()
  running(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TimeEntryView | null> {
    if (user.is_guest) return Promise.resolve(null);
    return this.entries.getRunning(user.id);
  }

  @Get('me/entries')
  myEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyEntriesQueryDto,
  ): Promise<Paged<TimeEntryView>> {
    return this.entries.listMine(user.id, {
      from: query.from,
      to: query.to,
      project_id: query.project_id,
      for: parseLoggingForRef(query.for),
      page: query.page ?? 1,
      limit: query.limit ?? 100,
    });
  }

  @Get('me/summary')
  mySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MySummaryQueryDto,
  ): Promise<MySummary> {
    return this.entries.mySummary(user.id, { from: query.from, to: query.to });
  }

  /** Guests get the empty shape (D08, E66). */
  @Get('me/overview')
  @AllowGuestEmptyShape()
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OverviewQueryDto,
  ): Promise<TimeOverview> {
    if (user.is_guest) {
      return Promise.resolve({
        ...EMPTY_TIME_OVERVIEW,
        contexts: [],
        workspace_time_admin: [],
      });
    }
    return this.timesheets.overview(user, query.tz);
  }

  @Get('me/preferences')
  getPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserTimePreferences | null> {
    return this.entries.getPreferences(user.id);
  }

  @Put('me/preferences')
  setPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTimePreferencesDto,
  ): Promise<UserTimePreferences> {
    return this.entries.setPreferences(user.id, {
      timezone: dto.timezone,
      week_start: dto.week_start,
    });
  }

  @Get('me/timesheets')
  myTimesheets(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyTimesheetsQueryDto,
  ): Promise<TimesheetSummary[]> {
    return this.timesheets.listMine(user.id, {
      from: query.from,
      to: query.to,
    });
  }

  // ── Entries ────────────────────────────────────────────────────────────────────────────────────────────

  /** 201. A second running timer is 409 TIMER_ALREADY_RUNNING (D07). */
  @Post('entries/start')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartEntryDto,
  ): Promise<EntryWithWarnings> {
    return this.entries.start(user.id, dto, { purpose: 'timer' });
  }

  /** 201. Manual time ("Add time"). */
  @Post('entries')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEntryDto,
  ): Promise<EntryWithWarnings> {
    return this.entries.createManual(user.id, dto, { purpose: 'manual' });
  }

  /** The body must be empty or `{}` (StopEntryDto); never gated. */
  @Post('entries/:id/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    // Declared so the pipe refuses any field: the stop takes no options on /api/time.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() dto: StopEntryDto,
  ): Promise<TimeEntryView> {
    return this.entries.stop(user.id, id);
  }

  @Post('entries/:id/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
  ): Promise<TimeEntryView> {
    return this.entries.pause(user.id, id);
  }

  @Post('entries/:id/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
  ): Promise<TimeEntryView> {
    return this.entries.resume(user.id, id);
  }

  @Get('entries/:id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
  ): Promise<TimeEntryView> {
    return this.entries.get(user.id, id);
  }

  /** `expected_updated_at` is required here (D42); a stale copy is 409 STALE_REVISION. */
  @Patch('entries/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: UpdateEntryDto,
  ): Promise<TimeEntryView> {
    return this.entries.update(user.id, id, dto, { purpose: 'edit' });
  }

  /** 200. A locked entry is 409 TIMESHEET_LOCKED (trg_40). */
  @Delete('entries/:id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
  ): Promise<void> {
    return this.entries.remove(user.id, id);
  }

  @Get('entries/:id/segments')
  segments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
  ): Promise<SegmentRow[]> {
    return this.entries.listSegments(user.id, id);
  }

  @Get('entries/:id/comments')
  comments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
  ): Promise<CommentRow[]> {
    return this.entries.listComments(user.id, id);
  }

  @Post('entries/:id/comments')
  addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentRow> {
    return this.entries.addComment(user.id, id, dto.body);
  }
}
