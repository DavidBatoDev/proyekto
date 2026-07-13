import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { FeaturesService } from '../services/features.service';
import {
  CreateFeatureDto,
  UpdateFeatureDto,
  BulkReorderDto,
  LinkMilestoneDto,
  UnlinkMilestoneDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';

@Controller('features')
@UseGuards(SupabaseAuthGuard)
export class FeaturesController {
  constructor(private readonly featuresService: FeaturesService) {}

  @Get('epic/:epicId')
  getByEpic(
    @Param('epicId') epicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.findByEpic(epicId, user.id);
  }

  @Get('roadmap/:roadmapId')
  getByRoadmap(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.findByRoadmap(roadmapId, user.id);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.featuresService.findById(id, user.id);
  }

  @Post()
  create(
    @Body() dto: CreateFeatureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.create(dto, user.id);
  }

  @Patch('reorder')
  bulkReorder(
    @Body('epic_id') epicId: string,
    @Body() dto: BulkReorderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.bulkReorder(epicId, dto, user.id);
  }

  @Post('link-milestone')
  linkMilestone(
    @Body() dto: LinkMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.linkMilestone(dto, user.id);
  }

  @Delete('unlink-milestone')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlinkMilestone(
    @Body() dto: UnlinkMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.unlinkMilestone(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.update(id, dto, user.id);
  }

  @Get(':id/comments')
  getComments(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.featuresService.findComments(id, user.id);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.addComment(id, dto, user.id);
  }

  @Patch(':featureId/comments/:commentId')
  updateComment(
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.updateComment(commentId, dto, user.id);
  }

  @Delete(':featureId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuresService.deleteComment(commentId, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.featuresService.remove(id, user.id);
  }

  // Deprecated assign/unassign endpoints — return 410 Gone
  @Post(':id/assign')
  assignDeprecated() {
    throw new HttpException(
      'This endpoint has been deprecated and removed',
      HttpStatus.GONE,
    );
  }

  @Delete(':id/unassign')
  unassignDeprecated() {
    throw new HttpException(
      'This endpoint has been deprecated and removed',
      HttpStatus.GONE,
    );
  }
}
