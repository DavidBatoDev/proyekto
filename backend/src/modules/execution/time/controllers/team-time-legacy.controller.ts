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
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Public } from '../../../../common/decorators/public.decorator';
import { CronSecretGuard } from '../../../../common/guards/cron-secret.guard';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  CreateManualTimeLogDto,
  CreateTimeLogCommentDto,
  ListLogsQueryDto,
  StartTimeLogDto,
  StopTimeLogDto,
  UpdateTimeLogDto,
} from '../dto/legacy-team-time.dto';
import type { UpdateEntryInput } from '../dto/entries.dto';
import {
  AllowGuestEmptyShape,
  TimeGuestGuard,
} from '../guards/time-guest.guard';
import {
  AliasRoute,
  AliasTelemetryInterceptor,
} from '../legacy/alias-telemetry.interceptor';
import {
  toLegacyComment,
  toLegacySegment,
} from '../legacy/team-time-legacy.mapper';
import { TeamTimeLegacyService } from '../legacy/team-time-legacy.service';
import type {
  LegacyComment,
  LegacyContractStatus,
  LegacyHealResult,
  LegacyListResult,
  LegacyLogsSummary,
  LegacyMember,
  LegacyProject,
  LegacyProjectTaskOption,
  LegacySegment,
  LegacyTaskTimeLog,
} from '../legacy/team-time-legacy.types';
import { TimeEntriesService } from '../time-entries.service';
import { ALIAS_REVIEW_GONE_MESSAGE, timeError } from '../time-errors';
import { isNativeOrigin } from '../time-request';
import type { TimeEntryView } from '../time.types';

/** CC13: a malformed id is a miss (404), never the old raw 22P02 500. */
const ID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/**
 * The `/api/team-time` routes, kept for the deployed web and old OTA bundles until the web PR ships (blueprint
 * §4). Every route the old controller served, in its declaration order, with today's request DTOs and response
 * shapes; per-log review answers 410 (approvals happen by timesheet). Writes go through TimeEntriesService with
 * `purpose: 'alias'` (D44: never 409 LOGGING_FOR_REQUIRED) and the caller's origin (D06 copy); every write
 * response is re-read through the legacy Row builder (CC13). Guests 404 everywhere except `logs/me/running`
 * (`null`, D08). No entitlement guard: reads are never plan-gated and writes are gated by the For resolver (R6).
 * Registered in TimeModule by P17.
 */
@UseGuards(SupabaseAuthGuard, TimeGuestGuard)
@UseInterceptors(AliasTelemetryInterceptor)
@Controller('team-time')
export class TeamTimeLegacyController {
  constructor(
    private readonly entries: TimeEntriesService,
    private readonly legacy: TeamTimeLegacyService,
  ) {}

  /** Retired repair pass (D02): Scheduler-only, cron secret, always `{ scanned: 0, healed: 0 }`. */
  @Post('cron/heal-orphaned-logs')
  @Public()
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  @AliasRoute('cron.heal')
  healOrphanedLogs(): LegacyHealResult {
    return { scanned: 0, healed: 0 };
  }

  // ── log mutations ──────────────────────────────────────────────────────────────────────────────────────

  /** #1. 400 RUNNING_TIMER_MESSAGE on a second timer (D07); 403 NO_LOGGING_CONTEXT; 409 locked (D06). */
  @Post('logs/start')
  @AliasRoute('logs.start')
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartTimeLogDto,
    @Req() req: Request,
  ): Promise<LegacyTaskTimeLog> {
    const view = await this.entries.start(
      user.id,
      { project_id: dto.project_id, task_id: dto.task_id ?? null },
      { purpose: 'alias', native: isNativeOrigin(req) },
    );
    return this.ownRow(view);
  }

  /** #2. `break_minutes` becomes `break_seconds` in the service (D43). */
  @Post('logs/manual')
  @AliasRoute('logs.manual')
  async manual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateManualTimeLogDto,
    @Req() req: Request,
  ): Promise<LegacyTaskTimeLog> {
    const view = await this.entries.createManual(
      user.id,
      {
        project_id: dto.project_id,
        task_id: dto.task_id ?? null,
        started_at: dto.started_at,
        ended_at: dto.ended_at,
        ...(dto.break_minutes !== undefined
          ? { break_minutes: dto.break_minutes }
          : {}),
      },
      { purpose: 'alias', native: isNativeOrigin(req) },
    );
    return this.ownRow(view);
  }

  /** #3. 410: approvals happen by timesheet. No `@Body()`, so the pipe cannot 400 an old body first (R7). */
  @Post('logs/review-bulk')
  @AliasRoute('logs.review_bulk')
  reviewBulk(@Req() req: Request): never {
    throw this.reviewGone(req);
  }

  /** #4. Still accepts the old `ended_at` and `break_minutes` (stored break wins). */
  @Post('logs/:logId/stop')
  @AliasRoute('logs.stop')
  async stop(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StopTimeLogDto,
    @Req() req: Request,
  ): Promise<LegacyTaskTimeLog> {
    const view = await this.entries.stop(user.id, logId, {
      ...(dto.ended_at !== undefined ? { endedAt: dto.ended_at } : {}),
      ...(dto.break_minutes !== undefined
        ? { breakMinutes: dto.break_minutes }
        : {}),
      alias: { native: isNativeOrigin(req) },
    });
    return this.ownRow(view);
  }

  @Post('logs/:logId/pause')
  @AliasRoute('logs.pause')
  async pause(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyTaskTimeLog> {
    return this.ownRow(await this.entries.pause(user.id, logId));
  }

  @Post('logs/:logId/resume')
  @AliasRoute('logs.resume')
  async resume(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyTaskTimeLog> {
    return this.ownRow(await this.entries.resume(user.id, logId));
  }

  /** #7. 410 as #3; the id is not parsed, so every old call gets the same answer. */
  @Post('logs/:logId/review')
  @AliasRoute('logs.review')
  review(@Req() req: Request): never {
    throw this.reviewGone(req);
  }

  /** #8. Team managers read team-context detail (D49). */
  @Get('logs/:logId/segments')
  @AliasRoute('logs.segments')
  async listLogSegments(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacySegment[]> {
    const rows = await this.entries.listSegments(user.id, logId);
    return rows.map(toLegacySegment);
  }

  @Get('logs/:logId/comments')
  @AliasRoute('logs.comments')
  async listLogComments(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyComment[]> {
    const rows = await this.entries.listComments(user.id, logId);
    return rows.map(toLegacyComment);
  }

  /** #10. Trims; empty after trim → 400 "Comment body cannot be empty." (old behaviour); notifies (D29). */
  @Post('logs/:logId/comments')
  @AliasRoute('logs.comment_add')
  async createLogComment(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTimeLogCommentDto,
  ): Promise<LegacyComment> {
    return toLegacyComment(
      await this.entries.addComment(user.id, logId, dto.body),
    );
  }

  /** #11. A task on another project moves the entry (resolver, purpose `alias`); locked → 409 (D06). */
  @Patch('logs/:logId')
  @AliasRoute('logs.update')
  async update(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTimeLogDto,
    @Req() req: Request,
  ): Promise<LegacyTaskTimeLog> {
    const input: UpdateEntryInput = {};
    if (dto.task_id !== undefined) input.task_id = dto.task_id;
    if (dto.started_at !== undefined) input.started_at = dto.started_at;
    if (dto.ended_at !== undefined) input.ended_at = dto.ended_at;
    if (dto.break_minutes !== undefined) {
      input.break_minutes = dto.break_minutes;
    }
    const view = await this.entries.update(user.id, logId, input, {
      purpose: 'alias',
      native: isNativeOrigin(req),
    });
    return this.ownRow(view);
  }

  /** #12. 200 with no body (`{ data: undefined }`, as today); locked → 409 (D06). */
  @Delete('logs/:logId')
  @AliasRoute('logs.delete')
  remove(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.entries.remove(user.id, logId, {
      alias: true,
      native: isNativeOrigin(req),
    });
  }

  /** #13. Declared before `GET logs/:logId`. Always 200: a row or `null`; guests `null` (D08). */
  @Get('logs/me/running')
  @AllowGuestEmptyShape()
  @AliasRoute('logs.running')
  async getMyRunningLog(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyTaskTimeLog | null> {
    if (user.is_guest) return null;
    const view = await this.entries.getRunning(user.id);
    return view ? this.ownRow(view) : null;
  }

  /** #14 (D34): personal entries member-only, else can_view_timesheet or a team manager (D49); misses 404. */
  @Get('logs/:logId')
  @AliasRoute('logs.get')
  async getLog(
    @Param('logId', ID_PIPE) logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyTaskTimeLog> {
    const view = await this.entries.get(user.id, logId);
    const [row] = await this.legacy.rows([view], { cost: true });
    return row;
  }

  // ── team-scoped lists & member self-service ────────────────────────────────────────────────────────────

  @Get('teams/:teamId/my')
  @AliasRoute('teams.my')
  listMyTeamLogs(
    @Param('teamId', ID_PIPE) teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    return this.legacy.listTeamMine(user.id, teamId, query);
  }

  @Get('teams/:teamId/my/summary')
  @AliasRoute('teams.my_summary')
  myTeamLogsSummary(
    @Param('teamId', ID_PIPE) teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    return this.legacy.teamMineSummary(user.id, teamId, query);
  }

  /** #17 (D45): no caller; kept so it never 404s. */
  @Get('teams/:teamId/projects/:projectId/my-rate')
  @AliasRoute('teams.my_rate')
  myProjectRate(
    // Parsed so a malformed id is a 404 like every other alias route; the answer never depends on them.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Param('teamId', ID_PIPE) _teamId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Param('projectId', ID_PIPE) _projectId: string,
  ): null {
    return null;
  }

  @Get('teams/:teamId/projects/:projectId/tasks')
  @AliasRoute('teams.tasks')
  listTeamProjectTasks(
    @Param('teamId', ID_PIPE) teamId: string,
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyProjectTaskOption[]> {
    return this.legacy.teamTasks(user.id, teamId, projectId);
  }

  @Get('teams/:teamId/logs')
  @AliasRoute('teams.logs')
  listTeamLogs(
    @Param('teamId', ID_PIPE) teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    return this.legacy.listTeam(user.id, teamId, query);
  }

  @Get('teams/:teamId/logs/summary')
  @AliasRoute('teams.logs_summary')
  teamLogsSummary(
    @Param('teamId', ID_PIPE) teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    return this.legacy.teamSummary(user.id, teamId, query);
  }

  @Get('teams/:teamId/projects')
  @AliasRoute('teams.projects')
  listTeamLogProjects(
    @Param('teamId', ID_PIPE) teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyProject[]> {
    return this.legacy.teamProjects(user.id, teamId);
  }

  @Get('teams/:teamId/members')
  @AliasRoute('teams.members')
  listTeamLogMembers(
    @Param('teamId', ID_PIPE) teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyMember[]> {
    return this.legacy.teamMembers(user.id, teamId);
  }

  // ── project-scoped lists ───────────────────────────────────────────────────────────────────────────────

  /** #23 (D01): `{ enforcement: 'off', engagement_status: 'engaged' }` after the project access check. */
  @Get('projects/:projectId/contract-status')
  @AliasRoute('projects.contract_status')
  getProjectContractStatus(
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyContractStatus> {
    return this.legacy.contractStatus(user.id, projectId);
  }

  @Get('projects/:projectId/my')
  @AliasRoute('projects.my')
  listMyProjectLogs(
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    return this.legacy.listProjectMine(user.id, projectId, query);
  }

  @Get('projects/:projectId/my/summary')
  @AliasRoute('projects.my_summary')
  myProjectLogsSummary(
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    return this.legacy.projectMineSummary(user.id, projectId, query);
  }

  @Get('projects/:projectId/logs')
  @AliasRoute('projects.logs')
  listProjectLogs(
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    return this.legacy.listProject(user.id, projectId, query);
  }

  @Get('projects/:projectId/logs/summary')
  @AliasRoute('projects.logs_summary')
  projectLogsSummary(
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    return this.legacy.projectSummary(user.id, projectId, query);
  }

  @Get('projects/:projectId/members')
  @AliasRoute('projects.members')
  listProjectLogMembers(
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyMember[]> {
    return this.legacy.projectMembers(user.id, projectId);
  }

  /** #29 (D35): tasks only, the old flat shape; `access.roadmap` else 404. */
  @Get('projects/:projectId/tasks')
  @AliasRoute('projects.tasks')
  async listProjectTasks(
    @Param('projectId', ID_PIPE) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegacyProjectTaskOption[]> {
    return (await this.entries.workItems(user.id, projectId)).tasks;
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────────────

  /** A write result or the running timer: the caller's own entry, re-read through the Row builder (CC13). */
  private async ownRow(view: TimeEntryView): Promise<LegacyTaskTimeLog> {
    const [row] = await this.legacy.rows([view], { cost: true, write: true });
    return row;
  }

  /** 410 TIMESHEETS_REPLACED_REVIEW with origin-aware copy (D06). */
  private reviewGone(req: Request) {
    return timeError(
      'TIMESHEETS_REPLACED_REVIEW',
      ALIAS_REVIEW_GONE_MESSAGE(isNativeOrigin(req)),
    );
  }
}
