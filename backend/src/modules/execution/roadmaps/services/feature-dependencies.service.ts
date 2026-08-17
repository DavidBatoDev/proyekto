import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';
import { CreateFeatureDependencyDto } from '../dto/roadmaps.dto';
import {
  FeatureDependencyRow,
  IFeatureDependenciesRepository,
} from '../repositories/feature-dependencies.repository.interface';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';

export const FEATURE_DEPENDENCIES_REPOSITORY = Symbol(
  'FEATURE_DEPENDENCIES_REPOSITORY',
);

/**
 * Finish->Start (and later SS/FF) edges between features, drawn as arrows in
 * the Timeline. Task-level edges live in TaskExtrasService.
 *
 * The `:roadmapId` in the URL is untrusted, so every write authorizes against
 * it and then proves both endpoints actually belong to it. The database
 * trigger enforces the same rule plus acyclicity — this layer exists so the
 * user gets a 404/409 with usable copy instead of a raw constraint error.
 */
@Injectable()
export class FeatureDependenciesService {
  constructor(
    @Inject(FEATURE_DEPENDENCIES_REPOSITORY)
    private readonly repo: IFeatureDependenciesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly effects: RoadmapWriteEffects,
  ) {}

  async list(
    roadmapId: string,
    userId: string,
  ): Promise<FeatureDependencyRow[]> {
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    return this.repo.listForRoadmap(roadmapId);
  }

  async create(
    roadmapId: string,
    dto: CreateFeatureDependencyDto,
    userId: string,
  ): Promise<FeatureDependencyRow> {
    // Caught before the database so the user gets "cannot depend on itself"
    // rather than the cycle trigger's "circular dependency" — technically true
    // (a self-link is a 1-cycle) but unhelpful.
    if (dto.blocking_feature_id === dto.blocked_feature_id) {
      throw new BadRequestException('A feature cannot depend on itself');
    }

    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );

    // One query proves both endpoints live in this roadmap. 404 rather than
    // 403 so a feature id from another roadmap never confirms its existence.
    const found = await this.repo.findFeatureIdsInRoadmap(roadmapId, [
      dto.blocking_feature_id,
      dto.blocked_feature_id,
    ]);
    if (found.length !== 2) {
      throw new NotFoundException('Feature not found');
    }

    const dependency = await this.repo.create(roadmapId, dto, userId);

    // emit(), not record(): an arrow is canvas state, so collaborators need the
    // realtime data_changed broadcast to see it without a reload.
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_DEPENDENCY_ADDED,
      entityType: 'feature_dependency',
      entityId: dependency?.id ?? null,
      metadata: {
        blocking: { id: dto.blocking_feature_id },
        blocked: { id: dto.blocked_feature_id },
        dependency_type: dto.dependency_type ?? 'FS',
      },
    });

    return dependency;
  }

  async remove(
    roadmapId: string,
    dependencyId: string,
    userId: string,
  ): Promise<void> {
    // Resolve first and confirm the edge belongs to the roadmap in the URL,
    // then require edit rights. 404 (not 403) so we never leak its existence.
    const dependency = await this.repo.findById(dependencyId);
    if (!dependency || dependency.roadmap_id !== roadmapId) {
      throw new NotFoundException('Dependency not found');
    }

    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );

    await this.repo.remove(dependencyId);

    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_DEPENDENCY_REMOVED,
      entityType: 'feature_dependency',
      entityId: dependencyId,
      metadata: {
        blocking: { id: dependency.blocking_feature_id },
        blocked: { id: dependency.blocked_feature_id },
      },
    });
  }
}
