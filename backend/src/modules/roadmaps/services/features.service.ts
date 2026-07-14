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
import { RealtimePublisher } from '../../realtime/realtime-publisher.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { extractMentionedUserIds } from '../utils/mention-parser';

export const FEATURES_REPOSITORY = Symbol('FEATURES_REPOSITORY');

@Injectable()
export class FeaturesService {
  constructor(
    @Inject(FEATURES_REPOSITORY) private readonly repo: IFeaturesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly realtime: RealtimePublisher,
    private readonly notificationsService: NotificationsService,
  ) {}

  private notify(roadmapId: string | null, userId: string): void {
    if (roadmapId) this.realtime.publishRoadmapChange(roadmapId, userId);
  }

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
    this.notify(await this.roadmapAuthz.resolveRoadmapId({ epicId: dto.epic_id }), userId);
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
    this.notify(await this.roadmapAuthz.resolveRoadmapId({ featureId: id }), userId);
    return feature;
  }

  async bulkReorder(epicId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertEpicPermission(
      epicId,
      userId,
      'roadmap.edit',
    );
    const reordered = await this.repo.bulkReorder(epicId, dto);
    this.notify(await this.roadmapAuthz.resolveRoadmapId({ epicId }), userId);
    return reordered;
  }

  async findComments(featureId: string) {
    return this.repo.findComments(featureId);
  }

  async addComment(featureId: string, dto: AddCommentDto, userId: string) {
    await this.roadmapAuthz.assertFeatureCommentPermission(featureId, userId);
    const comment = await this.repo.addComment(featureId, dto, userId);

    const commentId = (comment as { id?: string }).id;
    void this.fireMentionNotifications(featureId, dto.content, userId, commentId).catch(
      () => {},
    );

    return comment;
  }

  private async fireMentionNotifications(
    featureId: string,
    html: string,
    authorId: string,
    commentId?: string,
  ): Promise<void> {
    const mentionedIds = extractMentionedUserIds(html).filter(
      (id) => id !== authorId,
    );
    if (!mentionedIds.length) return;

    const roadmapId = await this.roadmapAuthz.resolveRoadmapId({ featureId });
    const projectId = roadmapId
      ? await this.roadmapAuthz.resolveProjectId(roadmapId)
      : null;
    const linkUrl =
      projectId && roadmapId
        ? `/project/${projectId}/roadmap/${roadmapId}?nodeId=${featureId}${commentId ? `&commentId=${commentId}` : ''}`
        : null;

    await Promise.allSettled(
      mentionedIds.map((userId) =>
        this.notificationsService.createNotification({
          user_id: userId,
          actor_id: authorId,
          type_name: 'feature_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            feature_id: featureId,
            message: 'You were mentioned in a feature comment.',
          },
        }),
      ),
    );
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
    this.notify(
      await this.roadmapAuthz.resolveRoadmapId({ featureId: dto.feature_id }),
      userId,
    );
    return linked;
  }

  async unlinkMilestone(dto: UnlinkMilestoneDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.edit',
    );
    const unlinked = await this.repo.unlinkMilestone(dto);
    this.notify(
      await this.roadmapAuthz.resolveRoadmapId({ featureId: dto.feature_id }),
      userId,
    );
    return unlinked;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Feature not found');
    await this.roadmapAuthz.assertFeaturePermission(id, userId, 'roadmap.edit');
    // Resolve before deletion — the row is gone once removed.
    const roadmapId = await this.roadmapAuthz.resolveRoadmapId({ featureId: id });
    await this.repo.remove(id);
    this.notify(roadmapId, userId);
  }
}
