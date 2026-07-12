import {
  Body,
  Controller,
  Delete,
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
import {
  RoadmapAiCommitDto,
  RoadmapAiContextPreviewSelectorQueryDto,
  RoadmapAiContextChildrenQueryDto,
  RoadmapAiContextTasksAssignedQueryDto,
  RoadmapAiContextTasksFilterQueryDto,
  RoadmapAiContextFeaturesQueryDto,
  RoadmapAiContextResolutionChildrenQueryDto,
  RoadmapAiContextResolveQueryDto,
  RoadmapAiContextSearchQueryDto,
  RoadmapAiDiscardDto,
  RoadmapAiPreviewDto,
  RoadmapAiRollbackDto,
} from '../dto/roadmap-ai.dto';
import { RoadmapAiService } from '../services/roadmap-ai.service';
import { RoadmapAiMemoriesService } from '../services/roadmap-ai-memories.service';
import { CreateRoadmapAiMemoryDto } from '../dto/roadmap-ai-memories.dto';
import {
  RoadmapAiKnowledgeSearchQueryDto,
  RoadmapAiRelevantMemoriesQueryDto,
} from '../dto/roadmap-ai-knowledge.dto';
import { RoadmapAiKnowledgeService } from '../services/roadmap-ai-knowledge.service';
import { RoadmapAiProjectMeetingsQueryDto } from '../dto/roadmap-ai-project-context.dto';
import { RoadmapAiProjectContextService } from '../services/roadmap-ai-project-context.service';

@Controller('roadmaps/:id/ai')
@UseGuards(SupabaseAuthGuard)
export class RoadmapAiController {
  constructor(
    private readonly roadmapAiService: RoadmapAiService,
    private readonly memoriesService: RoadmapAiMemoriesService,
    private readonly projectContextService: RoadmapAiProjectContextService,
    private readonly knowledgeService: RoadmapAiKnowledgeService,
  ) {}

  @Post('preview')
  preview(
    @Param('id') roadmapId: string,
    @Body() dto: RoadmapAiPreviewDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.preview(roadmapId, dto, user.id, traceId);
  }

  @Get('previews/:previewId')
  getPreview(
    @Param('id') roadmapId: string,
    @Param('previewId') previewId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getPreview(
      roadmapId,
      previewId,
      user.id,
      traceId,
    );
  }

  @Get('context/summary')
  getContextSummary(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextPreviewSelectorQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextSummary(
      roadmapId,
      query,
      user.id,
      traceId,
    );
  }

  @Get('context/actor')
  getContextActor(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextActor(roadmapId, user.id, traceId);
  }

  @Get('context/project')
  getProjectContext(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectContextService.getProjectContext(
      roadmapId,
      user.id,
      traceId,
    );
  }

  @Get('context/project/brief')
  getProjectBrief(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectContextService.getProjectBrief(
      roadmapId,
      user.id,
      traceId,
    );
  }

  @Get('context/project/resources')
  getProjectResources(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectContextService.getProjectResources(
      roadmapId,
      user.id,
      traceId,
    );
  }

  @Get('context/project/meetings')
  getProjectMeetings(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiProjectMeetingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectContextService.getProjectMeetings(
      roadmapId,
      user.id,
      query,
      traceId,
    );
  }

  @Get('context/project/members/:memberId')
  getProjectMemberDetails(
    @Param('id') roadmapId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.projectContextService.getMemberDetails(
      roadmapId,
      memberId,
      user.id,
      traceId,
    );
  }

  @Get('memories')
  async listMemories(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return { memories: await this.memoriesService.list(roadmapId, user.id) };
  }

  @Get('memories/relevant')
  relevantMemories(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiRelevantMemoriesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.memoriesService.relevant(
      roadmapId,
      user.id,
      query.query,
      query.limit ?? 8,
    );
  }

  @Get('context/knowledge-search')
  searchKnowledge(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiKnowledgeSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.knowledgeService.searchKnowledge(
      roadmapId,
      user,
      query,
      traceId,
    );
  }

  @Post('memories')
  createMemory(
    @Param('id') roadmapId: string,
    @Body() dto: CreateRoadmapAiMemoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.memoriesService.create(roadmapId, user.id, dto);
  }

  @Delete('memories/:memoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgetMemory(
    @Param('id') roadmapId: string,
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.memoriesService.deactivate(roadmapId, memoryId, user.id);
  }

  @Get('context/members')
  getContextMembers(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextMembers(roadmapId, user.id, traceId);
  }

  @Get('context/resolve')
  resolveContext(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextResolveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.resolveContext(
      roadmapId,
      query,
      user.id,
      traceId,
    );
  }

  @Get('context/search')
  searchContextNodes(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.searchContextNodes(
      roadmapId,
      query,
      user.id,
      traceId,
    );
  }

  @Get('context/nodes/:nodeId')
  getContextNodeDetails(
    @Param('id') roadmapId: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextNodeDetails(
      roadmapId,
      nodeId,
      user.id,
      traceId,
    );
  }

  @Get('context/nodes/:nodeId/children')
  getContextNodeChildren(
    @Param('id') roadmapId: string,
    @Param('nodeId') nodeId: string,
    @Query() query: RoadmapAiContextChildrenQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextNodeChildren(
      roadmapId,
      nodeId,
      query,
      user.id,
      traceId,
    );
  }

  @Get('context/resolutions/:resolutionId/children')
  getContextResolutionChildren(
    @Param('id') roadmapId: string,
    @Param('resolutionId') resolutionId: string,
    @Query() query: RoadmapAiContextResolutionChildrenQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextChildrenFromResolution(
      roadmapId,
      resolutionId,
      query,
      user.id,
      traceId,
    );
  }

  @Get('context/features')
  getContextFeatures(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextFeaturesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextFeatures(
      roadmapId,
      query,
      user.id,
      traceId,
    );
  }

  @Get('context/tasks-assigned-to-me')
  getContextTasksAssignedToMe(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextTasksAssignedQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextTasksAssignedToMe(
      roadmapId,
      query,
      user.id,
      traceId,
    );
  }

  @Get('context/tasks')
  getContextTasksFiltered(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextTasksFilterQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.roadmapAiService.getContextTasksFiltered(
      roadmapId,
      query,
      user.id,
      traceId,
    );
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @Param('id') roadmapId: string,
    @Body() dto: RoadmapAiCommitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.commit(roadmapId, dto, user.id);
  }

  @Post('discard')
  @HttpCode(HttpStatus.OK)
  discard(
    @Param('id') roadmapId: string,
    @Body() dto: RoadmapAiDiscardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.discard(roadmapId, dto, user.id);
  }

  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  rollback(
    @Param('id') roadmapId: string,
    @Body() dto: RoadmapAiRollbackDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.rollback(roadmapId, dto, user.id);
  }
}
