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
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  CreateRoadmapAiMessageDto,
  CreateRoadmapAiSessionDto,
  ListRoadmapAiMessagesQueryDto,
  ListRoadmapAiSessionsQueryDto,
  UpdateRoadmapAiSessionDto,
} from '../dto/roadmap-ai-sessions.dto';
import { RoadmapAiSessionsService } from '../services/roadmap-ai-sessions.service';

@Controller('roadmaps/:id/ai-sessions')
@UseGuards(SupabaseAuthGuard)
export class RoadmapAiSessionsController {
  constructor(
    private readonly sessionsService: RoadmapAiSessionsService,
  ) {}

  @Get()
  list(
    @Param('id') roadmapId: string,
    @Query() query: ListRoadmapAiSessionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.list(roadmapId, user.id, query);
  }

  @Post()
  create(
    @Param('id') roadmapId: string,
    @Body() dto: CreateRoadmapAiSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.create(roadmapId, user.id, dto);
  }

  @Get(':sessionId')
  getOne(
    @Param('id') roadmapId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.getById(roadmapId, sessionId, user.id);
  }

  @Patch(':sessionId')
  update(
    @Param('id') roadmapId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateRoadmapAiSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.update(roadmapId, sessionId, user.id, dto);
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') roadmapId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sessionsService.delete(roadmapId, sessionId, user.id);
  }

  @Get(':sessionId/messages')
  listMessages(
    @Param('id') roadmapId: string,
    @Param('sessionId') sessionId: string,
    @Query() query: ListRoadmapAiMessagesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.listMessages(
      roadmapId,
      sessionId,
      user.id,
      query,
    );
  }

  @Post(':sessionId/messages')
  @HttpCode(HttpStatus.CREATED)
  appendMessage(
    @Param('id') roadmapId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateRoadmapAiMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessionsService.appendMessage(
      roadmapId,
      sessionId,
      user.id,
      dto,
    );
  }
}
