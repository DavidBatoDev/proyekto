import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  CreateWorkflowColumnDto,
  UpdateWorkflowColumnDto,
} from '../dto/roadmaps.dto';
import { WorkflowColumnsService } from '../services/workflow-columns.service';

@Controller('roadmaps')
@UseGuards(SupabaseAuthGuard)
export class WorkflowColumnsController {
  constructor(private readonly workflowColumns: WorkflowColumnsService) {}

  @Get(':id/workflow-columns')
  list(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowColumns.list(roadmapId, user.id);
  }

  @Post(':id/workflow-columns')
  create(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkflowColumnDto,
  ) {
    return this.workflowColumns.create(roadmapId, user.id, dto);
  }

  @Patch(':id/workflow-columns/:columnId')
  update(
    @Param('id') roadmapId: string,
    @Param('columnId') columnId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWorkflowColumnDto,
  ) {
    return this.workflowColumns.update(roadmapId, columnId, user.id, dto);
  }

  @Delete(':id/workflow-columns/:columnId')
  remove(
    @Param('id') roadmapId: string,
    @Param('columnId') columnId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowColumns.remove(roadmapId, columnId, user.id);
  }

  @Post(':id/workflow-templates/:templateKey/apply')
  applyTemplate(
    @Param('id') roadmapId: string,
    @Param('templateKey') templateKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflowColumns.applyTemplate(roadmapId, templateKey, user.id);
  }
}

