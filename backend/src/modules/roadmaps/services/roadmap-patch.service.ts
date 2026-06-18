import {
  BadRequestException,
  InternalServerErrorException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  CreateFullRoadmapDto,
  FullRoadmapEpicDto,
  FullRoadmapFeatureDto,
  FullRoadmapState,
  FullRoadmapTaskDto,
  JsonPatchOperationDto,
} from '../dto/patch-roadmap.dto';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import type { IRoadmapPatchRepository } from '../repositories/roadmap-patch.repository.interface';
import { RoadmapJsonPatchProcessor } from '../patch/roadmap-json-patch.processor';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import { RealtimePublisher } from '../../realtime/realtime-publisher.service';

export const ROADMAP_PATCH_REPOSITORY = Symbol('ROADMAP_PATCH_REPOSITORY');

@Injectable()
export class RoadmapPatchService {
  private readonly logger = new Logger(RoadmapPatchService.name);

  constructor(
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    @Inject(ROADMAP_PATCH_REPOSITORY)
    private readonly patchRepo: IRoadmapPatchRepository,
    private readonly patchProcessor: RoadmapJsonPatchProcessor,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async createFull(dto: CreateFullRoadmapDto, userId: string) {
    const roadmapId = dto.id ?? randomUUID();
    let upsertOwnerId = userId;
    let resolvedProjectId = dto.project_id;

    if (dto.id) {
      const existing = await this.roadmapsRepo.findById(dto.id);
      if (existing?.project_id) {
        await this.roadmapAuthz.assertRoadmapPermission(
          existing.id,
          userId,
          'roadmap.edit',
        );
      } else if (existing && existing.owner_id !== userId) {
        throw new MissingPermissionException({
          path: null,
          requiredRole: 'owner',
          label: 'modify this roadmap',
        });
      }

      if (existing) {
        if (!existing.owner_id) {
          throw new InternalServerErrorException(
            'Roadmap owner is missing for an existing roadmap',
          );
        }

        upsertOwnerId = existing.owner_id;

        const hasExplicitProjectId = Object.prototype.hasOwnProperty.call(
          dto,
          'project_id',
        );
        if (!hasExplicitProjectId) {
          resolvedProjectId = existing.project_id;
        }
      }
    }

    if (dto.project_id) {
      await this.roadmapAuthz.assertProjectRoadmapPermission(
        dto.project_id,
        userId,
        'roadmap.edit',
      );
    }

    const normalizedState = this.normalizeFullRoadmapState({
      ...dto,
      id: roadmapId,
      project_id: resolvedProjectId,
    });

    await this.patchRepo.upsertFullRoadmap({
      roadmapId,
      ownerId: upsertOwnerId,
      fullState: normalizedState,
      createIfMissing: true,
    });

    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    this.realtime.publishRoadmapChange(roadmapId, userId);
    return this.roadmapsRepo.findFull(roadmapId, userId);
  }

  async applyPatch(
    roadmapId: string,
    operations: JsonPatchOperationDto[],
    userId: string,
  ) {
    const startedAt = Date.now();
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new BadRequestException(
        'Patch operations must be a non-empty array',
      );
    }

    this.logger.log(
      [
        'event=roadmap_patch_apply_start',
        `roadmap_id=${roadmapId}`,
        `operations_count=${operations.length}`,
      ].join(' '),
    );

    const existing = await this.roadmapsRepo.findById(roadmapId);
    if (!existing) throw new NotFoundException('Roadmap not found');
    if (!existing.owner_id) {
      throw new InternalServerErrorException(
        'Roadmap owner is missing for an existing roadmap',
      );
    }
    const upsertOwnerId = existing.owner_id;

    if (existing.project_id) {
      await this.roadmapAuthz.assertRoadmapPermission(
        roadmapId,
        userId,
        'roadmap.edit',
      );
    } else if (existing.owner_id !== userId)
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'modify this roadmap',
      });

    const currentState = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!currentState) throw new NotFoundException('Roadmap not found');

    const patchedState = this.patchProcessor.apply(
      this.normalizeFullRoadmapState(currentState),
      operations,
    );

    const beforeCounts = this.summarizeRoadmapState(currentState);
    const afterCounts = this.summarizeRoadmapState(patchedState);

    const normalizedPatchedState = this.normalizeFullRoadmapState({
      ...patchedState,
      id: roadmapId,
    });

    await this.patchRepo.upsertFullRoadmap({
      roadmapId,
      ownerId: upsertOwnerId,
      fullState: normalizedPatchedState,
      createIfMissing: false,
    });

    this.logger.log(
      [
        'event=roadmap_patch_apply_upsert_success',
        `roadmap_id=${roadmapId}`,
        `operations_count=${operations.length}`,
        `before_epics=${beforeCounts.epics}`,
        `before_features=${beforeCounts.features}`,
        `before_tasks=${beforeCounts.tasks}`,
        `after_epics=${afterCounts.epics}`,
        `after_features=${afterCounts.features}`,
        `after_tasks=${afterCounts.tasks}`,
        `elapsed_ms=${Date.now() - startedAt}`,
      ].join(' '),
    );

    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    this.realtime.publishRoadmapChange(roadmapId, userId);
    return this.roadmapsRepo.findFull(roadmapId, userId);
  }

  private summarizeRoadmapState(state: FullRoadmapState): {
    epics: number;
    features: number;
    tasks: number;
  } {
    const epics = state.roadmap_epics?.length ?? 0;
    const features = (state.roadmap_epics ?? []).reduce(
      (count, epic) => count + (epic.roadmap_features?.length ?? 0),
      0,
    );
    const tasks = (state.roadmap_epics ?? []).reduce(
      (count, epic) =>
        count +
        (epic.roadmap_features ?? []).reduce(
          (featureCount, feature) =>
            featureCount + (feature.roadmap_tasks?.length ?? 0),
          0,
        ),
      0,
    );
    return { epics, features, tasks };
  }

  private normalizeFullRoadmapState(state: FullRoadmapState): FullRoadmapState {
    const roadmapEpics = (state.roadmap_epics ?? []).map((epic, epicIndex) =>
      this.normalizeEpic(epic, epicIndex),
    );

    return {
      id: state.id,
      name: state.name,
      description: state.description,
      project_id: state.project_id,
      status: state.status ?? 'draft',
      start_date: state.start_date,
      end_date: state.end_date,
      settings: state.settings ?? {},
      roadmap_epics: roadmapEpics,
    };
  }

  private normalizeEpic(
    epic: FullRoadmapEpicDto,
    epicIndex: number,
  ): FullRoadmapEpicDto {
    return {
      id: epic.id ?? randomUUID(),
      title: epic.title,
      description: epic.description,
      status: epic.status ?? 'backlog',
      priority: epic.priority ?? 'medium',
      position: epic.position ?? epicIndex,
      color: epic.color,
      start_date: epic.start_date,
      end_date: epic.end_date,
      tags: epic.tags ?? [],
      roadmap_features: (epic.roadmap_features ?? []).map(
        (feature, featureIndex) => this.normalizeFeature(feature, featureIndex),
      ),
    };
  }

  private normalizeFeature(
    feature: FullRoadmapFeatureDto,
    featureIndex: number,
  ): FullRoadmapFeatureDto {
    return {
      id: feature.id ?? randomUUID(),
      title: feature.title,
      description: feature.description,
      position: feature.position ?? featureIndex,
      is_deliverable: feature.is_deliverable ?? true,
      start_date: feature.start_date,
      end_date: feature.end_date,
      roadmap_tasks: (feature.roadmap_tasks ?? []).map((task, taskIndex) =>
        this.normalizeTask(task, taskIndex),
      ),
    };
  }

  private normalizeTask(
    task: FullRoadmapTaskDto,
    taskIndex: number,
  ): FullRoadmapTaskDto {
    return {
      id: task.id ?? randomUUID(),
      title: task.title,
      description: task.description,
      status: task.status ?? 'todo',
      priority: task.priority ?? 'medium',
      assignee_id: task.assignee_id,
      due_date: task.due_date,
      position: task.position ?? taskIndex,
    };
  }
}
