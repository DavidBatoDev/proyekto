import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  type AiSessionScope,
  CreateRoadmapAiMessageDto,
  CreateRoadmapAiSessionDto,
  ListRoadmapAiMessagesQueryDto,
  ListRoadmapAiSessionsQueryDto,
  UpdateRoadmapAiSessionAgentStateDto,
  UpdateRoadmapAiSessionDto,
} from '../dto/roadmap-ai-sessions.dto';
import { RoadmapAiSessionsService } from '../services/roadmap-ai-sessions.service';

const workspaceScope = (workspaceId: string): AiSessionScope => ({
  kind: 'workspace',
  workspaceId,
});

/**
 * Workspace-scoped AI threads (the dashboard assistant). The same 8 routes,
 * DTOs, and status codes as `RoadmapAiSessionsController`, keyed on a
 * workspace instead of a roadmap. Lives in RoadmapsModule because the thread
 * store and its service are shared; the service answers 404 (never 403) for a
 * workspace the caller is not a member of, matching the AI context family.
 */
@Controller('workspaces/:id/ai-sessions')
@UseGuards(SupabaseAuthGuard)
export class WorkspaceAiSessionsController {
  constructor(private readonly sessionsService: RoadmapAiSessionsService) {}

  @Get()
  list(
    @Param('id') workspaceId: string,
    @Query() query: ListRoadmapAiSessionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.list(
      workspaceScope(workspaceId),
      user.id,
      query,
    );
  }

  @Post()
  create(
    @Param('id') workspaceId: string,
    @Body() dto: CreateRoadmapAiSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.create(
      workspaceScope(workspaceId),
      user.id,
      dto,
    );
  }

  @Get(':sessionId')
  getOne(
    @Param('id') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.getById(
      workspaceScope(workspaceId),
      sessionId,
      user.id,
    );
  }

  @Patch(':sessionId')
  update(
    @Param('id') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateRoadmapAiSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.update(
      workspaceScope(workspaceId),
      sessionId,
      user.id,
      dto,
    );
  }

  @Put(':sessionId/agent-state')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateAgentState(
    @Param('id') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateRoadmapAiSessionAgentStateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.sessionsService.updateAgentState(
      workspaceScope(workspaceId),
      sessionId,
      user.id,
      dto.agent_state,
    );
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sessionsService.delete(
      workspaceScope(workspaceId),
      sessionId,
      user.id,
    );
  }

  @Get(':sessionId/messages')
  listMessages(
    @Param('id') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Query() query: ListRoadmapAiMessagesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.listMessages(
      workspaceScope(workspaceId),
      sessionId,
      user.id,
      query,
    );
  }

  @Post(':sessionId/messages')
  @HttpCode(HttpStatus.CREATED)
  appendMessage(
    @Param('id') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateRoadmapAiMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.appendMessage(
      workspaceScope(workspaceId),
      sessionId,
      user.id,
      dto,
    );
  }
}
