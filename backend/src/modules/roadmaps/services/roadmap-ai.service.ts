import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  FullRoadmapEpicDto,
  FullRoadmapFeatureDto,
  FullRoadmapState,
  FullRoadmapTaskDto,
} from '../dto/patch-roadmap.dto';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import type { IRoadmapPatchRepository } from '../repositories/roadmap-patch.repository.interface';
import { ROADMAP_PATCH_REPOSITORY } from './roadmap-patch.service';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import type {
  RoadmapAiCommitDto,
  RoadmapAiCommitResponseDto,
  RoadmapAiOperationDto,
  RoadmapAiPreviewDto,
  RoadmapAiPreviewResponseDto,
  RoadmapAiRollbackDto,
  RoadmapAiRollbackResponseDto,
  RoadmapNodeType,
  RoadmapValidationIssueCode,
  RoadmapValidationIssueDto,
  SemanticDiffChangeDto,
  SemanticDiffDto,
} from '../dto/roadmap-ai.dto';

type Severity = 'error' | 'warning';

type NodeRef = {
  type: RoadmapNodeType;
  id: string;
};

type NodeLocator =
  | {
      type: 'roadmap';
      roadmap: FullRoadmapState;
    }
  | {
      type: 'epic';
      epic: FullRoadmapEpicDto;
      epicIndex: number;
      roadmap: FullRoadmapState;
    }
  | {
      type: 'feature';
      feature: FullRoadmapFeatureDto;
      featureIndex: number;
      epic: FullRoadmapEpicDto;
      epicIndex: number;
      roadmap: FullRoadmapState;
    }
  | {
      type: 'task';
      task: FullRoadmapTaskDto;
      taskIndex: number;
      feature: FullRoadmapFeatureDto;
      featureIndex: number;
      epic: FullRoadmapEpicDto;
      epicIndex: number;
      roadmap: FullRoadmapState;
    };

type PreviewRecord = {
  roadmapId: string;
  userId: string;
  baseUpdatedAt: string;
  baseRevision?: number;
  createdAt: string;
  candidate: FullRoadmapState;
  semanticDiff: SemanticDiffDto;
  validationIssues: RoadmapValidationIssueDto[];
};

type FlatNodeSnapshot = {
  id: string;
  type: RoadmapNodeType;
  parentId?: string;
  position?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  dependencies?: string[];
};

const PREVIEW_TTL_MS = 1000 * 60 * 30;
const EPIC_STATUS = [
  'backlog',
  'planned',
  'in_progress',
  'in_review',
  'completed',
  'on_hold',
];
const FEATURE_STATUS = [
  'not_started',
  'in_progress',
  'in_review',
  'completed',
  'blocked',
];
const TASK_STATUS = ['todo', 'in_progress', 'in_review', 'done', 'blocked'];
const ROADMAP_STATUS = ['draft', 'active', 'paused', 'completed', 'archived'];

@Injectable()
export class RoadmapAiService {
  private readonly previews = new Map<string, PreviewRecord>();

  constructor(
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    @Inject(ROADMAP_PATCH_REPOSITORY)
    private readonly patchRepo: IRoadmapPatchRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
  ) {}

  async preview(
    roadmapId: string,
    dto: RoadmapAiPreviewDto,
    userId: string,
  ): Promise<RoadmapAiPreviewResponseDto> {
    const baseRoadmap = await this.assertCanEditRoadmap(roadmapId, userId);
    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!full) throw new NotFoundException('Roadmap not found');

    const base = this.normalizeFullRoadmapState(
      full as unknown as Record<string, unknown>,
    );
    const candidate = this.clone(base);
    const operationIssues = this.applyOperations(candidate, dto.operations);
    const validationIssues = [
      ...operationIssues,
      ...this.validateState(candidate),
      ...this.validateOptimisticRevision(dto.base_revision, baseRoadmap.updated_at),
    ];
    const semanticDiff = this.computeSemanticDiff(base, candidate);

    const previewId = randomUUID();
    const record: PreviewRecord = {
      roadmapId,
      userId,
      baseUpdatedAt: baseRoadmap.updated_at ?? new Date().toISOString(),
      baseRevision: dto.base_revision,
      createdAt: new Date().toISOString(),
      candidate,
      semanticDiff,
      validationIssues,
    };
    this.previews.set(previewId, record);
    this.clearExpiredPreviews();

    return {
      preview_id: previewId,
      base_revision: dto.base_revision,
      base_updated_at: record.baseUpdatedAt,
      semantic_diff: semanticDiff,
      validation_issues: validationIssues,
      candidate_snapshot: candidate as unknown as Record<string, unknown>,
    };
  }

  async commit(
    roadmapId: string,
    dto: RoadmapAiCommitDto,
    userId: string,
  ): Promise<RoadmapAiCommitResponseDto> {
    const preview = this.previews.get(dto.preview_id);
    if (!preview || preview.roadmapId !== roadmapId || preview.userId !== userId) {
      throw new NotFoundException('Preview not found');
    }

    const staleByRevision =
      dto.base_revision !== undefined &&
      preview.baseRevision !== undefined &&
      dto.base_revision !== preview.baseRevision;
    if (staleByRevision) {
      throw new ConflictException('Preview base revision does not match request');
    }

    const errorIssues = preview.validationIssues.filter(
      (issue) => issue.severity === 'error',
    );
    if (errorIssues.length > 0) {
      throw new BadRequestException({
        message: 'Preview has validation errors and cannot be committed',
        validation_issues: errorIssues,
      });
    }

    const current = await this.assertCanEditRoadmap(roadmapId, userId);
    if ((current.updated_at ?? '') !== preview.baseUpdatedAt) {
      throw new ConflictException({
        message: 'Roadmap changed since preview was generated',
        code: 'STALE_REVISION',
      });
    }

    if (!current.owner_id) {
      throw new InternalServerErrorException(
        'Roadmap owner is missing for an existing roadmap',
      );
    }

    await this.patchRepo.upsertFullRoadmap({
      roadmapId,
      ownerId: current.owner_id,
      fullState: preview.candidate,
      createIfMissing: false,
    });

    const persisted = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!persisted) {
      throw new InternalServerErrorException(
        'Roadmap not found after successful commit',
      );
    }

    const persistedMeta = await this.roadmapsRepo.findById(roadmapId, userId);
    this.previews.delete(dto.preview_id);

    return {
      committed_at: new Date().toISOString(),
      revision_token: persistedMeta?.updated_at ?? new Date().toISOString(),
      semantic_diff: preview.semanticDiff,
      roadmap: persisted as Record<string, unknown>,
    };
  }

  async rollback(
    _roadmapId: string,
    dto: RoadmapAiRollbackDto,
    _userId: string,
  ): Promise<RoadmapAiRollbackResponseDto> {
    throw new NotImplementedException(
      `Rollback is planned but not implemented yet for target revision ${dto.target_revision}`,
    );
  }

  private async assertCanEditRoadmap(roadmapId: string, userId: string) {
    const existing = await this.roadmapsRepo.findById(roadmapId);
    if (!existing) throw new NotFoundException('Roadmap not found');

    if (existing.project_id) {
      await this.roadmapAuthz.assertRoadmapPermission(
        roadmapId,
        userId,
        'roadmap.edit',
      );
      return existing;
    }

    if (existing.owner_id !== userId) {
      throw new ForbiddenException('Not the owner');
    }
    return existing;
  }

  private validateOptimisticRevision(
    baseRevision: number | undefined,
    updatedAt: string | undefined,
  ): RoadmapValidationIssueDto[] {
    if (baseRevision === undefined || !updatedAt) return [];
    return [];
  }

  private applyOperations(
    state: FullRoadmapState,
    operations: RoadmapAiOperationDto[],
  ): RoadmapValidationIssueDto[] {
    const issues: RoadmapValidationIssueDto[] = [];

    operations.forEach((operation, index) => {
      const opPath = `/operations/${index}`;
      switch (operation.op) {
        case 'add_epic':
          this.applyAddEpic(state, operation, opPath, issues);
          break;
        case 'add_feature':
          this.applyAddFeature(state, operation, opPath, issues);
          break;
        case 'add_task':
          this.applyAddTask(state, operation, opPath, issues);
          break;
        case 'update_node':
          this.applyUpdateNode(state, operation, opPath, issues);
          break;
        case 'move_node':
          this.applyMoveNode(state, operation, opPath, issues);
          break;
        case 'delete_node':
          this.applyDeleteNode(state, operation, opPath, issues);
          break;
        case 'mark_status':
          this.applyMarkStatus(state, operation, opPath, issues);
          break;
        case 'shift_dates':
          this.applyShiftDates(state, operation, opPath, issues);
          break;
      }
    });

    this.reindexPositions(state);
    return issues;
  }

  private applyAddEpic(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    const title = this.readString(operation.data, 'title');
    if (!title) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/data/title`,
          'title is required for add_epic',
        ),
      );
      return;
    }

    const epic: FullRoadmapEpicDto = {
      id: this.readUuid(operation.data, 'id') ?? randomUUID(),
      title,
      description: this.readString(operation.data, 'description'),
      status: this.readString(operation.data, 'status') ?? 'backlog',
      priority: this.readString(operation.data, 'priority') ?? 'medium',
      color: this.readString(operation.data, 'color'),
      start_date: this.readString(operation.data, 'start_date'),
      end_date: this.readString(operation.data, 'end_date'),
      tags: this.readStringArray(operation.data, 'tags') ?? [],
      roadmap_features: [],
      position: 0,
    };

    if (!EPIC_STATUS.includes(epic.status ?? '')) {
      issues.push(
        this.issue(
          'INVALID_ENUM',
          'error',
          `${path}/data/status`,
          'Invalid epic status enum',
        ),
      );
      return;
    }

    const targetPosition = this.resolveInsertPosition(
      operation.position,
      state.roadmap_epics?.length ?? 0,
    );
    (state.roadmap_epics ??= []).splice(targetPosition, 0, epic);
  }

  private applyAddFeature(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    const parentId = operation.parent_id;
    if (!parentId) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/parent_id`,
          'parent_id is required for add_feature',
        ),
      );
      return;
    }

    const parent = this.findNodeById(state, parentId);
    if (!parent || parent.type !== 'epic') {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/parent_id`,
          'add_feature requires an existing epic parent',
        ),
      );
      return;
    }

    const title = this.readString(operation.data, 'title');
    if (!title) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/data/title`,
          'title is required for add_feature',
        ),
      );
      return;
    }

    const feature: FullRoadmapFeatureDto = {
      id: this.readUuid(operation.data, 'id') ?? randomUUID(),
      title,
      description: this.readString(operation.data, 'description'),
      status: this.readString(operation.data, 'status') ?? 'not_started',
      is_deliverable: this.readBoolean(operation.data, 'is_deliverable') ?? true,
      start_date: this.readString(operation.data, 'start_date'),
      end_date: this.readString(operation.data, 'end_date'),
      roadmap_tasks: [],
      position: 0,
    };

    if (!FEATURE_STATUS.includes(feature.status ?? '')) {
      issues.push(
        this.issue(
          'INVALID_ENUM',
          'error',
          `${path}/data/status`,
          'Invalid feature status enum',
        ),
      );
      return;
    }

    const targetPosition = this.resolveInsertPosition(
      operation.position,
      parent.epic.roadmap_features?.length ?? 0,
    );
    (parent.epic.roadmap_features ??= []).splice(targetPosition, 0, feature);
  }

  private applyAddTask(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    const parentId = operation.parent_id;
    if (!parentId) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/parent_id`,
          'parent_id is required for add_task',
        ),
      );
      return;
    }

    const parent = this.findNodeById(state, parentId);
    if (!parent || parent.type !== 'feature') {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/parent_id`,
          'add_task requires an existing feature parent',
        ),
      );
      return;
    }

    const title = this.readString(operation.data, 'title');
    if (!title) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/data/title`,
          'title is required for add_task',
        ),
      );
      return;
    }

    const task: FullRoadmapTaskDto = {
      id: this.readUuid(operation.data, 'id') ?? randomUUID(),
      title,
      description: this.readString(operation.data, 'description'),
      status: this.readString(operation.data, 'status') ?? 'todo',
      priority: this.readString(operation.data, 'priority') ?? 'medium',
      assignee_id: this.readUuid(operation.data, 'assignee_id'),
      due_date: this.readString(operation.data, 'due_date'),
      position: 0,
    };

    if (!TASK_STATUS.includes(task.status ?? '')) {
      issues.push(
        this.issue(
          'INVALID_ENUM',
          'error',
          `${path}/data/status`,
          'Invalid task status enum',
        ),
      );
      return;
    }

    const targetPosition = this.resolveInsertPosition(
      operation.position,
      parent.feature.roadmap_tasks?.length ?? 0,
    );
    (parent.feature.roadmap_tasks ??= []).splice(targetPosition, 0, task);
  }

  private applyUpdateNode(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    if (!operation.node_id) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/node_id`,
          'node_id is required for update_node',
        ),
      );
      return;
    }
    if (!operation.patch || typeof operation.patch !== 'object') {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/patch`,
          'patch object is required for update_node',
        ),
      );
      return;
    }

    const locator = this.findNodeById(state, operation.node_id);
    if (!locator) {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/node_id`,
          'Target node was not found',
        ),
      );
      return;
    }

    const allowed = this.allowedPatchFields(locator.type);
    const patchKeys = Object.keys(operation.patch);
    for (const key of patchKeys) {
      if (!allowed.includes(key)) {
        issues.push(
          this.issue(
            'OUT_OF_SCOPE_MUTATION',
            'error',
            `${path}/patch/${key}`,
            `Field "${key}" is not allowed for update_node`,
            { type: locator.type, id: operation.node_id },
          ),
        );
        return;
      }
    }

    const target = this.getMutableNode(locator);
    for (const key of patchKeys) {
      (target as Record<string, unknown>)[key] = operation.patch[key];
    }
  }

  private applyMoveNode(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    if (!operation.node_id) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/node_id`,
          'node_id is required for move_node',
        ),
      );
      return;
    }

    const locator = this.findNodeById(state, operation.node_id);
    if (!locator || locator.type === 'roadmap') {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/node_id`,
          'Target node was not found',
        ),
      );
      return;
    }

    if (locator.type === 'epic') {
      const currentIndex = locator.epicIndex;
      const [item] = (state.roadmap_epics ?? []).splice(currentIndex, 1);
      const targetIndex = this.resolveInsertPosition(
        operation.position,
        state.roadmap_epics?.length ?? 0,
      );
      (state.roadmap_epics ?? []).splice(targetIndex, 0, item);
      return;
    }

    if (locator.type === 'feature') {
      const targetEpicId = operation.new_parent_id ?? locator.epic.id;
      if (!targetEpicId) {
        issues.push(
          this.issue(
            'BROKEN_RELATIONSHIP',
            'error',
            `${path}/new_parent_id`,
            'Feature move destination is missing',
          ),
        );
        return;
      }
      const newParent = this.findNodeById(state, targetEpicId);
      if (!newParent || newParent.type !== 'epic') {
        issues.push(
          this.issue(
            'BROKEN_RELATIONSHIP',
            'error',
            `${path}/new_parent_id`,
            'Feature move requires an existing epic destination',
          ),
        );
        return;
      }
      const [item] = (locator.epic.roadmap_features ?? []).splice(
        locator.featureIndex,
        1,
      );
      const targetIndex = this.resolveInsertPosition(
        operation.position,
        newParent.epic.roadmap_features?.length ?? 0,
      );
      (newParent.epic.roadmap_features ?? []).splice(targetIndex, 0, item);
      return;
    }

    const targetFeatureId = operation.new_parent_id ?? locator.feature.id;
    if (!targetFeatureId) {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/new_parent_id`,
          'Task move destination is missing',
        ),
      );
      return;
    }
    const newParent = this.findNodeById(state, targetFeatureId);
    if (!newParent || newParent.type !== 'feature') {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/new_parent_id`,
          'Task move requires an existing feature destination',
        ),
      );
      return;
    }

    const [item] = (locator.feature.roadmap_tasks ?? []).splice(
      locator.taskIndex,
      1,
    );
    const targetIndex = this.resolveInsertPosition(
      operation.position,
      newParent.feature.roadmap_tasks?.length ?? 0,
    );
    (newParent.feature.roadmap_tasks ?? []).splice(targetIndex, 0, item);
  }

  private applyDeleteNode(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    if (!operation.node_id) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/node_id`,
          'node_id is required for delete_node',
        ),
      );
      return;
    }

    const locator = this.findNodeById(state, operation.node_id);
    if (!locator || locator.type === 'roadmap') {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/node_id`,
          'Target node was not found',
        ),
      );
      return;
    }

    if (locator.type === 'epic') {
      (state.roadmap_epics ?? []).splice(locator.epicIndex, 1);
      return;
    }

    if (locator.type === 'feature') {
      (locator.epic.roadmap_features ?? []).splice(locator.featureIndex, 1);
      return;
    }

    (locator.feature.roadmap_tasks ?? []).splice(locator.taskIndex, 1);
  }

  private applyMarkStatus(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    if (!operation.node_id) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/node_id`,
          'node_id is required for mark_status',
        ),
      );
      return;
    }
    if (!operation.status) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/status`,
          'status is required for mark_status',
        ),
      );
      return;
    }

    const locator = this.findNodeById(state, operation.node_id);
    if (!locator) {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/node_id`,
          'Target node was not found',
        ),
      );
      return;
    }

    const isValid = this.validateNodeStatus(locator.type, operation.status);
    if (!isValid) {
      issues.push(
        this.issue(
          'INVALID_ENUM',
          'error',
          `${path}/status`,
          'Invalid status for selected node type',
        ),
      );
      return;
    }

    const target = this.getMutableNode(locator);
    (target as Record<string, unknown>).status = operation.status;
  }

  private applyShiftDates(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    if (operation.delta_days === undefined) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/delta_days`,
          'delta_days is required for shift_dates',
        ),
      );
      return;
    }
    if (!operation.node_id) {
      issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          `${path}/node_id`,
          'node_id is required for shift_dates',
        ),
      );
      return;
    }

    const locator = this.findNodeById(state, operation.node_id);
    if (!locator) {
      issues.push(
        this.issue(
          'BROKEN_RELATIONSHIP',
          'error',
          `${path}/node_id`,
          'Target node was not found',
        ),
      );
      return;
    }

    this.shiftNodeDates(locator, operation.delta_days);
  }

  private shiftNodeDates(node: NodeLocator, deltaDays: number) {
    if (node.type === 'roadmap') {
      node.roadmap.start_date = this.shiftDate(node.roadmap.start_date, deltaDays);
      node.roadmap.end_date = this.shiftDate(node.roadmap.end_date, deltaDays);
      for (const epic of node.roadmap.roadmap_epics ?? []) {
        this.shiftNodeDates(
          {
            type: 'epic',
            epic,
            epicIndex: 0,
            roadmap: node.roadmap,
          },
          deltaDays,
        );
      }
      return;
    }
    if (node.type === 'epic') {
      node.epic.start_date = this.shiftDate(node.epic.start_date, deltaDays);
      node.epic.end_date = this.shiftDate(node.epic.end_date, deltaDays);
      for (const feature of node.epic.roadmap_features ?? []) {
        this.shiftNodeDates(
          {
            type: 'feature',
            feature,
            featureIndex: 0,
            epic: node.epic,
            epicIndex: node.epicIndex,
            roadmap: node.roadmap,
          },
          deltaDays,
        );
      }
      return;
    }
    if (node.type === 'feature') {
      node.feature.start_date = this.shiftDate(node.feature.start_date, deltaDays);
      node.feature.end_date = this.shiftDate(node.feature.end_date, deltaDays);
      for (const task of node.feature.roadmap_tasks ?? []) {
        this.shiftNodeDates(
          {
            type: 'task',
            task,
            taskIndex: 0,
            feature: node.feature,
            featureIndex: node.featureIndex,
            epic: node.epic,
            epicIndex: node.epicIndex,
            roadmap: node.roadmap,
          },
          deltaDays,
        );
      }
      return;
    }
    node.task.due_date = this.shiftDate(node.task.due_date, deltaDays);
  }

  private shiftDate(
    dateInput: string | undefined,
    deltaDays: number,
  ): string | undefined {
    if (!dateInput) return dateInput;
    const parsed = new Date(dateInput);
    if (Number.isNaN(parsed.getTime())) return dateInput;
    parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
    return parsed.toISOString().slice(0, 10);
  }

  private validateState(state: FullRoadmapState): RoadmapValidationIssueDto[] {
    const issues: RoadmapValidationIssueDto[] = [];
    const idToType = new Map<string, RoadmapNodeType>();

    const pushDuplicate = (id: string, type: RoadmapNodeType, path: string) => {
      const existingType = idToType.get(id);
      if (existingType) {
        issues.push(
          this.issue(
            'DUPLICATE_ID',
            'error',
            path,
            `Duplicate id "${id}" detected`,
            { type, id },
          ),
        );
        return;
      }
      idToType.set(id, type);
    };

    if (state.id) pushDuplicate(state.id, 'roadmap', '/id');
    this.validateDateRange(state.start_date, state.end_date, '/roadmap', issues);
    if (state.status && !ROADMAP_STATUS.includes(state.status)) {
      issues.push(
        this.issue('INVALID_ENUM', 'error', '/status', 'Invalid roadmap status enum'),
      );
    }

    (state.roadmap_epics ?? []).forEach((epic, epicIndex) => {
      const epicPath = `/roadmap_epics/${epicIndex}`;
      if (!epic.id) {
        issues.push(
          this.issue(
            'MISSING_REQUIRED_FIELD',
            'error',
            `${epicPath}/id`,
            'Epic id is required',
          ),
        );
      } else {
        pushDuplicate(epic.id, 'epic', `${epicPath}/id`);
      }
      this.validateDateRange(epic.start_date, epic.end_date, epicPath, issues);
      if (epic.status && !EPIC_STATUS.includes(epic.status)) {
        issues.push(
          this.issue(
            'INVALID_ENUM',
            'error',
            `${epicPath}/status`,
            'Invalid epic status enum',
          ),
        );
      }

      (epic.roadmap_features ?? []).forEach((feature, featureIndex) => {
        const featurePath = `${epicPath}/roadmap_features/${featureIndex}`;
        if (!feature.id) {
          issues.push(
            this.issue(
              'MISSING_REQUIRED_FIELD',
              'error',
              `${featurePath}/id`,
              'Feature id is required',
            ),
          );
        } else {
          pushDuplicate(feature.id, 'feature', `${featurePath}/id`);
        }
        this.validateDateRange(
          feature.start_date,
          feature.end_date,
          featurePath,
          issues,
        );
        if (feature.status && !FEATURE_STATUS.includes(feature.status)) {
          issues.push(
            this.issue(
              'INVALID_ENUM',
              'error',
              `${featurePath}/status`,
              'Invalid feature status enum',
            ),
          );
        }

        (feature.roadmap_tasks ?? []).forEach((task, taskIndex) => {
          const taskPath = `${featurePath}/roadmap_tasks/${taskIndex}`;
          if (!task.id) {
            issues.push(
              this.issue(
                'MISSING_REQUIRED_FIELD',
                'error',
                `${taskPath}/id`,
                'Task id is required',
              ),
            );
          } else {
            pushDuplicate(task.id, 'task', `${taskPath}/id`);
          }
          if (task.status && !TASK_STATUS.includes(task.status)) {
            issues.push(
              this.issue(
                'INVALID_ENUM',
                'error',
                `${taskPath}/status`,
                'Invalid task status enum',
              ),
            );
          }
        });
      });
    });

    this.validateProgressConsistency(state, issues);
    return issues;
  }

  private validateDateRange(
    startDate: string | undefined,
    endDate: string | undefined,
    basePath: string,
    issues: RoadmapValidationIssueDto[],
  ) {
    if (!startDate || !endDate) return;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      issues.push(
        this.issue(
          'INVALID_TYPE',
          'error',
          basePath,
          'Date format must be a valid ISO date string',
        ),
      );
      return;
    }
    if (start > end) {
      issues.push(
        this.issue(
          'INVALID_DATE_RANGE',
          'error',
          basePath,
          'start_date must be before or equal to end_date',
        ),
      );
    }
  }

  private validateProgressConsistency(
    state: FullRoadmapState,
    issues: RoadmapValidationIssueDto[],
  ) {
    for (const epic of state.roadmap_epics ?? []) {
      if (epic.status !== 'completed') continue;
      const hasIncompleteFeature = (epic.roadmap_features ?? []).some(
        (feature) => feature.status !== 'completed',
      );
      if (hasIncompleteFeature) {
        issues.push(
          this.issue(
            'PROGRESS_MISMATCH',
            'warning',
            `/roadmap_epics/${epic.id}/status`,
            'Epic is completed while one or more features are not completed',
            { type: 'epic', id: epic.id ?? '' },
          ),
        );
      }
    }

    for (const epic of state.roadmap_epics ?? []) {
      for (const feature of epic.roadmap_features ?? []) {
        if (feature.status !== 'completed') continue;
        const hasIncompleteTask = (feature.roadmap_tasks ?? []).some(
          (task) => task.status !== 'done',
        );
        if (hasIncompleteTask) {
          issues.push(
            this.issue(
              'PROGRESS_MISMATCH',
              'warning',
              `/roadmap_features/${feature.id}/status`,
              'Feature is completed while one or more tasks are not done',
              { type: 'feature', id: feature.id ?? '' },
            ),
          );
        }
      }
    }
  }

  private computeSemanticDiff(
    base: FullRoadmapState,
    candidate: FullRoadmapState,
  ): SemanticDiffDto {
    const before = this.flattenState(base);
    const after = this.flattenState(candidate);
    const changes: SemanticDiffChangeDto[] = [];

    for (const [id, nextNode] of after.entries()) {
      const prevNode = before.get(id);
      if (!prevNode) {
        changes.push({
          type: 'NODE_ADDED',
          node: { type: nextNode.type, id },
          to: nextNode as unknown as Record<string, unknown>,
        });
        continue;
      }

      if (
        prevNode.parentId !== nextNode.parentId ||
        prevNode.position !== nextNode.position
      ) {
        changes.push({
          type: 'NODE_MOVED',
          node: { type: nextNode.type, id },
          from: { parent_id: prevNode.parentId, position: prevNode.position },
          to: { parent_id: nextNode.parentId, position: nextNode.position },
        });
      }

      if (prevNode.status !== nextNode.status) {
        changes.push({
          type: 'STATUS_CHANGED',
          node: { type: nextNode.type, id },
          from: { status: prevNode.status },
          to: { status: nextNode.status },
        });
      }

      if (
        prevNode.startDate !== nextNode.startDate ||
        prevNode.endDate !== nextNode.endDate ||
        prevNode.dueDate !== nextNode.dueDate
      ) {
        changes.push({
          type: 'DATE_CHANGED',
          node: { type: nextNode.type, id },
          from: {
            start_date: prevNode.startDate,
            end_date: prevNode.endDate,
            due_date: prevNode.dueDate,
          },
          to: {
            start_date: nextNode.startDate,
            end_date: nextNode.endDate,
            due_date: nextNode.dueDate,
          },
        });
      }

      if (
        JSON.stringify(prevNode.dependencies ?? []) !==
        JSON.stringify(nextNode.dependencies ?? [])
      ) {
        changes.push({
          type: 'DEPENDENCY_CHANGED',
          node: { type: nextNode.type, id },
          from: { dependencies: prevNode.dependencies ?? [] },
          to: { dependencies: nextNode.dependencies ?? [] },
        });
      }
    }

    for (const [id, prevNode] of before.entries()) {
      if (after.has(id)) continue;
      changes.push({
        type: 'NODE_REMOVED',
        node: { type: prevNode.type, id },
        from: prevNode as unknown as Record<string, unknown>,
      });
    }

    const summary = changes.reduce<Record<string, number>>((acc, change) => {
      acc[change.type] = (acc[change.type] ?? 0) + 1;
      return acc;
    }, {});

    return { summary, changes };
  }

  private flattenState(state: FullRoadmapState): Map<string, FlatNodeSnapshot> {
    const map = new Map<string, FlatNodeSnapshot>();
    const roadmapId = state.id ?? '__roadmap__';
    map.set(roadmapId, {
      id: roadmapId,
      type: 'roadmap',
      status: state.status,
      startDate: state.start_date,
      endDate: state.end_date,
      dependencies: this.readDependencies(state as unknown as Record<string, unknown>),
    });

    for (const epic of state.roadmap_epics ?? []) {
      const epicId = epic.id;
      if (!epicId) continue;
      map.set(epicId, {
        id: epicId,
        type: 'epic',
        parentId: roadmapId,
        position: epic.position,
        status: epic.status,
        startDate: epic.start_date,
        endDate: epic.end_date,
        dependencies: this.readDependencies(epic as unknown as Record<string, unknown>),
      });

      for (const feature of epic.roadmap_features ?? []) {
        const featureId = feature.id;
        if (!featureId) continue;
        map.set(featureId, {
          id: featureId,
          type: 'feature',
          parentId: epicId,
          position: feature.position,
          status: feature.status,
          startDate: feature.start_date,
          endDate: feature.end_date,
          dependencies: this.readDependencies(
            feature as unknown as Record<string, unknown>,
          ),
        });

        for (const task of feature.roadmap_tasks ?? []) {
          const taskId = task.id;
          if (!taskId) continue;
          map.set(taskId, {
            id: taskId,
            type: 'task',
            parentId: featureId,
            position: task.position,
            status: task.status,
            dueDate: task.due_date,
            dependencies: this.readDependencies(task as unknown as Record<string, unknown>),
          });
        }
      }
    }

    return map;
  }

  private readDependencies(node: Record<string, unknown>): string[] | undefined {
    const raw = node.dependencies;
    if (!Array.isArray(raw)) return undefined;
    return raw.filter((value): value is string => typeof value === 'string');
  }

  private reindexPositions(state: FullRoadmapState) {
    (state.roadmap_epics ?? []).forEach((epic, epicIndex) => {
      epic.position = epicIndex;
      (epic.roadmap_features ?? []).forEach((feature, featureIndex) => {
        feature.position = featureIndex;
        (feature.roadmap_tasks ?? []).forEach((task, taskIndex) => {
          task.position = taskIndex;
        });
      });
    });
  }

  private resolveInsertPosition(position: number | undefined, size: number): number {
    if (position === undefined) return size;
    if (position < 0) return 0;
    if (position > size) return size;
    return position;
  }

  private allowedPatchFields(nodeType: RoadmapNodeType): string[] {
    switch (nodeType) {
      case 'roadmap':
        return ['name', 'description', 'status', 'start_date', 'end_date', 'settings'];
      case 'epic':
        return [
          'title',
          'description',
          'status',
          'priority',
          'color',
          'start_date',
          'end_date',
          'tags',
        ];
      case 'feature':
        return [
          'title',
          'description',
          'status',
          'is_deliverable',
          'start_date',
          'end_date',
        ];
      case 'task':
        return [
          'title',
          'description',
          'status',
          'priority',
          'assignee_id',
          'due_date',
        ];
    }
  }

  private validateNodeStatus(nodeType: RoadmapNodeType, status: string): boolean {
    switch (nodeType) {
      case 'roadmap':
        return ROADMAP_STATUS.includes(status);
      case 'epic':
        return EPIC_STATUS.includes(status);
      case 'feature':
        return FEATURE_STATUS.includes(status);
      case 'task':
        return TASK_STATUS.includes(status);
    }
  }

  private findNodeById(state: FullRoadmapState, nodeId: string): NodeLocator | null {
    if (state.id === nodeId) {
      return { type: 'roadmap', roadmap: state };
    }

    for (let epicIndex = 0; epicIndex < (state.roadmap_epics ?? []).length; epicIndex++) {
      const epic = state.roadmap_epics?.[epicIndex];
      if (!epic) continue;
      if (epic.id === nodeId) {
        return { type: 'epic', epic, epicIndex, roadmap: state };
      }

      for (
        let featureIndex = 0;
        featureIndex < (epic.roadmap_features ?? []).length;
        featureIndex++
      ) {
        const feature = epic.roadmap_features?.[featureIndex];
        if (!feature) continue;
        if (feature.id === nodeId) {
          return {
            type: 'feature',
            feature,
            featureIndex,
            epic,
            epicIndex,
            roadmap: state,
          };
        }

        for (
          let taskIndex = 0;
          taskIndex < (feature.roadmap_tasks ?? []).length;
          taskIndex++
        ) {
          const task = feature.roadmap_tasks?.[taskIndex];
          if (!task) continue;
          if (task.id === nodeId) {
            return {
              type: 'task',
              task,
              taskIndex,
              feature,
              featureIndex,
              epic,
              epicIndex,
              roadmap: state,
            };
          }
        }
      }
    }

    return null;
  }

  private getMutableNode(locator: NodeLocator): Record<string, unknown> {
    switch (locator.type) {
      case 'roadmap':
        return locator.roadmap as unknown as Record<string, unknown>;
      case 'epic':
        return locator.epic as unknown as Record<string, unknown>;
      case 'feature':
        return locator.feature as unknown as Record<string, unknown>;
      case 'task':
        return locator.task as unknown as Record<string, unknown>;
    }
  }

  private issue(
    code: RoadmapValidationIssueCode,
    severity: Severity,
    path: string,
    message: string,
    nodeRef?: NodeRef,
  ): RoadmapValidationIssueDto {
    return {
      code,
      severity,
      path,
      message,
      node_ref: nodeRef,
    };
  }

  private readString(
    input: Record<string, unknown> | undefined,
    key: string,
  ): string | undefined {
    const value = input?.[key];
    return typeof value === 'string' ? value : undefined;
  }

  private readUuid(
    input: Record<string, unknown> | undefined,
    key: string,
  ): string | undefined {
    const value = this.readString(input, key);
    if (!value) return undefined;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value) ? value : undefined;
  }

  private readBoolean(
    input: Record<string, unknown> | undefined,
    key: string,
  ): boolean | undefined {
    const value = input?.[key];
    return typeof value === 'boolean' ? value : undefined;
  }

  private readStringArray(
    input: Record<string, unknown> | undefined,
    key: string,
  ): string[] | undefined {
    const value = input?.[key];
    if (!Array.isArray(value)) return undefined;
    return value.filter((item): item is string => typeof item === 'string');
  }

  private normalizeFullRoadmapState(state: Record<string, unknown>): FullRoadmapState {
    const sourceEpics =
      this.readArray(state, 'roadmap_epics') ?? this.readArray(state, 'epics') ?? [];
    const roadmapEpics = sourceEpics.map((epicRaw, epicIndex) =>
      this.normalizeEpic(epicRaw, epicIndex),
    );

    return {
      id: this.readString(state, 'id') ?? randomUUID(),
      name: this.readString(state, 'name') ?? 'Untitled roadmap',
      description: this.readString(state, 'description'),
      project_id: this.readString(state, 'project_id'),
      status: this.readString(state, 'status') ?? 'draft',
      start_date: this.readString(state, 'start_date'),
      end_date: this.readString(state, 'end_date'),
      settings:
        this.readObject(state, 'settings') ??
        this.readObject(state, 'template_settings') ??
        {},
      roadmap_epics: roadmapEpics,
    };
  }

  private normalizeEpic(raw: Record<string, unknown>, epicIndex: number): FullRoadmapEpicDto {
    const sourceFeatures =
      this.readArray(raw, 'roadmap_features') ?? this.readArray(raw, 'features') ?? [];

    return {
      id: this.readString(raw, 'id') ?? randomUUID(),
      title: this.readString(raw, 'title') ?? 'Untitled epic',
      description: this.readString(raw, 'description'),
      status: this.readString(raw, 'status') ?? 'backlog',
      priority: this.readString(raw, 'priority') ?? 'medium',
      position: this.readNumber(raw, 'position') ?? epicIndex,
      color: this.readString(raw, 'color'),
      start_date: this.readString(raw, 'start_date'),
      end_date: this.readString(raw, 'end_date'),
      tags: this.readStringArray(raw, 'tags') ?? [],
      roadmap_features: sourceFeatures.map((featureRaw, featureIndex) =>
        this.normalizeFeature(featureRaw, featureIndex),
      ),
    };
  }

  private normalizeFeature(
    raw: Record<string, unknown>,
    featureIndex: number,
  ): FullRoadmapFeatureDto {
    const sourceTasks =
      this.readArray(raw, 'roadmap_tasks') ?? this.readArray(raw, 'tasks') ?? [];

    return {
      id: this.readString(raw, 'id') ?? randomUUID(),
      title: this.readString(raw, 'title') ?? 'Untitled feature',
      description: this.readString(raw, 'description'),
      status: this.readString(raw, 'status') ?? 'not_started',
      position: this.readNumber(raw, 'position') ?? featureIndex,
      is_deliverable: this.readBoolean(raw, 'is_deliverable') ?? true,
      start_date: this.readString(raw, 'start_date'),
      end_date: this.readString(raw, 'end_date'),
      roadmap_tasks: sourceTasks.map((taskRaw, taskIndex) =>
        this.normalizeTask(taskRaw, taskIndex),
      ),
    };
  }

  private normalizeTask(raw: Record<string, unknown>, taskIndex: number): FullRoadmapTaskDto {
    return {
      id: this.readString(raw, 'id') ?? randomUUID(),
      title: this.readString(raw, 'title') ?? 'Untitled task',
      description: this.readString(raw, 'description'),
      status: this.readString(raw, 'status') ?? 'todo',
      priority: this.readString(raw, 'priority') ?? 'medium',
      assignee_id: this.readString(raw, 'assignee_id'),
      due_date: this.readString(raw, 'due_date'),
      position: this.readNumber(raw, 'position') ?? taskIndex,
    };
  }

  private readArray(
    source: Record<string, unknown>,
    key: string,
  ): Record<string, unknown>[] | undefined {
    const value = source[key];
    if (!Array.isArray(value)) return undefined;
    return value.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && !Array.isArray(item),
    );
  }

  private readObject(
    source: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> | undefined {
    const value = source[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private readNumber(
    source: Record<string, unknown>,
    key: string,
  ): number | undefined {
    const value = source[key];
    return typeof value === 'number' ? value : undefined;
  }

  private clearExpiredPreviews() {
    const now = Date.now();
    for (const [previewId, preview] of this.previews.entries()) {
      const age = now - new Date(preview.createdAt).getTime();
      if (age > PREVIEW_TTL_MS) {
        this.previews.delete(previewId);
      }
    }
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
