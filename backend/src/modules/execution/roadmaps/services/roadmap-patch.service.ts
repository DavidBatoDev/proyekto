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
import { RealtimePublisher } from '../../../shared/realtime/realtime-publisher.service';
import { deriveFeatureStatus } from './derive-feature-status';

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
      // Recorded as roadmap_task_assignees.assigned_by for new join rows.
      actorId: userId,
    });

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

    const normalizedCurrentState = this.normalizeFullRoadmapState(currentState);
    const patchedState = this.patchProcessor.apply(
      normalizedCurrentState,
      operations,
    );
    this.dropSupersededAssigneeSets(normalizedCurrentState, patchedState);

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
      // Recorded as roadmap_task_assignees.assigned_by for new join rows.
      actorId: userId,
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

  /**
   * The state handed to the JSON patch is normalized, so every task already
   * carries `assignee_ids` (the stored set) next to its scalar — and the
   * post-patch normalization lets that set win over the scalar. A legacy
   * single-assignee client patches `/assignee_id` alone, so without this step
   * its change would be silently discarded. Mirror the RPC's changed-scalar
   * rule instead: when a task's scalar changed and its set did not, the scalar
   * is the caller's intent — drop the stale set so the task is sent
   * scalar-only and the RPC reconciles the join table to [new] (or {} for
   * null). An unchanged scalar keeps the set (co-assignees survive an edit
   * that re-sends the scalar), and a task whose set was patched keeps it too:
   * explicit wins. Keyed by task id rather than by patch path so array
   * insertions/removals earlier in the same patch cannot shift the target.
   */
  private dropSupersededAssigneeSets(
    before: FullRoadmapState,
    after: FullRoadmapState,
  ): void {
    const priorById = new Map<string, FullRoadmapTaskDto>();
    for (const task of this.listTasks(before)) {
      if (task.id) priorById.set(task.id, task);
    }
    for (const task of this.listTasks(after)) {
      const prior = task.id ? priorById.get(task.id) : undefined;
      if (!prior) continue;
      const scalarChanged =
        (task.assignee_id ?? null) !== (prior.assignee_id ?? null);
      const setChanged = !this.sameIdList(
        task.assignee_ids,
        prior.assignee_ids,
      );
      if (scalarChanged && !setChanged) delete task.assignee_ids;
    }
  }

  private listTasks(state: FullRoadmapState): FullRoadmapTaskDto[] {
    return (state.roadmap_epics ?? []).flatMap((epic) =>
      (epic.roadmap_features ?? []).flatMap(
        (feature) => feature.roadmap_tasks ?? [],
      ),
    );
  }

  private sameIdList(left: unknown, right: unknown): boolean {
    if (!Array.isArray(left) || !Array.isArray(right)) return left === right;
    return (
      left.length === right.length &&
      left.every((id, index) => id === right[index])
    );
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
    const roadmapTasks = (feature.roadmap_tasks ?? []).map((task, taskIndex) =>
      this.normalizeTask(task, taskIndex),
    );
    // With tasks present, status is always cascade-derived — never trust a
    // caller-supplied value once the feature isn't task-less anymore.
    const status =
      roadmapTasks.length > 0
        ? deriveFeatureStatus(roadmapTasks)
        : (feature.status ?? 'not_started');

    return {
      id: feature.id ?? randomUUID(),
      title: feature.title,
      description: feature.description,
      position: feature.position ?? featureIndex,
      is_deliverable: feature.is_deliverable ?? true,
      start_date: feature.start_date,
      end_date: feature.end_date,
      status,
      roadmap_tasks: roadmapTasks,
    };
  }

  private normalizeTask(
    task: FullRoadmapTaskDto,
    taskIndex: number,
  ): FullRoadmapTaskDto {
    const assigneeIds = this.readTaskAssigneeIds(task);
    return {
      id: task.id ?? randomUUID(),
      title: task.title,
      description: task.description,
      status: task.status ?? 'todo',
      priority: task.priority ?? 'medium',
      // Scalar-only caller (neither `assignees` nor `assignee_ids`): the scalar
      // passes through unchanged and NO `assignee_ids` key is sent, so the
      // RPC's changed-scalar branch decides whether the join table moves.
      ...(assigneeIds === undefined
        ? { assignee_id: task.assignee_id }
        : { assignee_id: assigneeIds[0], assignee_ids: assigneeIds }),
      due_date: task.due_date,
      position: task.position ?? taskIndex,
    };
  }

  /**
   * Canonical assignee set of a task on the legacy JSON-patch / createFull
   * path, primary first: the persisted join rows (`assignees[]`, as returned by
   * findFull), else an explicit `assignee_ids` — or `undefined` when the task
   * carries neither array. That is a scalar-only caller (a stale web bundle
   * POSTing /roadmaps/full, a raw single-assignee client) whose `assignee_id`
   * is passed through untouched so the RPC's changed-scalar branch decides
   * whether the join table moves. When a set IS derived, the scalar is unioned
   * in (and rotated to the front) so a row written by the pre-2026-09 RPC —
   * column set, no join row — keeps its assignee, and the state carries
   * `assignee_ids` equal to the stored set: the RPC's reconciliation is then a
   * no-op for edits that never touched assignment.
   */
  private readTaskAssigneeIds(task: FullRoadmapTaskDto): string[] | undefined {
    const joinRows = (task as { assignees?: unknown }).assignees;
    const fromRows = Array.isArray(joinRows)
      ? joinRows
          .map((row: unknown) => {
            if (!row || typeof row !== 'object') return undefined;
            const record = row as Record<string, unknown>;
            const profile = record.profile as
              | Record<string, unknown>
              | undefined;
            const candidate = record.id ?? record.assignee_id ?? profile?.id;
            return typeof candidate === 'string' ? candidate : undefined;
          })
          .filter((id): id is string => typeof id === 'string')
      : undefined;
    const explicit = Array.isArray(task.assignee_ids)
      ? task.assignee_ids.filter((id) => typeof id === 'string' && id)
      : undefined;
    if (fromRows === undefined && explicit === undefined) return undefined;
    const base = fromRows ?? explicit ?? [];
    const scalar =
      typeof task.assignee_id === 'string' && task.assignee_id
        ? task.assignee_id
        : undefined;
    const ordered =
      scalar && explicit === undefined
        ? [scalar, ...base.filter((id) => id !== scalar)]
        : base;
    return [...new Set(ordered)];
  }
}
