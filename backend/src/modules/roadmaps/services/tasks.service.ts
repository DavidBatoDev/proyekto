import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
import {
  CreateTaskDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';

export const TASKS_REPOSITORY = Symbol('TASKS_REPOSITORY');

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  async findByFeature(featureId: string) {
    return this.repo.findByFeature(featureId);
  }

  async findByRoadmap(roadmapId: string) {
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string) {
    const task = await this.repo.findById(id);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async create(dto: CreateTaskDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.edit',
    );
    const task = await this.repo.create(dto, userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.edit');
    const task = await this.repo.update(id, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return task;
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      featureId,
      userId,
      'roadmap.edit',
    );
    const reordered = await this.repo.bulkReorder(featureId, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return reordered;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.edit');
    await this.repo.remove(id);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
  }
}
