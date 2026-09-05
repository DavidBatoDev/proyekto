import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { RoadmapAiProjectMeetingsQueryDto } from '../roadmaps/dto/roadmap-ai-project-context.dto';
import {
  AiContextChangesQueryDto,
  AiContextKnowledgeSearchQueryDto,
  AiContextOverviewQueryDto,
  AiContextResolveRefsDto,
  AiContextRoadmapsQueryDto,
  AiContextSearchQueryDto,
  AiContextTasksQueryDto,
} from './dto/ai-context.dto';
import { AiContextService } from './services/ai-context.service';
import { AiContextKnowledgeService } from './services/ai-context-knowledge.service';
import { AiContextProjectService } from './services/ai-context-project.service';
import { AiContextRefsService } from './services/ai-context-refs.service';

/**
 * The user-scoped AI context family: what the caller can reach across every
 * roadmap, project, team and workspace. Consumed by the Python agent (as the
 * user, bearer forwarded) for workspace-scope sessions; the roadmap-keyed
 * `/roadmaps/:id/ai/context/*` family stays for the in-roadmap assistant.
 * Every denial is a 404 - this surface never confirms that something exists.
 */
@Controller('ai/context')
@UseGuards(SupabaseAuthGuard)
export class AiContextController {
  constructor(
    private readonly aiContextService: AiContextService,
    private readonly refsService: AiContextRefsService,
    private readonly knowledgeService: AiContextKnowledgeService,
    private readonly projectService: AiContextProjectService,
  ) {}

  @Get('actor')
  getActor(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.aiContextService.getActor(user.id, traceId);
  }

  @Get('overview')
  getOverview(
    @Query() query: AiContextOverviewQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.aiContextService.getOverview(user, query, traceId);
  }

  @Get('roadmaps')
  listRoadmaps(
    @Query() query: AiContextRoadmapsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.aiContextService.listRoadmaps(user.id, query, traceId);
  }

  @Get('search')
  search(
    @Query() query: AiContextSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.aiContextService.search(user.id, query, traceId);
  }

  @Get('tasks')
  listTasks(
    @Query() query: AiContextTasksQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.aiContextService.listTasks(user.id, query, traceId);
  }

  @Get('knowledge-search')
  searchKnowledge(
    @Query() query: AiContextKnowledgeSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.knowledgeService.search(user, query, traceId);
  }

  @Post('resolve-refs')
  @HttpCode(HttpStatus.OK)
  resolveRefs(
    @Body() dto: AiContextResolveRefsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.refsService.resolve(user.id, dto, traceId);
  }

  @Get('projects/:projectId')
  getProjectContext(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectService.getContext(projectId, user.id, traceId);
  }

  @Get('projects/:projectId/brief')
  getProjectBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectService.getBrief(projectId, user.id, traceId);
  }

  @Get('projects/:projectId/resources')
  getProjectResources(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectService.getResources(projectId, user.id, traceId);
  }

  @Get('projects/:projectId/meetings')
  getProjectMeetings(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: RoadmapAiProjectMeetingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectService.getMeetings(projectId, user.id, query, traceId);
  }

  @Get('projects/:projectId/members')
  listProjectMembers(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectService.listMembers(projectId, user.id, traceId);
  }

  @Get('projects/:projectId/members/:memberId')
  getProjectMemberDetails(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectService.getMemberDetails(
      projectId,
      memberId,
      user.id,
      traceId,
    );
  }

  @Get('changes')
  listChanges(
    @Query() query: AiContextChangesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.aiContextService.listChanges(user.id, query, traceId);
  }
}
