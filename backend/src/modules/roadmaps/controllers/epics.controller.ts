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
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { EpicsService } from '../services/epics.service';
import {
  CreateEpicDto,
  UpdateEpicDto,
  BulkReorderDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';

@Controller('epics')
@UseGuards(SupabaseAuthGuard)
export class EpicsController {
  constructor(private readonly epicsService: EpicsService) {}

  @Get('roadmap/:roadmapId')
  getByRoadmap(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.findByRoadmap(roadmapId, user.id);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.epicsService.findById(id, user.id);
  }

  @Post()
  create(@Body() dto: CreateEpicDto, @CurrentUser() user: AuthenticatedUser) {
    return this.epicsService.create(dto, user.id);
  }

  @Patch('reorder')
  bulkReorder(
    @Body('roadmap_id') roadmapId: string,
    @Body() dto: BulkReorderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.bulkReorder(roadmapId, dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEpicDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.update(id, dto, user.id);
  }

  @Get(':id/comments')
  getComments(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.epicsService.findComments(id, user.id);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.addComment(id, dto, user.id);
  }

  @Patch(':epicId/comments/:commentId')
  updateComment(
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.updateComment(commentId, dto, user.id);
  }

  @Delete(':epicId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.epicsService.deleteComment(commentId, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.epicsService.remove(id, user.id);
  }
}
