import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../../common/cache/redis-data-cache.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import { countRoadmapChildren } from '../repositories/roadmaps.repository.supabase';
import {
  CreateRoadmapDto,
  UpdateRoadmapDto,
  UpdateRoadmapTemplateSettingsDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';

export const ROADMAPS_REPOSITORY = Symbol('ROADMAPS_REPOSITORY');

interface CacheReadOptions {
  onCacheStatus?: (status: AppCacheStatus) => void;
}

@Injectable()
export class RoadmapsService {
  private readonly logger = new Logger(RoadmapsService.name);

  constructor(
    @Inject(ROADMAPS_REPOSITORY) private readonly repo: IRoadmapsRepository,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cache: RedisDataCacheService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  private async invalidatePublicTemplatesCache(): Promise<void> {
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
  }

  async replaceProjectRoadmap(
    projectId: string,
    replacementRoadmapId: string,
    userId: string,
  ) {
    await this.roadmapAuthz.assertProjectRoadmapPermission(
      projectId,
      userId,
      'roadmap.edit',
    );

    const current = await this.repo.findByProjectId(projectId, userId);
    if (!current) {
      throw new NotFoundException(
        'No roadmap is currently linked to this project.',
      );
    }

    const totalChildren = await countRoadmapChildren(this.supabase, current.id);
    if (totalChildren > 0) {
      throw new BadRequestException(
        'Current roadmap is not empty; only empty roadmaps can be replaced.',
      );
    }

    if (replacementRoadmapId === current.id) {
      throw new BadRequestException(
        'Replacement roadmap must differ from the current roadmap.',
      );
    }

    const replacement = await this.repo.findById(replacementRoadmapId);
    if (!replacement) {
      throw new NotFoundException('Replacement roadmap not found');
    }
    if (replacement.owner_id !== userId) {
      throw new ForbiddenException('You can only link a roadmap you own.');
    }
    if (replacement.project_id) {
      throw new BadRequestException(
        'Replacement roadmap is already linked to a project.',
      );
    }

    const { data: linked, error: linkError } = await this.supabase
      .from('roadmaps')
      .update({ project_id: projectId, updated_at: new Date().toISOString() })
      .eq('id', replacementRoadmapId)
      .is('project_id', null)
      .eq('owner_id', userId)
      .select()
      .single();
    if (linkError || !linked) {
      throw new BadRequestException(
        `Failed to link replacement roadmap: ${
          linkError?.message ?? 'unknown error'
        }`,
      );
    }

    const { error: deleteError } = await this.supabase
      .from('roadmaps')
      .delete()
      .eq('id', current.id);
    if (deleteError) {
      this.logger.error(
        `Failed to delete old empty roadmap ${current.id} after linking replacement ${replacementRoadmapId}; attempting to unlink replacement. Cause: ${deleteError.message}`,
      );
      const { error: revertError } = await this.supabase
        .from('roadmaps')
        .update({ project_id: null })
        .eq('id', replacementRoadmapId);
      if (revertError) {
        this.logger.error(
          `Revert unlink of replacement ${replacementRoadmapId} also failed: ${revertError.message}. Manual cleanup required for project ${projectId}.`,
        );
      }
      throw new BadRequestException(
        'Could not delete the previous empty roadmap; please retry.',
      );
    }

    await this.invalidatePublicTemplatesCache();
    return linked;
  }

  private async ensureConsultant(userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, is_consultant_verified')
      .eq('id', userId)
      .single();

    if (error || !data || !data.is_consultant_verified) {
      throw new MissingPermissionException({
        path: null,
        label: 'access this consultant feature',
        message:
          'This action is limited to verified consultants. Apply to lead on Proyekto to unlock it.',
      });
    }
  }

  async findAll(userId: string) {
    return this.repo.findAll(userId);
  }

  async getAllFull(userId: string) {
    return this.repo.findAllFull(userId);
  }

  async findPreviews(userId: string) {
    return this.repo.findPreviews(userId);
  }

  async findByUser(userId: string) {
    return this.repo.findByUser(userId);
  }

  async findByProjectId(projectId: string, userId: string) {
    const roadmap = await this.repo.findByProjectId(projectId, userId);
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return roadmap;
  }

  async findById(id: string, userId: string) {
    const roadmap = await this.repo.findById(id, userId);
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return roadmap;
  }

  async findFull(id: string, userId: string) {
    const roadmap = await this.repo.findFull(id, userId);
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return roadmap;
  }

  async create(dto: CreateRoadmapDto, userId: string) {
    if (dto.project_id) {
      await this.roadmapAuthz.assertProjectRoadmapPermission(
        dto.project_id,
        userId,
        'roadmap.edit',
      );
    }
    const created = await this.repo.create(dto, userId);
    await this.invalidatePublicTemplatesCache();
    return created;
  }

  async findConsultantTemplateRoadmaps(userId: string) {
    await this.ensureConsultant(userId);
    return this.repo.findConsultantProjectless(userId);
  }

  async findPublicTemplates(options?: CacheReadOptions) {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.publicRoadmapTemplates,
      this.cache.getPublicTtlSeconds(),
      async () => this.repo.findPublicTemplatePreviews(),
      { onStatus: options?.onCacheStatus },
    );
  }

  async updateTemplateSettings(
    id: string,
    dto: UpdateRoadmapTemplateSettingsDto,
    userId: string,
  ) {
    await this.ensureConsultant(userId);

    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Roadmap not found');

    if (existing.project_id) {
      await this.roadmapAuthz.assertRoadmapPermission(
        existing.id,
        userId,
        'roadmap.edit',
      );
      const updated = await this.repo.update(id, dto);
      await this.invalidatePublicTemplatesCache();
      return updated;
    }

    if (existing.owner_id !== userId) {
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'modify this roadmap',
      });
    }

    const updated = await this.repo.update(id, dto);
    await this.invalidatePublicTemplatesCache();
    return updated;
  }

  async cloneFromTemplate(templateId: string, userId: string) {
    const cloned = await this.repo.cloneFromTemplate(templateId, userId);
    await this.invalidatePublicTemplatesCache();
    return cloned;
  }

  async update(id: string, dto: UpdateRoadmapDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Roadmap not found');

    if (existing.project_id) {
      await this.roadmapAuthz.assertRoadmapPermission(
        id,
        userId,
        'roadmap.edit',
      );
      const updated = await this.repo.update(id, dto);
      await this.invalidatePublicTemplatesCache();
      return updated;
    }

    if (existing.owner_id !== userId)
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'modify this roadmap',
      });
    const updated = await this.repo.update(id, dto);
    await this.invalidatePublicTemplatesCache();
    return updated;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Roadmap not found');

    if (existing.project_id) {
      await this.roadmapAuthz.assertRoadmapPermission(
        id,
        userId,
        'roadmap.edit',
      );
      await this.repo.remove(id);
      await this.invalidatePublicTemplatesCache();
      return;
    }

    if (existing.owner_id !== userId)
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'modify this roadmap',
      });
    await this.repo.remove(id);
    await this.invalidatePublicTemplatesCache();
  }

  async migrateGuestRoadmaps(sessionId: string, userId: string) {
    return this.repo.migrateGuestRoadmaps(sessionId, userId);
  }
}
