import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { CreateFeatureDependencyDto } from '../dto/roadmaps.dto';
import { FeatureDependenciesService } from '../services/feature-dependencies.service';

/**
 * Roadmap-scoped because the Timeline needs every edge at once. Deliberately
 * not folded into GET /roadmaps/:id/full — that is the hottest read in the app
 * and this is a Timeline-only concern.
 */
@Controller('roadmaps/:roadmapId/feature-dependencies')
@UseGuards(SupabaseAuthGuard)
export class FeatureDependenciesController {
  constructor(private readonly service: FeatureDependenciesService) {}

  @Get()
  list(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(roadmapId, user.id);
  }

  @Post()
  create(
    @Param('roadmapId') roadmapId: string,
    @Body() dto: CreateFeatureDependencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(roadmapId, dto, user.id);
  }

  @Delete(':dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('roadmapId') roadmapId: string,
    @Param('dependencyId') dependencyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(roadmapId, dependencyId, user.id);
  }
}
