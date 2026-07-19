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
import { MilestonesService } from '../services/milestones.service';
import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
  ReorderDto,
} from '../dto/roadmaps.dto';

@Controller('roadmaps')
@UseGuards(SupabaseAuthGuard)
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Get(':roadmapId/milestones')
  getByRoadmap(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestonesService.findByRoadmap(roadmapId, user.id);
  }

  @Post(':roadmapId/milestones')
  create(
    @Param('roadmapId') roadmapId: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestonesService.create(roadmapId, dto, user.id);
  }

  @Get('milestones/:id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.milestonesService.findById(id, user.id);
  }

  @Patch('milestones/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestonesService.update(id, dto, user.id);
  }

  @Patch('milestones/:id/reorder')
  reorder(
    @Param('id') id: string,
    @Body() dto: ReorderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.milestonesService.reorder(id, dto, user.id);
  }

  @Delete('milestones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.milestonesService.remove(id, user.id);
  }
}
