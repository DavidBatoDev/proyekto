import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { UpdateProjectEconomicsDto } from './dto/contracts.dto';
import { ProjectActivationService } from './project-activation.service';

/**
 * Project-scoped money settings. These live under the `projects` prefix
 * (not `contracts`) because they belong to the project rather than to any one
 * contract version — the split survives a contract renewal.
 *
 * Route shapes are two segments deep, so they cannot shadow ProjectsController's
 * `@Get(':id')`.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('projects')
export class ProjectActivationController {
  constructor(private readonly activation: ProjectActivationService) {}

  @Get(':projectId/economics')
  getEconomics(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.activation.getEconomics(user.id, projectId);
  }

  @Put(':projectId/economics')
  updateEconomics(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectEconomicsDto,
  ) {
    return this.activation.upsertEconomics(user.id, projectId, dto);
  }

  @Get(':projectId/activation-checklist')
  getChecklist(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.activation.getChecklist(user.id, projectId);
  }
}
