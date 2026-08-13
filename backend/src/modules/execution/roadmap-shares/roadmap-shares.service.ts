import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import type { IRoadmapSharesRepository } from './repositories/roadmap-shares.repository.interface';
import { CreateShareDto, AddShareCommentDto } from './dto/roadmap-shares.dto';
import {
  RoadmapAuthorizationService,
  type RoadmapWriteContext,
} from '../roadmaps/services/roadmap-authorization.service';
import { RoadmapActivityService } from '../roadmaps/services/roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../shared/audit/activity-actions';

export const ROADMAP_SHARES_REPOSITORY = Symbol('ROADMAP_SHARES_REPOSITORY');

export interface RoadmapPreviewMetadata {
  roadmapId: string;
  projectId: string | null;
  roadmapName: string;
  nodeId: string;
  nodeType: 'epic' | 'feature' | 'task';
  title: string;
}

@Injectable()
export class RoadmapSharesService {
  constructor(
    @Inject(ROADMAP_SHARES_REPOSITORY)
    private readonly repo: IRoadmapSharesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly activity: RoadmapActivityService,
  ) {}

  async getPreviewMetadata(
    roadmapId: string,
    nodeId: string,
  ): Promise<RoadmapPreviewMetadata> {
    const metadata = await this.repo.findPreviewMetadata(roadmapId, nodeId);
    if (!metadata) {
      throw new NotFoundException('Roadmap item not found');
    }
    return {
      roadmapId: metadata.roadmap_id,
      projectId: metadata.project_id,
      roadmapName: metadata.roadmap_name,
      nodeId: metadata.node_id,
      nodeType: metadata.node_type,
      title: metadata.node_title,
    };
  }

  async getShareByRoadmap(roadmapId: string) {
    return this.repo.findByRoadmap(roadmapId);
  }

  async getByToken(token: string) {
    const share = await this.repo.findByToken(token);
    if (!share || !share.is_active)
      throw new NotFoundException('Share link not found or inactive');
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      throw new GoneException('Share link has expired');
    }
    return share;
  }

  async getSharedWithMe(userId: string) {
    return this.repo.findSharedWithMe(userId);
  }

  /**
   * Mint (or replace) the public share link for a roadmap.
   *
   * Requires roadmap.edit. Previously this had NO authorization beyond the
   * auth guard, so any authenticated user could publish a public link for any
   * roadmap id they could guess — handing out read access to a roadmap they
   * were never a member of.
   */
  async create(roadmapId: string, dto: CreateShareDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const share = await this.repo.create(roadmapId, dto, userId);
    this.activity.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.ROADMAP_SHARE_CREATED,
      entityType: 'roadmap_share',
      entityId: (share as { id?: string })?.id ?? null,
      metadata: {
        // NEVER the token itself — an audit row is not a credential store.
        access_level: (dto as { access_level?: string }).access_level ?? null,
        expires_at: (dto as { expires_at?: string }).expires_at ?? null,
      },
    });
    return share;
  }

  /**
   * Revoke the share link. The creator may always revoke their own; anyone
   * with roadmap.edit may revoke the roadmap's link, so a link does not
   * outlive its creator's involvement in the project.
   */
  async remove(roadmapId: string, userId: string) {
    const share = await this.repo.findByRoadmap(roadmapId);
    if (!share) throw new NotFoundException('Share not found');

    let ctx: RoadmapWriteContext | null = null;
    try {
      ctx = await this.roadmapAuthz.assertRoadmapPermission(
        roadmapId,
        userId,
        'roadmap.edit',
      );
    } catch {
      if (share.created_by !== userId) {
        throw new ForbiddenException('Not the owner');
      }
    }

    const removed = await this.repo.remove(roadmapId, userId);
    this.activity.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.ROADMAP_SHARE_REVOKED,
      entityType: 'roadmap_share',
      entityId: (share as { id?: string })?.id ?? null,
      metadata: { created_by: share.created_by ?? null },
    });
    return removed;
  }

  async addEpicComment(
    epicId: string,
    dto: AddShareCommentDto,
    userId?: string,
  ) {
    return this.repo.addEpicComment(epicId, dto, userId);
  }

  async addFeatureComment(
    featureId: string,
    dto: AddShareCommentDto,
    userId?: string,
  ) {
    return this.repo.addFeatureComment(featureId, dto, userId);
  }
}
