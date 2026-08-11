import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IMilestonesRepository } from '../repositories/milestones.repository.interface';
import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
  ReorderDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../../audit/activity-actions';

export const MILESTONES_REPOSITORY = Symbol('MILESTONES_REPOSITORY');

const MILESTONE_TRACKED_FIELDS = [
  'title',
  'description',
  'target_date',
  'status',
  'color',
];

@Injectable()
export class MilestonesService {
  constructor(
    @Inject(MILESTONES_REPOSITORY) private readonly repo: IMilestonesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly effects: RoadmapWriteEffects,
    private readonly activity: RoadmapActivityService,
  ) {}

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
    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const milestone = await this.repo.create(roadmapId, dto, userId);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.MILESTONE_CREATED,
      entityType: 'milestone',
      entityId: (milestone as { id?: string })?.id ?? null,
      title: dto.title,
      metadata: { target_date: dto.target_date },
    });
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
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.MILESTONE_UPDATED,
      entityType: 'milestone',
      entityId: id,
      title: (milestone as { title?: string })?.title ?? existing.title,
      metadata: {
        changes: this.activity.diff(
          existing,
          milestone,
          MILESTONE_TRACKED_FIELDS,
        ),
      },
    });
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
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.MILESTONE_REORDERED,
      entityType: 'milestone',
      entityId: id,
      title: (existing as { title?: string })?.title ?? null,
      metadata: { position: dto.position },
    });
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
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.MILESTONE_DELETED,
      entityType: 'milestone',
      entityId: id,
      title: (existing as { title?: string })?.title ?? null,
    });
  }
}
