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
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { RoadmapsService } from '../services/roadmaps.service';
import {
  CreateRoadmapDto,
  ReplaceProjectRoadmapDto,
  UpdateRoadmapDto,
  UpdateRoadmapTemplateSettingsDto,
} from '../dto/roadmaps.dto';

@Controller('roadmaps')
@UseGuards(SupabaseAuthGuard)
export class RoadmapsController {
  constructor(private readonly roadmapsService: RoadmapsService) {}

  @Get()
  getAll(@CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.findAll(user.id);
  }

  @Get('preview')
  getPreviews(@CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.findPreviews(user.id);
  }

  @Get('user/:userId')
  getByUser(@Param('userId') userId: string) {
    return this.roadmapsService.findByUser(userId);
  }

  @Post('migrate')
  @HttpCode(HttpStatus.OK)
  migrateGuest(
    @Body('session_id') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.migrateGuestRoadmaps(sessionId, user.id);
  }

  @Get('project/:projectId')
  getByProjectId(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.findByProjectId(projectId, user.id);
  }

  @Get('consultant/templates/mine')
  getConsultantTemplatesMine(@CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.findConsultantTemplateRoadmaps(user.id);
  }

  @Get('templates/public')
  @Public()
  getPublicTemplates() {
    return this.roadmapsService.findPublicTemplates();
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

  @Patch(':id/template-settings')
  updateTemplateSettings(
    @Param('id') id: string,
    @Body() dto: UpdateRoadmapTemplateSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.updateTemplateSettings(id, dto, user.id);
  }

  @Post(':id/clone-from-template')
  cloneFromTemplate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapsService.cloneFromTemplate(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.roadmapsService.remove(id, user.id);
  }
}
