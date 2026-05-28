import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { TeamTimeService } from './team-time.service';
import {
  CreateTimeLogCommentDto,
  CreateManualTimeLogDto,
  ListLogsQueryDto,
  ReviewTimeLogDto,
  ReviewTimeLogsBulkDto,
  StartTimeLogDto,
  StopTimeLogDto,
  UpdateTimeLogDto,
} from './dto/team-time.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('team-time')
export class TeamTimeController {
  constructor(private readonly service: TeamTimeService) {}

  // ─── log mutations ───────────────────────────────────────────────────

  @Post('logs/start')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartTimeLogDto,
  ) {
    return this.service.startLog(user.id, dto);
  }

  @Post('logs/manual')
  manual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateManualTimeLogDto,
  ) {
    return this.service.createManualLog(user.id, dto);
  }

  @Post('logs/review-bulk')
  reviewBulk(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewTimeLogsBulkDto,
  ) {
    return this.service.reviewLogsBulk(user.id, dto);
  }

  @Post('logs/:logId/stop')
  stop(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StopTimeLogDto,
  ) {
    return this.service.stopLog(user.id, logId, dto);
  }

  @Post('logs/:logId/review')
  review(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewTimeLogDto,
  ) {
    return this.service.reviewLog(user.id, logId, dto);
  }

  @Get('logs/:logId/comments')
  listLogComments(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listLogComments(user.id, logId);
  }

  @Post('logs/:logId/comments')
  createLogComment(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTimeLogCommentDto,
  ) {
    return this.service.createLogComment(user.id, logId, dto);
  }

  @Patch('logs/:logId')
  update(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTimeLogDto,
  ) {
    return this.service.updateLog(user.id, logId, dto);
  }

  @Delete('logs/:logId')
  remove(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteLog(user.id, logId);
  }

  @Get('logs/me/running')
  getMyRunningLog(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyRunningLog(user.id);
  }

  @Get('logs/:logId')
  getLog(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getLog(user.id, logId);
  }

  // ─── team-scoped lists & member self-service ─────────────────────────

  @Get('teams/:teamId/my')
  listMyTeamLogs(
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ) {
    return this.service.listMyTeamLogs(user.id, teamId, query);
  }

  @Get('teams/:teamId/projects/:projectId/my-rate')
  myProjectRate(
    @Param('teamId') teamId: string,
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getMyTeamProjectRate(user.id, teamId, projectId);
  }

  @Get('teams/:teamId/projects/:projectId/tasks')
  listTeamProjectTasks(
    @Param('teamId') teamId: string,
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listTeamProjectTasks(user.id, teamId, projectId);
  }

  @Get('teams/:teamId/logs')
  listTeamLogs(
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLogsQueryDto,
  ) {
    return this.service.listTeamLogs(user.id, teamId, query);
  }

  @Get('teams/:teamId/projects')
  listTeamLogProjects(
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listTeamLogProjects(user.id, teamId);
  }

  @Get('teams/:teamId/members')
  listTeamLogMembers(
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listTeamLogMembers(user.id, teamId);
  }
}
