import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  RoadmapAiCommitDto,
  RoadmapAiContextChildrenQueryDto,
  RoadmapAiContextTasksAssignedQueryDto,
  RoadmapAiContextFeaturesQueryDto,
  RoadmapAiContextResolutionChildrenQueryDto,
  RoadmapAiContextSearchQueryDto,
  RoadmapAiDiscardDto,
  RoadmapAiPreviewDto,
  RoadmapAiRollbackDto,
} from '../dto/roadmap-ai.dto';
import { RoadmapAiService } from '../services/roadmap-ai.service';

@Controller('roadmaps/:id/ai')
@UseGuards(SupabaseAuthGuard)
export class RoadmapAiController {
  constructor(private readonly roadmapAiService: RoadmapAiService) {}

  @Post('preview')
  preview(
    @Param('id') roadmapId: string,
    @Body() dto: RoadmapAiPreviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.preview(roadmapId, dto, user.id);
  }

  @Get('previews/:previewId')
  getPreview(
    @Param('id') roadmapId: string,
    @Param('previewId') previewId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getPreview(roadmapId, previewId, user.id);
  }

  @Get('context/summary')
  getContextSummary(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getContextSummary(roadmapId, user.id);
  }

  @Get('context/actor')
  getContextActor(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getContextActor(roadmapId, user.id);
  }

  @Get('context/search')
  searchContextNodes(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.searchContextNodes(roadmapId, query, user.id);
  }

  @Get('context/nodes/:nodeId')
  getContextNodeDetails(
    @Param('id') roadmapId: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getContextNodeDetails(roadmapId, nodeId, user.id);
  }

  @Get('context/nodes/:nodeId/children')
  getContextNodeChildren(
    @Param('id') roadmapId: string,
    @Param('nodeId') nodeId: string,
    @Query() query: RoadmapAiContextChildrenQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getContextNodeChildren(roadmapId, nodeId, query, user.id);
  }

  @Get('context/resolutions/:resolutionId/children')
  getContextResolutionChildren(
    @Param('id') roadmapId: string,
    @Param('resolutionId') resolutionId: string,
    @Query() query: RoadmapAiContextResolutionChildrenQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getContextChildrenFromResolution(
      roadmapId,
      resolutionId,
      query,
      user.id,
    );
  }

  @Get('context/features')
  getContextFeatures(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextFeaturesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getContextFeatures(roadmapId, query, user.id);
  }

  @Get('context/tasks-assigned-to-me')
  getContextTasksAssignedToMe(
    @Param('id') roadmapId: string,
    @Query() query: RoadmapAiContextTasksAssignedQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.getContextTasksAssignedToMe(
      roadmapId,
      query,
      user.id,
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
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  rollback(
    @Param('id') roadmapId: string,
    @Body() dto: RoadmapAiRollbackDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.rollback(roadmapId, dto, user.id);
  }
}
