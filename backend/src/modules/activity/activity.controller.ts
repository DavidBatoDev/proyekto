import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { ActivityService } from './activity.service';
import { ListProjectActivityQueryDto } from './dto/activity.dto';

/**
 * Project-wide activity timeline — the dispute-resolution history that backs
 * the project Logs page. Spans roadmap edits, membership and access changes,
 * chat-channel administration, and MCP connector writes.
 *
 * Previously served from the chat module (an accident of where AuditService
 * was first injected); it lives here now, but the URL is unchanged.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProjectActivityQueryDto,
  ) {
    return this.activityService.list(projectId, user.id, query);
  }
}
