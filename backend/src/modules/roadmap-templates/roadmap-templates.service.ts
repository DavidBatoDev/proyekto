/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- The repository's shared SupabaseClient is not generated from a Database schema, so query payloads are typed as any at this boundary. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../common/cache/redis-data-cache.service';
import {
  hashNormalizedQuery,
  REDIS_CACHE_KEYS,
} from '../../common/cache/redis-cache.keys';
import { RedisCacheInvalidationService } from '../../common/cache/redis-cache-invalidation.service';
import type {
  ConsultantTemplateAnalytics,
  RoadmapTemplateDetail,
  RoadmapTemplateSummary,
  RoadmapTemplateVersionContent,
} from './roadmap-template.types';
import {
  CreateRoadmapTemplateFromRoadmapDto,
  InstantiateRoadmapTemplateDto,
  ModerateRoadmapTemplateDto,
  RateRoadmapTemplateDto,
  ReportRoadmapTemplateDto,
  ResolveRoadmapTemplateReportDto,
  RoadmapTemplateCatalogQueryDto,
  UpdateRoadmapTemplateDto,
} from './dto/roadmap-templates.dto';

type CacheOptions = { onCacheStatus?: (status: AppCacheStatus) => void };
type TemplateRow = Record<string, any>;

@Injectable()
export class RoadmapTemplatesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly cache: RedisDataCacheService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  async list(
    query: RoadmapTemplateCatalogQueryDto,
    options?: CacheOptions,
  ): Promise<{ items: RoadmapTemplateSummary[]; next_cursor: string | null }> {
    const normalized = {
      search: query.search?.trim().toLowerCase() || undefined,
      category: query.category?.trim().toLowerCase() || undefined,
      tags: this.parseTags(query.tags),
      difficulty: query.difficulty,
      schedule_kind: query.schedule_kind,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    };
    const key = REDIS_CACHE_KEYS.roadmapTemplatesByHash(
      hashNormalizedQuery(normalized),
    );
    return this.cache.rememberJson(
      key,
      this.cache.getPublicTtlSeconds(),
      () => this.loadCatalog(query),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.roadmapTemplatesIndex,
      },
    );
  }

  async featured(options?: CacheOptions): Promise<{
    items: RoadmapTemplateSummary[];
  }> {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.roadmapTemplatesFeatured,
      this.cache.getPublicTtlSeconds(),
      async () => {
        let result = await this.queryFeatured(this.publicSummarySelect());
        if (this.isMissingPreviewColumn(result.error)) {
          result = await this.queryFeatured(this.publicLegacySelect());
        }
        const { data, error } = result;
        if (error) throw new BadRequestException(error.message);
        return { items: (data ?? []).map((row) => this.toSummary(row)) };
      },
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.roadmapTemplatesIndex,
      },
    );
  }

  async listCategories() {
    const { data, error } = await this.db
      .from('roadmap_template_categories')
      .select('id, slug, name, description, position')
      .eq('is_active', true)
      .order('position', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async detail(
    slug: string,
    options?: CacheOptions,
  ): Promise<RoadmapTemplateDetail> {
    const key = REDIS_CACHE_KEYS.roadmapTemplateDetail(slug);
    return this.cache.rememberJson(
      key,
      this.cache.getPublicTtlSeconds(),
      async () => {
        const row = await this.findPublicBySlug(slug);
        return this.toDetail(row);
      },
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.roadmapTemplatesIndex,
      },
    );
  }

  async recordView(templateId: string, visitorKey: string) {
    const template = await this.requirePublishedTemplate(templateId);
    const viewerKey = createHash('sha256').update(visitorKey).digest('hex');
    const { error } = await this.db.from('roadmap_template_views').insert({
      template_id: templateId,
      viewer_key: viewerKey,
      viewed_on: new Date().toISOString().slice(0, 10),
    });
    if (error && error.code !== '23505') {
      throw new BadRequestException(error.message);
    }
    if (!error) await this.invalidatePublicTemplates(template.slug);
    return { recorded: !error };
  }

  async instantiate(
    templateId: string,
    userId: string,
    dto: InstantiateRoadmapTemplateDto,
  ) {
    const template = await this.requirePublishedTemplate(templateId);
    const { data, error } = await this.db.rpc(
      'instantiate_roadmap_public_template',
      {
        p_template_id: templateId,
        p_template_version_id: null,
        p_user_id: userId,
        p_project_id: dto.project_id ?? null,
        p_start_date: dto.start_date.slice(0, 10),
        p_idempotency_key: dto.idempotency_key,
        p_source_surface: dto.source_surface,
      },
    );
    if (error) {
      if (error.message.includes('non-empty roadmap')) {
        throw new ConflictException(error.message);
      }
      if (error.message.includes('access required')) {
        throw new ForbiddenException(error.message);
      }
      throw new BadRequestException(error.message);
    }
    await Promise.all([
      this.cacheInvalidation.invalidateDashboardCacheForUser(userId),
      this.invalidatePublicTemplates(template.slug),
    ]);
    return data;
  }

  async rate(templateId: string, userId: string, dto: RateRoadmapTemplateDto) {
    const template = await this.requirePublishedTemplate(templateId);
    const { data, error } = await this.db
      .from('roadmap_template_ratings')
      .upsert(
        {
          template_id: templateId,
          user_id: userId,
          rating: dto.rating,
          review: dto.review?.trim() || null,
        },
        { onConflict: 'template_id,user_id' },
      )
      .select()
      .single();
    if (error) {
      if (error.message.includes('only be rated after')) {
        throw new ForbiddenException(error.message);
      }
      throw new BadRequestException(error.message);
    }
    await this.invalidatePublicTemplates(template.slug);
    return data;
  }

  async report(
    templateId: string,
    userId: string,
    dto: ReportRoadmapTemplateDto,
  ) {
    await this.requirePublishedTemplate(templateId);
    const { data, error } = await this.db
      .from('roadmap_template_reports')
      .insert({
        template_id: templateId,
        reporter_id: userId,
        reason: dto.reason,
        details: dto.details.trim(),
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async mine(userId: string) {
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .select(
        '*, category:roadmap_template_categories(slug,name), current_version:roadmap_template_versions!roadmap_public_templates_current_version_fkey(id,version_number,created_at)',
      )
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createFromRoadmap(
    roadmapId: string,
    userId: string,
    dto: CreateRoadmapTemplateFromRoadmapDto,
  ) {
    if (!dto.rights_attested) {
      throw new BadRequestException('Ownership-rights attestation is required');
    }
    await this.assertRoadmapOwner(roadmapId, userId);
    const category = await this.findCategory(dto.category);
    const attributionName = await this.findAttributionName(userId);
    const slug = await this.uniqueSlug(dto.title);
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .insert({
        slug,
        title: dto.title.trim(),
        summary: dto.summary.trim(),
        preview_url: dto.preview_url,
        owner_id: userId,
        source_roadmap_id: roadmapId,
        origin: 'consultant',
        status: 'draft',
        category_id: category.id,
        difficulty: dto.difficulty,
        schedule_kind: dto.schedule_kind,
        estimated_duration_days: dto.estimated_duration_days,
        attribution_name: attributionName,
        attribution_url: dto.attribution_url ?? null,
        rights_attested_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.replaceTags(data.id, dto.tags);
    return data;
  }

  async updateMetadata(
    templateId: string,
    userId: string,
    dto: UpdateRoadmapTemplateDto,
  ) {
    const template = await this.requireOwnedTemplate(templateId, userId);
    if (
      dto.schedule_kind !== undefined &&
      template.current_version_id &&
      dto.schedule_kind !== template.schedule_kind
    ) {
      throw new BadRequestException(
        'Schedule kind changes require publishing a new roadmap revision',
      );
    }
    const payload: Record<string, unknown> = {};
    for (const key of [
      'title',
      'summary',
      'preview_url',
      'difficulty',
      'schedule_kind',
      'estimated_duration_days',
      'attribution_url',
    ] as const) {
      if (dto[key] !== undefined) {
        payload[key] =
          typeof dto[key] === 'string' ? dto[key].trim() : dto[key];
      }
    }
    if (dto.category)
      payload.category_id = (await this.findCategory(dto.category)).id;
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .update(payload)
      .eq('id', template.id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    if (dto.tags !== undefined) await this.replaceTags(template.id, dto.tags);
    if (template.status === 'published')
      await this.invalidatePublicTemplates(template.slug);
    return data;
  }

  async publish(templateId: string, userId: string) {
    const template = await this.requireOwnedTemplate(templateId, userId);
    if (template.status === 'archived') {
      throw new BadRequestException('Archived templates cannot be published');
    }
    if (template.moderation_reason) {
      throw new ForbiddenException(
        'A moderator must restore this template before it can be published',
      );
    }
    if (!template.rights_attested_at) {
      throw new BadRequestException('Ownership-rights attestation is required');
    }
    return this.publishSnapshot(template, template.source_roadmap_id, userId);
  }

  async revise(
    templateId: string,
    userId: string,
    roadmapId?: string,
    scheduleKind?: 'long_term' | 'short_learning',
  ) {
    const template = await this.requireOwnedTemplate(templateId, userId);
    if (template.status === 'archived') {
      throw new BadRequestException('Archived templates cannot be revised');
    }
    if (template.moderation_reason) {
      throw new ForbiddenException(
        'A moderator must restore this template before it can be revised',
      );
    }
    const sourceRoadmapId = roadmapId ?? template.source_roadmap_id;
    if (!sourceRoadmapId)
      throw new BadRequestException('A source roadmap is required');
    await this.assertRoadmapOwner(sourceRoadmapId, userId);
    return this.publishSnapshot(
      { ...template, schedule_kind: scheduleKind ?? template.schedule_kind },
      sourceRoadmapId,
      userId,
    );
  }

  async setOwnerStatus(
    templateId: string,
    userId: string,
    status: 'unlisted' | 'archived',
  ) {
    const template = await this.requireOwnedTemplate(templateId, userId);
    const timestamp = new Date().toISOString();
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .update({
        status,
        unlisted_at: status === 'unlisted' ? timestamp : template.unlisted_at,
        archived_at: status === 'archived' ? timestamp : template.archived_at,
      })
      .eq('id', template.id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.invalidatePublicTemplates(template.slug);
    return data;
  }

  async analytics(
    templateId: string,
    userId: string,
  ): Promise<ConsultantTemplateAnalytics> {
    const template = await this.requireOwnedTemplate(templateId, userId);
    const [
      { data: usages, error: usageError },
      { count: openReports, error: reportError },
    ] = await Promise.all([
      this.db
        .from('roadmap_template_usages')
        .select('created_at')
        .eq('template_id', template.id)
        .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
      this.db
        .from('roadmap_template_reports')
        .select('id', { count: 'exact', head: true })
        .eq('template_id', template.id)
        .in('status', ['open', 'reviewing']),
    ]);
    if (usageError || reportError) {
      throw new BadRequestException(
        usageError?.message ?? reportError?.message,
      );
    }
    const byDay = new Map<string, number>();
    for (const usage of usages ?? []) {
      const day = String(usage.created_at).slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return {
      template_id: template.id,
      view_count: Number(template.view_count),
      unique_users: Number(template.use_count),
      duplicates: Number(template.duplicate_count),
      rating_count: Number(template.rating_count),
      rating_average: Number(template.rating_average),
      reports_open: openReports ?? 0,
      recent_uses: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    };
  }

  async listReports(status?: string) {
    let request = this.db
      .from('roadmap_template_reports')
      .select(
        '*, template:roadmap_public_templates(id,slug,title,status,owner_id,attribution_name)',
      )
      .order('created_at', { ascending: true });
    if (status) request = request.eq('status', status);
    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async moderateTemplate(
    templateId: string,
    moderatorId: string,
    dto: ModerateRoadmapTemplateDto,
  ) {
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .update({
        status: 'unlisted',
        moderation_reason: dto.reason.trim(),
        unlisted_at: new Date().toISOString(),
      })
      .eq('id', templateId)
      .select()
      .single();
    if (error || !data)
      throw new NotFoundException(error?.message ?? 'Template not found');
    await this.invalidatePublicTemplates(data.slug);
    return { ...data, moderated_by: moderatorId };
  }

  async restoreTemplate(templateId: string) {
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .update({
        status: 'published',
        moderation_reason: null,
        unlisted_at: null,
        published_at: new Date().toISOString(),
      })
      .eq('id', templateId)
      .not('current_version_id', 'is', null)
      .select()
      .single();
    if (error || !data)
      throw new NotFoundException(error?.message ?? 'Template not found');
    await this.invalidatePublicTemplates(data.slug);
    return data;
  }

  async setFeatured(templateId: string, isFeatured: boolean) {
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .update({ is_featured: isFeatured })
      .eq('id', templateId)
      .select()
      .single();
    if (error || !data) {
      throw new NotFoundException(error?.message ?? 'Template not found');
    }
    await this.invalidatePublicTemplates(data.slug);
    return data;
  }

  async resolveReport(
    reportId: string,
    moderatorId: string,
    dto: ResolveRoadmapTemplateReportDto,
  ) {
    const { data, error } = await this.db
      .from('roadmap_template_reports')
      .update({
        status: dto.status,
        moderation_note: dto.moderation_note.trim(),
        moderated_by: moderatorId,
        moderated_at: new Date().toISOString(),
      })
      .eq('id', reportId)
      .select()
      .single();
    if (error || !data)
      throw new NotFoundException(error?.message ?? 'Report not found');
    return data;
  }

  private async loadCatalog(query: RoadmapTemplateCatalogQueryDto) {
    const limit = query.limit ?? 20;
    const offset = this.decodeCursor(query.cursor);
    let allowedTemplateIds: string[] | null = null;
    const tagSlugs = this.parseTags(query.tags);
    if (tagSlugs.length > 0) {
      for (const slug of tagSlugs) {
        const { data, error } = await this.db
          .from('roadmap_public_template_tags')
          .select('template_id, tag:roadmap_template_tags!inner(slug)')
          .eq('tag.slug', slug);
        if (error) throw new BadRequestException(error.message);
        const ids = (data ?? []).map((item: any) => String(item.template_id));
        allowedTemplateIds =
          allowedTemplateIds === null
            ? ids
            : allowedTemplateIds.filter((id) => ids.includes(id));
      }
      if (allowedTemplateIds?.length === 0)
        return { items: [], next_cursor: null };
    }

    let result = await this.queryCatalog(
      query,
      allowedTemplateIds,
      this.publicSummarySelect(),
      offset,
      limit,
    );
    if (this.isMissingPreviewColumn(result.error)) {
      result = await this.queryCatalog(
        query,
        allowedTemplateIds,
        this.publicLegacySelect(),
        offset,
        limit,
      );
    }
    const { data, error, count } = result;
    if (error) throw new BadRequestException(error.message);
    const items = (data ?? []).map((row: any) => this.toSummary(row));
    const nextOffset = offset + items.length;
    return {
      items,
      next_cursor:
        count !== null && nextOffset < count
          ? Buffer.from(String(nextOffset)).toString('base64url')
          : null,
    };
  }

  private queryFeatured(select: string) {
    return this.db
      .from('roadmap_public_templates')
      .select(select)
      .eq('status', 'published')
      .order('is_featured', { ascending: false })
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(6);
  }

  private queryCatalog(
    query: RoadmapTemplateCatalogQueryDto,
    allowedTemplateIds: string[] | null,
    select: string,
    offset: number,
    limit: number,
  ) {
    let request = this.db
      .from('roadmap_public_templates')
      .select(select, { count: 'exact' })
      .eq('status', 'published');
    if (query.search?.trim()) {
      request = request.textSearch('search_vector', query.search.trim(), {
        type: 'websearch',
        config: 'english',
      });
    }
    if (query.category) request = request.eq('category.slug', query.category);
    if (query.difficulty) request = request.eq('difficulty', query.difficulty);
    if (query.schedule_kind)
      request = request.eq('schedule_kind', query.schedule_kind);
    if (allowedTemplateIds) request = request.in('id', allowedTemplateIds);

    switch (query.sort) {
      case 'popular':
        request = request.order('use_count', { ascending: false });
        break;
      case 'rating':
        request = request.order('rating_average', { ascending: false });
        break;
      case 'newest':
        request = request.order('published_at', { ascending: false });
        break;
      default:
        request = request
          .order('is_featured', { ascending: false })
          .order('published_at', { ascending: false });
    }
    return request
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
  }

  private publicSummarySelect() {
    return 'id,slug,title,summary,preview_url,difficulty,schedule_kind,estimated_duration_days,attribution_name,attribution_url,is_featured,published_at,view_count,use_count,duplicate_count,rating_count,rating_average,category:roadmap_template_categories!inner(slug,name),template_tags:roadmap_public_template_tags(tag:roadmap_template_tags(slug,name)),current_version:roadmap_template_versions!roadmap_public_templates_current_version_fkey(id,version_number,preview)';
  }

  private publicDetailSelect() {
    return 'id,slug,title,summary,preview_url,difficulty,schedule_kind,estimated_duration_days,attribution_name,attribution_url,is_featured,published_at,view_count,use_count,duplicate_count,rating_count,rating_average,category:roadmap_template_categories!inner(slug,name),template_tags:roadmap_public_template_tags(tag:roadmap_template_tags(slug,name)),current_version:roadmap_template_versions!roadmap_public_templates_current_version_fkey(id,version_number,preview,content)';
  }

  private publicLegacySelect() {
    return 'id,slug,title,summary,preview_url,difficulty,schedule_kind,estimated_duration_days,attribution_name,attribution_url,is_featured,published_at,view_count,use_count,duplicate_count,rating_count,rating_average,category:roadmap_template_categories!inner(slug,name),template_tags:roadmap_public_template_tags(tag:roadmap_template_tags(slug,name)),current_version:roadmap_template_versions!roadmap_public_templates_current_version_fkey(id,version_number,content)';
  }

  private isMissingPreviewColumn(
    error: { code?: string; message?: string } | null,
  ) {
    return (
      error?.code === '42703' &&
      error.message?.includes('roadmap_template_versions') &&
      error.message.includes('preview')
    );
  }

  private async findPublicBySlug(slug: string): Promise<TemplateRow> {
    const selectBySlug = (select: string) =>
      this.db
        .from('roadmap_public_templates')
        .select(select)
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle();
    let result = await selectBySlug(this.publicDetailSelect());
    if (this.isMissingPreviewColumn(result.error)) {
      result = await selectBySlug(this.publicLegacySelect());
    }
    const { data, error } = result;
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Roadmap template not found');
    return data;
  }

  private toSummary(row: TemplateRow): RoadmapTemplateSummary {
    const version = this.one(row.current_version);
    const content = version?.content as
      | RoadmapTemplateVersionContent
      | undefined;
    const preview =
      version?.preview ??
      (content
        ? {
            epics: (content.epics ?? []).slice(0, 6).map((epic, epicIndex) => ({
              id: epic.key,
              title: `${epic.time_label} ${epic.title}`,
              position: epicIndex,
              features: (epic.features ?? []).map((feature) => ({
                id: feature.key,
                title: `${feature.time_label} ${feature.title}`,
              })),
            })),
            milestone_count: content.milestones?.length ?? 0,
          }
        : { epics: [], milestone_count: 0 });
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      preview_url: row.preview_url,
      category: this.one(row.category),
      tags: (row.template_tags ?? []).map((entry: any) => this.one(entry.tag)),
      difficulty: row.difficulty,
      schedule: {
        kind: row.schedule_kind,
        estimated_duration_days: row.estimated_duration_days,
      },
      attribution: { name: row.attribution_name, url: row.attribution_url },
      is_featured: row.is_featured,
      published_at: row.published_at,
      view_count: Number(row.view_count),
      use_count: Number(row.use_count),
      duplicate_count: Number(row.duplicate_count),
      rating_count: Number(row.rating_count),
      rating_average: Number(row.rating_average),
      preview,
    };
  }

  private toDetail(row: TemplateRow): RoadmapTemplateDetail {
    const summary = this.toSummary(row);
    const version = this.one(row.current_version);
    const content = version.content as RoadmapTemplateVersionContent;
    const features = content.epics.flatMap((epic) => epic.features ?? []);
    return {
      ...summary,
      version_id: version.id,
      version_number: version.version_number,
      content,
      hierarchy_counts: {
        milestones: content.milestones.length,
        epics: content.epics.length,
        features: features.length,
        tasks: features.reduce((sum, feature) => sum + feature.tasks.length, 0),
      },
    };
  }

  private async publishSnapshot(
    template: TemplateRow,
    roadmapId: string | null,
    userId: string,
  ) {
    if (!roadmapId)
      throw new BadRequestException('A source roadmap is required');
    await this.assertRoadmapOwner(roadmapId, userId);
    const { data: rawContent, error: snapshotError } = await this.db.rpc(
      'snapshot_roadmap_for_public_template',
      { p_roadmap_id: roadmapId },
    );
    if (snapshotError) throw new BadRequestException(snapshotError.message);
    const content = this.normalizeSnapshotSchedule(
      rawContent as RoadmapTemplateVersionContent,
      template.schedule_kind,
    );
    this.validateSnapshot(content);
    const checksum = createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex');
    const { data: identical } = await this.db
      .from('roadmap_template_versions')
      .select('id')
      .eq('template_id', template.id)
      .eq('checksum', checksum)
      .maybeSingle();
    if (identical)
      throw new ConflictException(
        'This roadmap revision is identical to the published version',
      );
    const { data: latest, error: latestError } = await this.db
      .from('roadmap_template_versions')
      .select('version_number')
      .eq('template_id', template.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new BadRequestException(latestError.message);
    const { data: version, error: versionError } = await this.db
      .from('roadmap_template_versions')
      .insert({
        template_id: template.id,
        version_number: (latest?.version_number ?? 0) + 1,
        contract_version: 1,
        content,
        checksum,
        created_by: userId,
        published_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (versionError) throw new BadRequestException(versionError.message);
    const { data: updated, error: updateError } = await this.db
      .from('roadmap_public_templates')
      .update({
        current_version_id: version.id,
        source_roadmap_id: roadmapId,
        schedule_kind: template.schedule_kind,
        status: 'published',
        published_at: template.published_at ?? new Date().toISOString(),
        unlisted_at: null,
        moderation_reason: null,
      })
      .eq('id', template.id)
      .select()
      .single();
    if (updateError) throw new BadRequestException(updateError.message);
    await this.invalidatePublicTemplates(template.slug);
    return { template: updated, version };
  }

  private normalizeSnapshotSchedule(
    content: RoadmapTemplateVersionContent,
    scheduleKind: 'long_term' | 'short_learning',
  ): RoadmapTemplateVersionContent {
    const cloned = structuredClone(content);
    cloned.schedule_kind = scheduleKind;
    cloned.roadmap.schedule_kind = scheduleKind;
    cloned.epics.forEach((epic, epicIndex) => {
      epic.time_label =
        scheduleKind === 'short_learning'
          ? `(Week ${epicIndex + 1})`
          : `(Month ${epicIndex + 1})`;
      epic.features.forEach((feature) => {
        const unit = Math.max(
          1,
          Math.floor(
            feature.start_day_offset /
              (scheduleKind === 'short_learning' ? 1 : 7),
          ) + 1,
        );
        feature.time_label =
          scheduleKind === 'short_learning'
            ? `(Day ${unit})`
            : `(Week ${unit})`;
      });
    });
    cloned.milestones.forEach((milestone, index) => {
      milestone.time_label =
        scheduleKind === 'short_learning'
          ? `(End of Week ${index + 1})`
          : `(End of Month ${index + 1})`;
    });
    return cloned;
  }

  private validateSnapshot(content: RoadmapTemplateVersionContent) {
    if (
      !content ||
      content.contract_version !== 1 ||
      !Array.isArray(content.epics)
    ) {
      throw new BadRequestException('Unsupported roadmap template snapshot');
    }
    if (
      content.schedule_kind !== content.roadmap?.schedule_kind ||
      !['long_term', 'short_learning'].includes(content.schedule_kind)
    ) {
      throw new BadRequestException('Template schedule kind is inconsistent');
    }
    if (content.epics.length < 4 || content.epics.length > 6) {
      throw new BadRequestException(
        'Templates require between four and six epics',
      );
    }
    if (!Array.isArray(content.milestones) || content.milestones.length < 1) {
      throw new BadRequestException('Templates require at least one milestone');
    }
    const shortLearning = content.schedule_kind === 'short_learning';
    if (shortLearning && content.milestones.length !== content.epics.length) {
      throw new BadRequestException(
        'Short learning templates require one milestone per week',
      );
    }
    const featureMinimum = 3;
    const featureMaximum = shortLearning ? 7 : 5;
    const taskMinimum = shortLearning ? 1 : 2;
    const taskMaximum = shortLearning ? 3 : 4;
    const featureKeys = new Set<string>();
    const linkedFeatureKeys = new Set<string>();
    let previousEnd = -1;
    for (const epic of content.epics) {
      const epicLabel = shortLearning
        ? /^\(Week \d+(?:[–-]\d+)?\)$/
        : /^\(Month \d+(?:[–-]\d+)?\)$/;
      if (
        !epic.key?.trim() ||
        !epic.title?.trim() ||
        !epicLabel.test(epic.time_label)
      ) {
        throw new BadRequestException(
          'Every epic requires a title and time label',
        );
      }
      if (
        epic.start_day_offset < 0 ||
        epic.end_day_offset < epic.start_day_offset ||
        epic.start_day_offset <= previousEnd
      ) {
        throw new BadRequestException(
          'Epic schedule offsets must be non-overlapping and monotonic',
        );
      }
      if (shortLearning && epic.end_day_offset - epic.start_day_offset > 6) {
        throw new BadRequestException(
          'Short learning epics must fit within one week',
        );
      }
      previousEnd = epic.end_day_offset;
      if (
        !Array.isArray(epic.features) ||
        epic.features.length < featureMinimum ||
        epic.features.length > featureMaximum
      ) {
        throw new BadRequestException(
          `Every epic requires between ${featureMinimum} and ${featureMaximum} features`,
        );
      }
      let previousFeatureEnd = epic.start_day_offset - 1;
      for (const feature of epic.features) {
        const featureLabel = shortLearning
          ? /^\(Day \d+(?:[–-]\d+)?\)$/
          : /^\(Week \d+(?:[–-]\d+)?\)$/;
        if (
          !feature.key?.trim() ||
          !feature.title?.trim() ||
          !featureLabel.test(feature.time_label) ||
          !Array.isArray(feature.tasks) ||
          feature.tasks.length < taskMinimum ||
          feature.tasks.length > taskMaximum
        ) {
          throw new BadRequestException(
            `Every feature requires a time label and between ${taskMinimum} and ${taskMaximum} actionable tasks`,
          );
        }
        if (
          feature.start_day_offset < epic.start_day_offset ||
          feature.end_day_offset > epic.end_day_offset ||
          feature.end_day_offset < feature.start_day_offset ||
          feature.start_day_offset <= previousFeatureEnd
        ) {
          throw new BadRequestException(
            'Feature schedules must be non-overlapping and stay inside their epic',
          );
        }
        previousFeatureEnd = feature.end_day_offset;
        if (featureKeys.has(feature.key)) {
          throw new BadRequestException('Feature keys must be unique');
        }
        featureKeys.add(feature.key);
        for (const task of feature.tasks) {
          if (
            !task.key?.trim() ||
            !task.title?.trim() ||
            !['urgent', 'high', 'medium', 'low'].includes(task.priority) ||
            !['real_work', 'training'].includes(task.work_type) ||
            (task.due_day_offset != null &&
              (task.due_day_offset < feature.start_day_offset ||
                task.due_day_offset > feature.end_day_offset))
          ) {
            throw new BadRequestException(
              'Every task requires valid execution fields and schedule offsets',
            );
          }
        }
      }
    }
    if (
      content.roadmap.start_day_offset !== 0 ||
      content.roadmap.end_day_offset < previousEnd
    ) {
      throw new BadRequestException(
        'Roadmap schedule must cover every epic offset',
      );
    }
    let previousMilestoneOffset = -1;
    for (const [milestoneIndex, milestone] of content.milestones.entries()) {
      const milestoneLabel = shortLearning
        ? /^\(End of Week \d+\)$/
        : /^\(End of Month \d+\)$/;
      if (
        !milestone.key?.trim() ||
        !milestone.title?.trim() ||
        !milestoneLabel.test(milestone.time_label) ||
        milestone.target_day_offset <= previousMilestoneOffset ||
        milestone.target_day_offset > content.roadmap.end_day_offset ||
        !milestone.feature_keys?.length
      ) {
        throw new BadRequestException(
          'Every milestone requires a valid end-of-period label, offset and feature link',
        );
      }
      if (
        shortLearning &&
        milestone.target_day_offset !==
          content.epics[milestoneIndex].end_day_offset
      ) {
        throw new BadRequestException(
          'Short learning milestones must close their learning week',
        );
      }
      previousMilestoneOffset = milestone.target_day_offset;
      for (const key of milestone.feature_keys ?? []) {
        if (!featureKeys.has(key))
          throw new BadRequestException(
            'Milestone references an unknown feature',
          );
        linkedFeatureKeys.add(key);
      }
    }
    if (linkedFeatureKeys.size !== featureKeys.size) {
      throw new BadRequestException(
        'Every feature must be covered by a milestone',
      );
    }
    const serialized = JSON.stringify(content);
    if (/<script|javascript:|onerror\s*=|onload\s*=/i.test(serialized)) {
      throw new BadRequestException('Template contains unsafe content');
    }
    if (
      /"(assignee|reporter|owner|comments|attachments|actual_hours)"\s*:/i.test(
        serialized,
      )
    ) {
      throw new BadRequestException(
        'Template contains personal or runtime execution data',
      );
    }
  }

  private async requirePublishedTemplate(id: string) {
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .select('id,slug,current_version_id')
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Roadmap template not found');
    return data;
  }

  private async requireOwnedTemplate(id: string, userId: string) {
    const { data, error } = await this.db
      .from('roadmap_public_templates')
      .select('*')
      .eq('id', id)
      .eq('owner_id', userId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Consultant template not found');
    return data;
  }

  private async assertRoadmapOwner(roadmapId: string, userId: string) {
    const { data, error } = await this.db
      .from('roadmaps')
      .select('id,owner_id,project_id')
      .eq('id', roadmapId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Source roadmap not found');
    if (data.owner_id !== userId) {
      throw new ForbiddenException(
        'Only the roadmap owner may publish it as a template',
      );
    }
    return data;
  }

  private async findCategory(slug: string) {
    const { data, error } = await this.db
      .from('roadmap_template_categories')
      .select('id,slug,name')
      .eq('slug', slug.trim().toLowerCase())
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data)
      throw new BadRequestException('Unknown roadmap template category');
    return data;
  }

  private async findAttributionName(userId: string): Promise<string> {
    const { data, error } = await this.db
      .from('profiles')
      .select('display_name,first_name,last_name')
      .eq('id', userId)
      .single();
    if (error) throw new BadRequestException(error.message);
    return (
      data.display_name?.trim() ||
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      'Proyekto consultant'
    );
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base =
      title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 70) || 'roadmap-template';
    let slug = base;
    for (let attempt = 1; attempt < 100; attempt += 1) {
      const { data } = await this.db
        .from('roadmap_public_templates')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!data) return slug;
      slug = `${base}-${attempt + 1}`;
    }
    throw new ConflictException('Unable to allocate a unique template slug');
  }

  private async replaceTags(templateId: string, tags?: string) {
    const slugs = this.parseTags(tags);
    const { error: deleteError } = await this.db
      .from('roadmap_public_template_tags')
      .delete()
      .eq('template_id', templateId);
    if (deleteError) throw new BadRequestException(deleteError.message);
    for (const slug of slugs) {
      const { data: tag, error: tagError } = await this.db
        .from('roadmap_template_tags')
        .upsert(
          {
            slug,
            name: slug
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (letter) => letter.toUpperCase()),
          },
          { onConflict: 'slug' },
        )
        .select('id')
        .single();
      if (tagError) throw new BadRequestException(tagError.message);
      const { error } = await this.db
        .from('roadmap_public_template_tags')
        .insert({ template_id: templateId, tag_id: tag.id });
      if (error && error.code !== '23505')
        throw new BadRequestException(error.message);
    }
  }

  private parseTags(tags?: string): string[] {
    if (!tags) return [];
    return [
      ...new Set(
        tags
          .split(',')
          .map((tag) =>
            tag
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, ''),
          )
          .filter(Boolean),
      ),
    ].slice(0, 10);
  }

  private decodeCursor(cursor?: string): number {
    if (!cursor) return 0;
    try {
      const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!Number.isSafeInteger(value) || value < 0) throw new Error();
      return value;
    } catch {
      throw new BadRequestException('Invalid pagination cursor');
    }
  }

  private one<T>(value: T | T[]): T {
    return Array.isArray(value) ? value[0] : value;
  }

  private async invalidatePublicTemplates(slug?: string) {
    await this.cacheInvalidation.invalidateRoadmapTemplatesCache(slug);
  }
}
