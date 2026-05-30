import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IFeaturesRepository } from '../repositories/features.repository.interface';
import {
  CreateFeatureDto,
  UpdateFeatureDto,
  BulkReorderDto,
  LinkMilestoneDto,
  UnlinkMilestoneDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';

export const FEATURES_REPOSITORY = Symbol('FEATURES_REPOSITORY');

@Injectable()
export class FeaturesService {
  constructor(
    @Inject(FEATURES_REPOSITORY) private readonly repo: IFeaturesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  async findByEpic(epicId: string) {
    return this.repo.findByEpic(epicId);
  }

  async findByRoadmap(roadmapId: string) {
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string) {
    const feature = await this.repo.findById(id);
    if (!feature) throw new NotFoundException('Feature not found');
    return feature;
  }

  async create(dto: CreateFeatureDto, userId: string) {
    await this.roadmapAuthz.assertEpicPermission(
      dto.epic_id,
      userId,
      'roadmap.edit',
    );
    const feature = await this.repo.create(dto, userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return feature;
  }

  async update(id: string, dto: UpdateFeatureDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Feature not found');
    await this.roadmapAuthz.assertFeaturePermission(id, userId, 'roadmap.edit');
    if (dto.epic_id && dto.epic_id !== existing.epic_id) {
      await this.roadmapAuthz.assertEpicPermission(dto.epic_id, userId, 'roadmap.edit');
    }
    const feature = await this.repo.update(id, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return feature;
  }

  async bulkReorder(epicId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertEpicPermission(
      epicId,
      userId,
      'roadmap.edit',
    );
    const reordered = await this.repo.bulkReorder(epicId, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return reordered;
  }

  async findComments(featureId: string) {
    return this.repo.findComments(featureId);
  }

  async addComment(featureId: string, dto: AddCommentDto, userId: string) {
    await this.roadmapAuthz.assertFeatureCommentPermission(featureId, userId);
    return this.repo.addComment(featureId, dto, userId);
  }

  async updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ) {
    return this.repo.updateComment(commentId, dto, userId);
  }

  async deleteComment(commentId: string, userId: string) {
    return this.repo.deleteComment(commentId, userId);
  }

  async linkMilestone(dto: LinkMilestoneDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.edit',
    );
    const linked = await this.repo.linkMilestone(dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return linked;
  }

  async unlinkMilestone(dto: UnlinkMilestoneDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.edit',
    );
    const unlinked = await this.repo.unlinkMilestone(dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return unlinked;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Feature not found');
    await this.roadmapAuthz.assertFeaturePermission(id, userId, 'roadmap.edit');
    await this.repo.remove(id);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
  }
}
