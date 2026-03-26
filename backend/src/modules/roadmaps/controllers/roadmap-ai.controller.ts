import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  RoadmapAiCommitDto,
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

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @Param('id') roadmapId: string,
    @Body() dto: RoadmapAiCommitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapAiService.commit(roadmapId, dto, user.id);
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
