import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { RoadmapCommentSummaryService } from '../services/roadmap-comment-summary.service';

/**
 * Roadmap-scoped because the canvas decorates every card at once. Deliberately
 * not folded into GET /roadmaps/:id/full — see the service docstring.
 *
 * No DTO: there is no body and no query parameter, so the global
 * whitelist/forbidNonWhitelisted ValidationPipe has nothing to validate.
 */
@Controller('roadmaps/:roadmapId/comment-summary')
@UseGuards(SupabaseAuthGuard)
export class RoadmapCommentSummaryController {
  constructor(private readonly service: RoadmapCommentSummaryService) {}

  @Get()
  list(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(roadmapId, user.id);
  }
}
