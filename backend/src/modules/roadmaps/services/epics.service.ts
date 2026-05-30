import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IEpicsRepository } from '../repositories/epics.repository.interface';
import {
  CreateEpicDto,
  UpdateEpicDto,
  BulkReorderDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';

export const EPICS_REPOSITORY = Symbol('EPICS_REPOSITORY');
const TEMP_EPIC_ID_PREFIX = 'temp-epic-';

@Injectable()
export class EpicsService {
  constructor(
    @Inject(EPICS_REPOSITORY) private readonly repo: IEpicsRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  async findByRoadmap(roadmapId: string) {
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string) {
    const epic = await this.repo.findById(id);
    if (!epic) throw new NotFoundException('Epic not found');
    return epic;
  }

  async create(dto: CreateEpicDto, userId: string) {
    await this.roadmapAuthz.assertRoadmapPermission(
      dto.roadmap_id,
      userId,
      'roadmap.edit',
    );
    const epic = await this.repo.create(dto, userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return epic;
  }

  async update(id: string, dto: UpdateEpicDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Epic not found');
    await this.roadmapAuthz.assertEpicPermission(id, userId, 'roadmap.edit');
    const epic = await this.repo.update(id, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return epic;
  }

  async bulkReorder(roadmapId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const reordered = await this.repo.bulkReorder(roadmapId, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return reordered;
  }

  async findComments(epicId: string) {
    return this.repo.findComments(epicId);
  }

  async addComment(epicId: string, dto: AddCommentDto, userId: string) {
    await this.roadmapAuthz.assertEpicCommentPermission(epicId, userId);
    return this.repo.addComment(epicId, dto, userId);
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

  async remove(id: string, userId: string) {
    // Optimistic UI rows may issue a delete before a real UUID exists.
    // Treat client temp IDs as already-removed to keep delete idempotent.
    if (id.startsWith(TEMP_EPIC_ID_PREFIX)) {
      return;
    }

    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Epic not found');
    await this.roadmapAuthz.assertEpicPermission(id, userId, 'roadmap.edit');
    await this.repo.remove(id);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
  }
}
