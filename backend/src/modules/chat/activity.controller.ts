import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { ChatService } from './chat.service';
import { ActivityQueryDto } from './dto/chat.dto';

/**
 * Project-wide activity timeline (dispute-resolution history). Served by
 * ChatService (which owns AuditService + authorization); the timeline spans
 * chat, access, and — as those domains land — scope/file/decision events.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/activity')
export class ActivityController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ActivityQueryDto,
  ) {
    return this.chatService.listActivity(projectId, user.id, {
      limit: query.limit,
      offset: query.offset,
    });
  }
}
