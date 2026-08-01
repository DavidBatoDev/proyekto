import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IMilestonesRepository } from '../repositories/milestones.repository.interface';
import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
  ReorderDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RealtimePublisher } from '../../realtime/realtime-publisher.service';

export const MILESTONES_REPOSITORY = Symbol('MILESTONES_REPOSITORY');

@Injectable()
export class MilestonesService {
  constructor(
    @Inject(MILESTONES_REPOSITORY) private readonly repo: IMilestonesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly realtime: RealtimePublisher,
  ) {}

  private notify(roadmapId: string | null, userId: string): void {
    if (roadmapId) this.realtime.publishRoadmapChange(roadmapId, userId);
  }

  async findByRoadmap(roadmapId: string, userId: string) {
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ milestoneId: id }, userId);
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
    this.notify(roadmapId, userId);
    return milestone;
  }

  async update(id: string, dto: UpdateMilestoneDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Milestone not found');
    const ctx = await this.roadmapAuthz.assertMilestonePermission(
      id,
      userId,
      'roadmap.edit',
    );
    const milestone = await this.repo.update(id, dto);
    this.notify(ctx.roadmapId, userId);
    return milestone;
  }

  async reorder(id: string, dto: ReorderDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Milestone not found');
    const ctx = await this.roadmapAuthz.assertMilestonePermission(
      id,
      userId,
      'roadmap.edit',
    );
    const milestone = await this.repo.reorder(id, dto);
    this.notify(ctx.roadmapId, userId);
    return milestone;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Milestone not found');
    // The authz walk already resolved the owning roadmap, and it did so before
    // the delete — no post-delete re-read needed.
    const ctx = await this.roadmapAuthz.assertMilestonePermission(
      id,
      userId,
      'roadmap.edit',
    );
    await this.repo.remove(id);
    this.notify(ctx.roadmapId, userId);
  }
}
