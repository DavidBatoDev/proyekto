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
import { TasksService } from '../services/tasks.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  BulkReorderDto,
  QuickCreateTaskFromTimerDto,
} from '../dto/roadmaps.dto';

@Controller('tasks')
@UseGuards(SupabaseAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('feature/:featureId')
  getByFeature(
    @Param('featureId') featureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.findByFeature(featureId, user.id);
  }

  @Get('roadmap/:roadmapId')
  getByRoadmap(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.findByRoadmap(roadmapId, user.id);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.findById(id, user.id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.getHistory(id, user.id);
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.create(dto, user.id);
  }

  @Post('quick-create')
  quickCreate(
    @Body() dto: QuickCreateTaskFromTimerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.quickCreateFromTimer(dto, user.id);
  }

  @Patch('reorder')
  bulkReorder(
    @Body('feature_id') featureId: string,
    @Body() dto: BulkReorderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.bulkReorder(featureId, dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.remove(id, user.id);
  }

  // Deprecated assign/unassign — 410 Gone
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
