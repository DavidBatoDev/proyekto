import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IMilestonesRepository } from '../repositories/milestones.repository.interface';
import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
  ReorderDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';

export const MILESTONES_REPOSITORY = Symbol('MILESTONES_REPOSITORY');

@Injectable()
export class MilestonesService {
  constructor(
    @Inject(MILESTONES_REPOSITORY) private readonly repo: IMilestonesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  async findByRoadmap(roadmapId: string) {
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string) {
    const milestone = await this.repo.findById(id);
    if (!milestone) throw new NotFoundException('Milestone not found');
    return milestone;
  }

  async create(roadmapId: string, dto: CreateMilestoneDto, userId: string) {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const milestone = await this.repo.create(roadmapId, dto, userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return milestone;
  }

  async update(id: string, dto: UpdateMilestoneDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Milestone not found');
    await this.roadmapAuthz.assertMilestonePermission(
      id,
      userId,
      'roadmap.edit',
    );
    const milestone = await this.repo.update(id, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return milestone;
  }

  async reorder(id: string, dto: ReorderDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Milestone not found');
    await this.roadmapAuthz.assertMilestonePermission(
      id,
      userId,
      'roadmap.edit',
    );
    const milestone = await this.repo.reorder(id, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return milestone;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Milestone not found');
    await this.roadmapAuthz.assertMilestonePermission(
      id,
      userId,
      'roadmap.edit',
    );
    await this.repo.remove(id);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
  }
}
