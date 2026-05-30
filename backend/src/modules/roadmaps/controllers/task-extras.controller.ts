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
import { TaskExtrasService } from '../services/task-extras.service';
import {
  AddCommentDto,
  UpdateCommentDto,
  AddAttachmentDto,
  AddDependencyDto,
} from '../dto/roadmaps.dto';

@Controller('tasks')
@UseGuards(SupabaseAuthGuard)
export class TaskExtrasController {
  constructor(private readonly taskExtrasService: TaskExtrasService) {}

  @Get(':taskId/comments')
  getComments(@Param('taskId') taskId: string) {
    return this.taskExtrasService.findComments(taskId);
  }

  @Post(':taskId/comments')
  addComment(
    @Param('taskId') taskId: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskExtrasService.addComment(taskId, dto, user.id);
  }

  @Patch(':taskId/comments/:commentId')
  updateComment(
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskExtrasService.updateComment(commentId, dto, user.id);
  }

  @Delete(':taskId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskExtrasService.deleteComment(commentId, user.id);
  }

  @Get(':taskId/attachments')
  getAttachments(@Param('taskId') taskId: string) {
    return this.taskExtrasService.findAttachments(taskId);
  }

  @Post(':taskId/attachments')
  addAttachment(
    @Param('taskId') taskId: string,
    @Body() dto: AddAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskExtrasService.addAttachment(taskId, dto, user.id);
  }

  @Delete(':taskId/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAttachment(
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskExtrasService.deleteAttachment(attachmentId, user.id);
  }

  @Get(':taskId/dependencies')
  getDependencies(@Param('taskId') taskId: string) {
    return this.taskExtrasService.getDependencies(taskId);
  }

  @Post(':taskId/dependencies')
  addDependency(
    @Param('taskId') taskId: string,
    @Body() dto: AddDependencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.taskExtrasService.addDependency(taskId, dto.blocking_task_id, user.id);
  }

  @Delete(':taskId/dependencies/:dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDependency(@Param('dependencyId') dependencyId: string) {
    return this.taskExtrasService.removeDependency(dependencyId);
  }
}
