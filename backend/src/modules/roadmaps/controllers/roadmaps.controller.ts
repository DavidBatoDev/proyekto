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
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { RoadmapsService } from '../services/roadmaps.service';
import { RoadmapMetadataGeneratorService } from '../services/roadmap-metadata-generator.service';
import { RoadmapAiProjectContextService } from '../services/roadmap-ai-project-context.service';
import {
  CreateRoadmapDto,
  ReplaceProjectRoadmapDto,
  SuggestRoadmapIntakeStepDto,
  SuggestRoadmapMetadataDto,
  UpdateRoadmapDto,
} from '../dto/roadmaps.dto';

@Controller('roadmaps')
@UseGuards(SupabaseAuthGuard)
export class RoadmapsController {
  private readonly logger = new Logger(RoadmapsController.name);

  constructor(
    private readonly roadmapsService: RoadmapsService,
    private readonly metadataGenerator: RoadmapMetadataGeneratorService,
    private readonly projectContext: RoadmapAiProjectContextService,
  ) {}

  @Get()
  getAll(@CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.findAll(user.id);
  }

  @Get('preview')
  getPreviews(@CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.findPreviews(user.id);
  }

  @Get('user/:userId')
  getByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.findByUser(userId, user.id);
  }

  @Post('migrate')
  @HttpCode(HttpStatus.OK)
  migrateGuest(
    @Body('session_id') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // A guest caller would "migrate" its roadmaps onto its own profile
    // (no-op) while the client clears the guest session — stranding them.
    if (user.is_guest) {
      throw new ForbiddenException(
        'Sign in with a full account to claim guest roadmaps.',
      );
    }
    return this.roadmapsService.migrateGuestRoadmaps(sessionId, user.id);
  }

  @Get('project/:projectId')
  getByProjectId(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.findByProjectId(projectId, user.id);
  }

  @Get('all-full')
  getAllFull(@CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.getAllFull(user.id);
  }

  @Post('suggest-metadata')
  suggestMetadata(@Body() dto: SuggestRoadmapMetadataDto) {
    return this.metadataGenerator.suggest(dto);
  }

  @Post('intake/suggest')
  async suggestIntakeStep(
    @Body() dto: SuggestRoadmapIntakeStepDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const projectContextBlock = await this.resolveIntakeProjectBlock(dto, user);
    return this.metadataGenerator.suggestIntakeStep(dto, projectContextBlock);
  }

  /**
   * Resolves the optional project-context prompt block for intake.
   *
   * A permission failure is swallowed, not propagated: the block is only ever
   * fed to the model and is never echoed back in the response, so degrading to
   * a context-free intake leaks nothing - whereas 403-ing the create page over
   * optional prompt enrichment would break a working flow. The warn log is
   * what makes a systemic authz gap visible.
   */
  private async resolveIntakeProjectBlock(
    dto: SuggestRoadmapIntakeStepDto,
    user: AuthenticatedUser,
  ): Promise<string> {
    if (dto.step !== 'objective') return '';
    if (!dto.project_id) return '';
    // Guests reach this route via X-Guest-User-Id and are never project members.
    if (user.is_guest) return '';

    try {
      return await this.projectContext.getIntakeProjectContextBlock(
        dto.project_id,
        user.id,
      );
    } catch (error) {
      this.logger.warn(
        `intake project context skipped project=${dto.project_id} user=${
          user.id
        }: ${(error as Error)?.message ?? 'unknown error'}`,
      );
      return '';
    }
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.findById(id, user.id);
  }

  @Get(':id/full')
  getFull(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.findFull(id, user.id);
  }

  @Post()
  create(
    @Body() dto: CreateRoadmapDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.create(dto, user.id);
  }

  @Post('replace-for-project')
  @HttpCode(HttpStatus.OK)
  replaceForProject(
    @Body() dto: ReplaceProjectRoadmapDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.replaceProjectRoadmap(
      dto.project_id,
      dto.replacement_roadmap_id,
      user.id,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoadmapDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.remove(id, user.id);
  }
}
