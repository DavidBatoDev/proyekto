import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
import {
  CreateTaskDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';

export const TASKS_REPOSITORY = Symbol('TASKS_REPOSITORY');

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
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
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdateTaskDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.edit');
    return this.repo.update(id, dto);
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      featureId,
      userId,
      'roadmap.edit',
    );
    return this.repo.bulkReorder(featureId, dto);
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.edit');
    return this.repo.remove(id);
  }
}
