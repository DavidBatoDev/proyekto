import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { ConsultantOnlyGuard } from '../../common/guards/consultant-only.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ModeratorGuard } from '../../common/guards/moderator.guard';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../common/cache/redis-data-cache.service';
import { RoadmapTemplatesService } from './roadmap-templates.service';
import {
  CreateRoadmapTemplateFromRoadmapDto,
  CreateRoadmapTemplateRevisionDto,
  FeatureRoadmapTemplateDto,
  InstantiateRoadmapTemplateDto,
  ModerateRoadmapTemplateDto,
  RateRoadmapTemplateDto,
  RecordRoadmapTemplateViewDto,
  ReportRoadmapTemplateDto,
  ResolveRoadmapTemplateReportDto,
  RoadmapTemplateCatalogQueryDto,
  UpdateRoadmapTemplateDto,
} from './dto/roadmap-templates.dto';

@Controller('roadmap-templates')
@UseGuards(SupabaseAuthGuard)
export class RoadmapTemplatesController {
  constructor(
    private readonly templates: RoadmapTemplatesService,
    private readonly dataCache: RedisDataCacheService,
  ) {}

  private setCacheHeader(response: Response, status: AppCacheStatus) {
    if (this.dataCache.isDebugHeadersEnabled()) {
      response.setHeader('X-App-Cache', status);
    }
  }

  @Get()
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  list(
    @Query() query: RoadmapTemplateCatalogQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.templates.list(query, {
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }

  @Get('categories')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  listCategories() {
    return this.templates.listCategories();
  }

  @Get('mine')
  @UseGuards(ConsultantOnlyGuard)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.mine(user.id);
  }

  @Post('from-roadmap/:roadmapId')
  @UseGuards(ConsultantOnlyGuard)
  createFromRoadmap(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRoadmapTemplateFromRoadmapDto,
  ) {
    return this.templates.createFromRoadmap(roadmapId, user.id, dto);
  }

  @Get('admin/reports')
  @UseGuards(AdminGuard, ModeratorGuard)
  listReports(@Query('status') status?: string) {
    return this.templates.listReports(status);
  }

  @Patch('admin/reports/:reportId')
  @UseGuards(AdminGuard, ModeratorGuard)
  resolveReport(
    @Param('reportId') reportId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ResolveRoadmapTemplateReportDto,
  ) {
    return this.templates.resolveReport(reportId, user.id, dto);
  }

  @Post('admin/:id/unlist')
  @UseGuards(AdminGuard, ModeratorGuard)
  moderatorUnlist(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ModerateRoadmapTemplateDto,
  ) {
    return this.templates.moderateTemplate(id, user.id, dto);
  }

  @Post('admin/:id/restore')
  @UseGuards(AdminGuard, ModeratorGuard)
  moderatorRestore(@Param('id') id: string) {
    return this.templates.restoreTemplate(id);
  }

  @Patch('admin/:id/featured')
  @UseGuards(AdminGuard, ModeratorGuard)
  setFeatured(@Param('id') id: string, @Body() dto: FeatureRoadmapTemplateDto) {
    return this.templates.setFeatured(id, dto.is_featured);
  }

  @Post(':id/views')
  @Public()
  recordView(
    @Param('id') id: string,
    @Body() dto: RecordRoadmapTemplateViewDto,
  ) {
    return this.templates.recordView(id, dto.visitor_key);
  }

  @Post(':id/instantiate')
  instantiate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InstantiateRoadmapTemplateDto,
  ) {
    return this.templates.instantiate(id, user.id, dto);
  }

  @Put(':id/rating')
  rate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RateRoadmapTemplateDto,
  ) {
    return this.templates.rate(id, user.id, dto);
  }

  @Post(':id/reports')
  report(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportRoadmapTemplateDto,
  ) {
    return this.templates.report(id, user.id, dto);
  }

  @Patch(':id')
  @UseGuards(ConsultantOnlyGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRoadmapTemplateDto,
  ) {
    return this.templates.updateMetadata(id, user.id, dto);
  }

  @Post(':id/publish')
  @UseGuards(ConsultantOnlyGuard)
  publish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.publish(id, user.id);
  }

  @Post(':id/revisions/from-roadmap')
  @UseGuards(ConsultantOnlyGuard)
  revise(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRoadmapTemplateRevisionDto,
  ) {
    return this.templates.revise(
      id,
      user.id,
      dto.roadmap_id,
      dto.schedule_kind,
    );
  }

  @Post(':id/unlist')
  @UseGuards(ConsultantOnlyGuard)
  unlist(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.setOwnerStatus(id, user.id, 'unlisted');
  }

  @Post(':id/archive')
  @UseGuards(ConsultantOnlyGuard)
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.setOwnerStatus(id, user.id, 'archived');
  }

  @Get(':id/analytics')
  @UseGuards(ConsultantOnlyGuard)
  analytics(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.analytics(id, user.id);
  }

  @Get(':slug')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  detail(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.templates.detail(slug, {
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }
}
