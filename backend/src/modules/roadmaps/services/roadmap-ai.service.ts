import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type {
  FullRoadmapEpicDto,
  FullRoadmapFeatureDto,
  FullRoadmapState,
  FullRoadmapTaskDto,
} from '../dto/patch-roadmap.dto';
import type {
  IRoadmapsRepository,
  RoadmapContextSearchCandidateRecord,
} from '../repositories/roadmaps.repository.interface';
import type { IRoadmapPatchRepository } from '../repositories/roadmap-patch.repository.interface';
import { ROADMAP_PATCH_REPOSITORY } from './roadmap-patch.service';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import type {
  RoadmapAiCommitDto,
  RoadmapAiCommitResponseDto,
  RoadmapAiContextChildrenQueryDto,
  RoadmapAiContextChildrenResponseDto,
  RoadmapAiContextActorResponseDto,
  RoadmapAiContextTasksAssignedQueryDto,
  RoadmapAiContextTasksAssignedResponseDto,
  RoadmapAiContextFeaturesQueryDto,
  RoadmapAiContextNodeResponseDto,
  RoadmapAiContextResolutionChildrenQueryDto,
  RoadmapAiContextSearchMatchDto,
  RoadmapAiContextSearchQueryDto,
  RoadmapAiContextSearchResponseDto,
  RoadmapAiContextSummaryResponseDto,
  RoadmapAiDiscardDto,
  RoadmapAiDiscardResponseDto,
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
import { RoadmapAiPreviewStoreService } from './roadmap-ai-preview-store.service';

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
  revisionToken: string;
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

type ContextSearchCandidate = {
  id: string;
  type: Exclude<RoadmapNodeType, 'roadmap'>;
  title: string;
  description?: string;
  parent_id: string;
  parent_title?: string;
};

type ResolutionRecord = {
  roadmapId: string;
  userId: string;
  createdAt: string;
  matches: RoadmapAiContextSearchMatchDto[];
};

type AuthzDecisionCacheValue = {
  expiresAtMs: number;
  roadmap: Record<string, unknown>;
};

const PREVIEW_TTL_MS = 1000 * 60 * 30;
const RESOLUTION_TTL_SECONDS = 60 * 10;
const RESOLVE_LOOKUP_CACHE_TTL_SECONDS = 60 * 3;
const RESOLVE_LOOKUP_CACHE_VERSION = 'v1';
const AUTHZ_DECISION_CACHE_VERSION =
  process.env.ROADMAP_AI_AUTHZ_CACHE_VERSION?.trim() || 'v1';
const AUTHZ_DECISION_CACHE_TTL_MS = Math.max(
  1_000,
  Number.parseInt(process.env.ROADMAP_AI_AUTHZ_CACHE_TTL_MS ?? '10000', 10) ||
    10_000,
);
const AUTHZ_DECISION_CACHE_MAX_ENTRIES = Math.max(
  100,
  Number.parseInt(
    process.env.ROADMAP_AI_AUTHZ_CACHE_MAX_ENTRIES ?? '5000',
    10,
  ) || 5_000,
);
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
  private readonly logger = new Logger(RoadmapAiService.name);
  private readonly authzDecisionCache = new Map<
    string,
    AuthzDecisionCacheValue
  >();

  constructor(
    @Inject(SUPABASE_ADMIN)
    private readonly db: SupabaseClient,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    @Inject(ROADMAP_PATCH_REPOSITORY)
    private readonly patchRepo: IRoadmapPatchRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly previewStore: RoadmapAiPreviewStoreService,
  ) {}

  async preview(
    roadmapId: string,
    dto: RoadmapAiPreviewDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiPreviewResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    const baseRoadmap = await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const currentRevisionToken = this.requireRevisionToken(
      baseRoadmap.updated_at,
    );
    const repoLookupStartedAt = Date.now();
    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    const repoLookupMs = Date.now() - repoLookupStartedAt;
    if (!full) throw new NotFoundException('Roadmap not found');

    const applyStartedAt = Date.now();
    const base = this.normalizeFullRoadmapState(
      full as unknown as Record<string, unknown>,
    );
    const candidate = this.clone(base);
    const operationIssues = this.applyOperations(candidate, dto.operations);
    if (dto.revision_token && dto.revision_token !== currentRevisionToken) {
      throw new ConflictException({
        message: 'Revision token does not match current roadmap revision',
        code: 'STALE_REVISION',
      });
    }
    const validationIssues = [
      ...operationIssues,
      ...this.validateState(candidate),
      ...this.validateOptimisticRevision(dto.base_revision),
    ];
    const semanticDiff = this.computeSemanticDiff(base, candidate);
    const semanticDiffApplyMs = Date.now() - applyStartedAt;

    const previewId = randomUUID();
    const record: PreviewRecord = {
      roadmapId,
      userId,
      baseUpdatedAt: currentRevisionToken,
      revisionToken: currentRevisionToken,
      baseRevision: dto.base_revision,
      createdAt: new Date().toISOString(),
      candidate,
      semanticDiff,
      validationIssues,
    };
    const previewStoreSetStartedAt = Date.now();
    await this.previewStore.setPreview(
      previewId,
      record as unknown as Record<string, unknown>,
      Math.ceil(PREVIEW_TTL_MS / 1000),
    );
    const previewStoreSetMs = Date.now() - previewStoreSetStartedAt;
    const totalHandlerMs = Date.now() - handlerStartedAt;
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_preview_timing',
      traceId,
      roadmapId,
      method: 'POST',
      path: '/roadmaps/:id/ai/preview',
      authzMs,
      repoLookupMs,
      semanticDiffApplyMs,
      previewStoreSetMs,
      totalHandlerMs,
      previewId,
    });

    return {
      preview_id: previewId,
      base_revision: dto.base_revision,
      base_updated_at: record.baseUpdatedAt,
      revision_token: record.revisionToken,
      semantic_diff: semanticDiff,
      validation_issues: validationIssues,
      candidate_snapshot: candidate as unknown as Record<string, unknown>,
    };
  }

  async getPreview(
    roadmapId: string,
    previewId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiPreviewResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;

    const previewStoreGetStartedAt = Date.now();
    const preview =
      await this.previewStore.getPreview<PreviewRecord>(previewId);
    const previewStoreGetMs = Date.now() - previewStoreGetStartedAt;
    if (
      !preview ||
      preview.roadmapId !== roadmapId ||
      preview.userId !== userId
    ) {
      throw new NotFoundException('Preview not found');
    }
    const totalHandlerMs = Date.now() - handlerStartedAt;
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_get_preview_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/previews/:previewId',
      authzMs,
      previewStoreGetMs,
      totalHandlerMs,
      previewId,
    });

    return {
      preview_id: previewId,
      base_revision: preview.baseRevision,
      base_updated_at: preview.baseUpdatedAt,
      revision_token: preview.revisionToken,
      semantic_diff: preview.semanticDiff,
      validation_issues: preview.validationIssues,
      candidate_snapshot: preview.candidate as unknown as Record<
        string,
        unknown
      >,
    };
  }

  async getContextSummary(
    roadmapId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextSummaryResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!full) throw new NotFoundException('Roadmap not found');
    const state = this.normalizeFullRoadmapState(
      full as Record<string, unknown>,
    );
    const roadmapNodeId = this.requireNodeId(state.id, 'roadmap');

    const epicCount = state.roadmap_epics?.length ?? 0;
    const featureCount = (state.roadmap_epics ?? []).reduce(
      (total, epic) => total + (epic.roadmap_features?.length ?? 0),
      0,
    );
    const taskCount = (state.roadmap_epics ?? []).reduce(
      (taskTotal, epic) =>
        taskTotal +
        (epic.roadmap_features ?? []).reduce(
          (featureTotal, feature) =>
            featureTotal + (feature.roadmap_tasks?.length ?? 0),
          0,
        ),
      0,
    );

    const response = {
      roadmap_id: roadmapNodeId,
      title: state.name,
      description: state.description,
      status: state.status,
      epic_count: epicCount,
      feature_count: featureCount,
      task_count: taskCount,
      epics: (state.roadmap_epics ?? []).flatMap((epic) =>
        epic.id
          ? [
              {
                id: epic.id,
                title: epic.title ?? 'Untitled epic',
                status: epic.status,
                feature_count: epic.roadmap_features?.length ?? 0,
              },
            ]
          : [],
      ),
    };
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_summary_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/summary',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
    });
    return response;
  }

  async getContextActor(
    roadmapId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextActorResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    const existing = await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const displayName = await this.readActorDisplayName(userId);

    const roadmapRole: 'owner' | 'editor' =
      existing.owner_id === userId ? 'owner' : 'editor';

    const response = {
      actor_id: userId,
      display_name: displayName,
      roadmap_role: roadmapRole,
      locale: null,
      timezone: null,
    };
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_actor_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/actor',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
    });
    return response;
  }

  async searchContextNodes(
    roadmapId: string,
    queryDto: RoadmapAiContextSearchQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextSearchResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const query = this.normalizeSearchText(queryDto.query ?? '');
    if (!query) {
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_search_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/search',
        authzMs,
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return { matches: [] };
    }
    const nodeType = this.parseSearchNodeType(queryDto.node_type);
    const limit = Math.min(Math.max(queryDto.limit ?? 10, 1), 50);
    const queryTokens = this.tokenizeSearchQuery(query);
    const typeHint = nodeType ?? this.extractTypeHint(queryTokens);
    const stageOrder: Array<'epic' | 'feature' | 'task'> = nodeType
      ? [nodeType]
      : ['epic', 'feature', 'task'];
    const aggregatedMatches = new Map<string, RoadmapAiContextSearchMatchDto>();
    let scoredMatches: RoadmapAiContextSearchMatchDto[] | null = null;
    let resolveStage: 'epic' | 'feature' | 'task' | null = null;
    let cacheLookupMs = 0;
    let dbLookupMs = 0;
    let cacheWriteMs = 0;
    let rankingMs = 0;

    for (const stageNodeType of stageOrder) {
      const stageLookupStartedAt = Date.now();
      const cacheKey = this.buildResolveLookupCacheKey(
        roadmapId,
        stageNodeType,
        query,
        limit,
      );

      const stageCacheStartedAt = Date.now();
      const cachedMatches = await this.readResolveLookupCache(cacheKey);
      const resolveStageCacheMs = Date.now() - stageCacheStartedAt;
      cacheLookupMs += resolveStageCacheMs;

      let candidates: ContextSearchCandidate[] = [];
      let resolveStageDbMs = 0;
      let resolveStageWriteMs = 0;
      const cacheHit = Array.isArray(cachedMatches);
      if (cacheHit && cachedMatches) {
        candidates = cachedMatches as ContextSearchCandidate[];
      } else {
        const dbStartedAt = Date.now();
        const dbCandidates = await this.roadmapsRepo.searchContextCandidates(
          roadmapId,
          query,
          {
            nodeType: stageNodeType,
            scanLimit: Math.max(limit * 8, 120),
          },
        );
        resolveStageDbMs = Date.now() - dbStartedAt;
        dbLookupMs += resolveStageDbMs;
        candidates = dbCandidates.map((candidate) =>
          this.toContextSearchCandidate(candidate),
        );

        const cacheWriteStartedAt = Date.now();
        this.scheduleResolveLookupCacheWrite(cacheKey, candidates);
        resolveStageWriteMs = Date.now() - cacheWriteStartedAt;
        cacheWriteMs += resolveStageWriteMs;
      }

      const rankingStartedAt = Date.now();
      const stageScored = this.rankContextSearchMatches(
        candidates,
        query,
        queryTokens,
        typeHint,
        limit,
      );
      const resolveStageRankingMs = Date.now() - rankingStartedAt;
      rankingMs += resolveStageRankingMs;

      this.logResolveLookupTelemetry({
        traceId,
        roadmapId,
        query,
        nodeType: stageNodeType,
        limit,
        cacheHit,
        cacheBypassReason: cacheHit ? undefined : 'miss',
        cacheLookupMs: resolveStageCacheMs,
        dbLookupMs: resolveStageDbMs,
        totalLookupMs: Date.now() - stageLookupStartedAt,
        candidateCount: candidates.length,
        resolveStage: stageNodeType,
        resolveStageCacheMs,
        resolveStageDbMs,
      });

      if (stageScored.length === 0) {
        continue;
      }

      resolveStage = stageNodeType;
      if (this.isStrongUniqueContextSearchMatch(stageScored)) {
        scoredMatches = [stageScored[0]];
        break;
      }

      for (const item of stageScored) {
        const existing = aggregatedMatches.get(item.id);
        if (!existing || item.score > existing.score) {
          aggregatedMatches.set(item.id, item);
        }
      }
    }

    if (scoredMatches === null) {
      scoredMatches = [...aggregatedMatches.values()]
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
        })
        .slice(0, limit);
    }

    let resolutionId: string | undefined;
    let previewStoreSetMs = 0;
    if (scoredMatches.length > 1) {
      resolutionId = randomUUID();
      const record: ResolutionRecord = {
        roadmapId,
        userId,
        createdAt: new Date().toISOString(),
        matches: scoredMatches,
      };
      const previewStoreSetStartedAt = Date.now();
      await this.previewStore.setResolution(
        resolutionId,
        record as unknown as Record<string, unknown>,
        RESOLUTION_TTL_SECONDS,
      );
      previewStoreSetMs = Date.now() - previewStoreSetStartedAt;
    }

    const totalHandlerMs = Date.now() - handlerStartedAt;
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_search_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/search',
      authzMs,
      cacheLookupMs,
      dbLookupMs,
      cacheWriteMs,
      rankingMs,
      previewStoreSetMs: Math.max(previewStoreSetMs, 0),
      totalHandlerMs,
      resolutionId,
      resolveStage: resolveStage ?? undefined,
    });
    return {
      resolution_id: resolutionId,
      matches: scoredMatches,
    };
  }

  async getContextChildrenFromResolution(
    roadmapId: string,
    resolutionId: string,
    query: RoadmapAiContextResolutionChildrenQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextChildrenResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    if (!this.isUuid(resolutionId)) {
      throw this.contextBadRequest(
        'INVALID_UUID',
        'resolutionId must be a valid UUID.',
      );
    }
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const choice = query.choice;
    if (choice < 1) {
      throw this.contextBadRequest('INVALID_ARGUMENT', 'choice must be >= 1');
    }

    const resolution =
      await this.previewStore.getResolution<ResolutionRecord>(resolutionId);
    if (
      !resolution ||
      resolution.roadmapId !== roadmapId ||
      resolution.userId !== userId
    ) {
      throw this.contextNotFound(
        'RESOLUTION_NOT_FOUND',
        'Resolution handle not found or expired.',
      );
    }

    const selected = resolution.matches[choice - 1];
    if (!selected?.id) {
      throw this.contextBadRequest(
        'INVALID_ARGUMENT',
        'choice is out of range for the current resolution.',
      );
    }

    const response = await this.getContextNodeChildren(
      roadmapId,
      selected.id,
      { limit },
      userId,
      traceId,
    );
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_resolution_children_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/resolutions/:resolutionId/children',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
      resolutionId,
    });
    return response;
  }

  async getContextFeatures(
    roadmapId: string,
    query: RoadmapAiContextFeaturesQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextChildrenResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!full)
      throw this.contextNotFound('NODE_NOT_FOUND', 'Roadmap not found');
    const state = this.normalizeFullRoadmapState(
      full as Record<string, unknown>,
    );

    const epicId = query.epic_id;
    if (!this.isUuid(epicId)) {
      throw this.contextBadRequest(
        'INVALID_UUID',
        'epic_id must be a valid UUID.',
      );
    }

    const epic = (state.roadmap_epics ?? []).find((item) => item.id === epicId);
    if (!epic) {
      throw this.contextNotFound('NODE_NOT_FOUND', 'Epic node not found.');
    }

    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const children = (epic.roadmap_features ?? [])
      .slice(0, limit)
      .flatMap((feature) =>
        feature.id
          ? [
              {
                id: feature.id,
                type: 'feature' as const,
                title: feature.title ?? 'Untitled feature',
                parent_id: epicId,
              },
            ]
          : [],
      );
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_features_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/features',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
    });
    return { children };
  }

  async getContextTasksAssignedToMe(
    roadmapId: string,
    query: RoadmapAiContextTasksAssignedQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextTasksAssignedResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!full)
      throw this.contextNotFound('NODE_NOT_FOUND', 'Roadmap not found');
    const state = this.normalizeFullRoadmapState(
      full as Record<string, unknown>,
    );

    const statusMode = query.status ?? 'open';
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const tasks: RoadmapAiContextTasksAssignedResponseDto['tasks'] = [];

    for (const epic of state.roadmap_epics ?? []) {
      if (tasks.length >= limit) break;
      const epicId = epic.id;
      for (const feature of epic.roadmap_features ?? []) {
        if (tasks.length >= limit) break;
        const featureId = feature.id;
        for (const task of feature.roadmap_tasks ?? []) {
          if (tasks.length >= limit) break;
          if (!task.id || task.assignee_id !== userId) continue;
          if (statusMode === 'open' && !this.isOpenTaskStatus(task.status))
            continue;
          tasks.push({
            id: task.id,
            type: 'task',
            title: task.title ?? 'Untitled task',
            status: task.status,
            feature_id: featureId,
            feature_title: feature.title ?? 'Untitled feature',
            epic_id: epicId,
            epic_title: epic.title ?? 'Untitled epic',
          });
        }
      }
    }

    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_tasks_assigned_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/tasks-assigned-to-me',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
    });
    return { tasks };
  }

  async getContextNodeDetails(
    roadmapId: string,
    nodeId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextNodeResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    if (!this.isUuid(nodeId)) {
      throw this.contextBadRequest(
        'INVALID_UUID',
        'nodeId must be a valid UUID.',
      );
    }
    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!full)
      throw this.contextNotFound('NODE_NOT_FOUND', 'Roadmap not found');
    const state = this.normalizeFullRoadmapState(
      full as Record<string, unknown>,
    );
    const roadmapNodeId = this.requireNodeId(state.id, 'roadmap');

    if (roadmapNodeId === nodeId) {
      const response: RoadmapAiContextNodeResponseDto = {
        id: roadmapNodeId,
        type: 'roadmap',
        title: state.name,
        description: state.description,
        status: state.status,
        start_date: state.start_date,
        end_date: state.end_date,
      };
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_node_details_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/nodes/:nodeId',
        authzMs,
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return response;
    }

    const locator = this.findNodeById(state, nodeId);
    if (!locator || locator.type === 'roadmap') {
      throw this.contextNotFound('NODE_NOT_FOUND', 'Node not found');
    }

    if (locator.type === 'epic') {
      const response: RoadmapAiContextNodeResponseDto = {
        id: this.requireNodeId(locator.epic.id, 'epic'),
        type: 'epic',
        title: locator.epic.title ?? 'Untitled epic',
        description: locator.epic.description,
        status: locator.epic.status,
        priority: locator.epic.priority,
        start_date: locator.epic.start_date,
        end_date: locator.epic.end_date,
        parent_id: roadmapNodeId,
      };
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_node_details_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/nodes/:nodeId',
        authzMs,
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return response;
    }

    if (locator.type === 'feature') {
      const response: RoadmapAiContextNodeResponseDto = {
        id: this.requireNodeId(locator.feature.id, 'feature'),
        type: 'feature',
        title: locator.feature.title ?? 'Untitled feature',
        description: locator.feature.description,
        status: locator.feature.status,
        start_date: locator.feature.start_date,
        end_date: locator.feature.end_date,
        parent_id: this.requireNodeId(locator.epic.id, 'epic'),
      };
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_node_details_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/nodes/:nodeId',
        authzMs,
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return response;
    }

    const response: RoadmapAiContextNodeResponseDto = {
      id: this.requireNodeId(locator.task.id, 'task'),
      type: 'task',
      title: locator.task.title ?? 'Untitled task',
      description: locator.task.description,
      status: locator.task.status,
      priority: locator.task.priority,
      due_date: locator.task.due_date,
      parent_id: this.requireNodeId(locator.feature.id, 'feature'),
    };
    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_node_details_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/nodes/:nodeId',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
    });
    return response;
  }

  async getContextNodeChildren(
    roadmapId: string,
    nodeId: string,
    query: RoadmapAiContextChildrenQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextChildrenResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    if (!this.isUuid(nodeId)) {
      throw this.contextBadRequest(
        'INVALID_UUID',
        'nodeId must be a valid UUID.',
      );
    }
    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!full)
      throw this.contextNotFound('NODE_NOT_FOUND', 'Roadmap not found');
    const state = this.normalizeFullRoadmapState(
      full as Record<string, unknown>,
    );
    const roadmapNodeId = this.requireNodeId(state.id, 'roadmap');
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);

    if (roadmapNodeId === nodeId) {
      const response = {
        children: (state.roadmap_epics ?? []).slice(0, limit).flatMap((epic) =>
          epic.id
            ? [
                {
                  id: epic.id,
                  type: 'epic' as const,
                  title: epic.title ?? 'Untitled epic',
                  parent_id: roadmapNodeId,
                },
              ]
            : [],
        ),
      };
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_node_children_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/nodes/:nodeId/children',
        authzMs,
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return response;
    }

    const locator = this.findNodeById(state, nodeId);
    if (!locator) {
      throw this.contextNotFound('NODE_NOT_FOUND', 'Node not found');
    }

    if (locator.type === 'epic') {
      const parentId = this.requireNodeId(locator.epic.id, 'epic');
      const response = {
        children: (locator.epic.roadmap_features ?? [])
          .slice(0, limit)
          .flatMap((feature) =>
            feature.id
              ? [
                  {
                    id: feature.id,
                    type: 'feature' as const,
                    title: feature.title ?? 'Untitled feature',
                    parent_id: parentId,
                  },
                ]
              : [],
          ),
      };
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_node_children_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/nodes/:nodeId/children',
        authzMs,
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return response;
    }

    if (locator.type === 'feature') {
      const parentId = this.requireNodeId(locator.feature.id, 'feature');
      const response = {
        children: (locator.feature.roadmap_tasks ?? [])
          .slice(0, limit)
          .flatMap((task) =>
            task.id
              ? [
                  {
                    id: task.id,
                    type: 'task' as const,
                    title: task.title ?? 'Untitled task',
                    parent_id: parentId,
                  },
                ]
              : [],
          ),
      };
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_node_children_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/nodes/:nodeId/children',
        authzMs,
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return response;
    }

    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_node_children_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/nodes/:nodeId/children',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
    });
    return { children: [] };
  }

  async commit(
    roadmapId: string,
    dto: RoadmapAiCommitDto,
    userId: string,
  ): Promise<RoadmapAiCommitResponseDto> {
    const preview = await this.previewStore.getPreview<PreviewRecord>(
      dto.preview_id,
    );
    if (
      !preview ||
      preview.roadmapId !== roadmapId ||
      preview.userId !== userId
    ) {
      throw new NotFoundException('Preview not found');
    }

    if (dto.revision_token && dto.revision_token !== preview.revisionToken) {
      throw new ConflictException({
        message: 'Preview revision token does not match request',
        code: 'STALE_REVISION',
      });
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
    const currentRevisionToken = this.requireRevisionToken(current.updated_at);
    if (currentRevisionToken !== preview.revisionToken) {
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
    await this.previewStore.deletePreview(dto.preview_id);
    await this.invalidateResolveLookupCache(roadmapId);

    return {
      committed_at: new Date().toISOString(),
      revision_token: persistedMeta?.updated_at ?? new Date().toISOString(),
      semantic_diff: preview.semanticDiff,
      roadmap: persisted as Record<string, unknown>,
    };
  }

  async discard(
    roadmapId: string,
    dto: RoadmapAiDiscardDto,
    userId: string,
  ): Promise<RoadmapAiDiscardResponseDto> {
    await this.assertCanEditRoadmap(roadmapId, userId);

    const preview = await this.previewStore.getPreview<PreviewRecord>(
      dto.preview_id,
    );
    if (
      !preview ||
      preview.roadmapId !== roadmapId ||
      preview.userId !== userId
    ) {
      throw new NotFoundException('Preview not found');
    }

    await this.previewStore.deletePreview(dto.preview_id);
    return {
      ok: true,
      preview_id: dto.preview_id,
      discarded_at: new Date().toISOString(),
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
    const cacheKey = this.buildAuthzDecisionCacheKey(roadmapId, userId);
    const cached = this.readAuthzDecisionCache(cacheKey);
    if (cached) {
      return cached;
    }

    const existing = await this.roadmapsRepo.findById(roadmapId);
    if (!existing) throw new NotFoundException('Roadmap not found');

    if (existing.project_id) {
      try {
        await this.roadmapAuthz.assertRoadmapPermission(
          roadmapId,
          userId,
          'roadmap.edit',
        );
      } catch (err) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Insufficient permissions for roadmap context access.',
        });
      }
      this.writeAuthzDecisionCache(
        cacheKey,
        existing as Record<string, unknown>,
      );
      return existing;
    }

    if (existing.owner_id !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Not the owner',
      });
    }
    this.writeAuthzDecisionCache(cacheKey, existing as Record<string, unknown>);
    return existing;
  }

  private buildAuthzDecisionCacheKey(
    roadmapId: string,
    userId: string,
  ): string {
    return `${AUTHZ_DECISION_CACHE_VERSION}:${roadmapId}:${userId}:roadmap.edit`;
  }

  private readAuthzDecisionCache(
    cacheKey: string,
  ): Record<string, unknown> | null {
    const cached = this.authzDecisionCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAtMs <= Date.now()) {
      this.authzDecisionCache.delete(cacheKey);
      return null;
    }
    return cached.roadmap;
  }

  private writeAuthzDecisionCache(
    cacheKey: string,
    roadmap: Record<string, unknown>,
  ): void {
    this.pruneExpiredAuthzDecisionCache();
    this.enforceAuthzDecisionCacheMaxEntries();
    this.authzDecisionCache.set(cacheKey, {
      roadmap,
      expiresAtMs: Date.now() + AUTHZ_DECISION_CACHE_TTL_MS,
    });
  }

  private pruneExpiredAuthzDecisionCache(): void {
    const now = Date.now();
    for (const [key, value] of this.authzDecisionCache.entries()) {
      if (value.expiresAtMs <= now) {
        this.authzDecisionCache.delete(key);
      }
    }
  }

  private enforceAuthzDecisionCacheMaxEntries(): void {
    const overflow =
      this.authzDecisionCache.size - AUTHZ_DECISION_CACHE_MAX_ENTRIES + 1;
    if (overflow <= 0) return;
    const keys = this.authzDecisionCache.keys();
    for (let index = 0; index < overflow; index += 1) {
      const key = keys.next().value;
      if (!key) break;
      this.authzDecisionCache.delete(key);
    }
  }

  private contextBadRequest(
    code: string,
    message: string,
  ): BadRequestException {
    return new BadRequestException({ code, message });
  }

  private contextNotFound(code: string, message: string): NotFoundException {
    return new NotFoundException({ code, message });
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private isOpenTaskStatus(status: string | undefined): boolean {
    if (!status) return true;
    return !['done', 'completed', 'archived'].includes(status.toLowerCase());
  }

  private async readActorDisplayName(userId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return null;
    }
    if (!data) {
      return null;
    }
    const value = (data as { display_name?: unknown }).display_name;
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private validateOptimisticRevision(
    baseRevision: number | undefined,
  ): RoadmapValidationIssueDto[] {
    if (baseRevision === undefined) return [];
    return [
      this.issue(
        'STALE_REVISION',
        'warning',
        '/base_revision',
        'base_revision is deprecated and ignored. Use revision_token for concurrency safety.',
      ),
    ];
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
      is_deliverable:
        this.readBoolean(operation.data, 'is_deliverable') ?? true,
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
      node.roadmap.start_date = this.shiftDate(
        node.roadmap.start_date,
        deltaDays,
      );
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
      node.feature.start_date = this.shiftDate(
        node.feature.start_date,
        deltaDays,
      );
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
    this.validateDateRange(
      state.start_date,
      state.end_date,
      '/roadmap',
      issues,
    );
    if (state.status && !ROADMAP_STATUS.includes(state.status)) {
      issues.push(
        this.issue(
          'INVALID_ENUM',
          'error',
          '/status',
          'Invalid roadmap status enum',
        ),
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
      dependencies: this.readDependencies(
        state as unknown as Record<string, unknown>,
      ),
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
        dependencies: this.readDependencies(
          epic as unknown as Record<string, unknown>,
        ),
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
            dependencies: this.readDependencies(
              task as unknown as Record<string, unknown>,
            ),
          });
        }
      }
    }

    return map;
  }

  private readDependencies(
    node: Record<string, unknown>,
  ): string[] | undefined {
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

  private resolveInsertPosition(
    position: number | undefined,
    size: number,
  ): number {
    if (position === undefined) return size;
    if (position < 0) return 0;
    if (position > size) return size;
    return position;
  }

  private allowedPatchFields(nodeType: RoadmapNodeType): string[] {
    switch (nodeType) {
      case 'roadmap':
        return [
          'name',
          'description',
          'status',
          'start_date',
          'end_date',
          'settings',
        ];
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

  private validateNodeStatus(
    nodeType: RoadmapNodeType,
    status: string,
  ): boolean {
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

  private findNodeById(
    state: FullRoadmapState,
    nodeId: string,
  ): NodeLocator | null {
    if (state.id === nodeId) {
      return { type: 'roadmap', roadmap: state };
    }

    for (
      let epicIndex = 0;
      epicIndex < (state.roadmap_epics ?? []).length;
      epicIndex++
    ) {
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

  private sortRecordsByPosition<T extends Record<string, unknown>>(
    records: T[],
  ): T[] {
    return records
      .map((record, index) => ({ record, index }))
      .sort((a, b) => {
        const aPosition = this.readNumber(a.record, 'position');
        const bPosition = this.readNumber(b.record, 'position');

        if (
          aPosition !== undefined &&
          bPosition !== undefined &&
          aPosition !== bPosition
        ) {
          return aPosition - bPosition;
        }
        if (aPosition !== undefined && bPosition === undefined) return -1;
        if (aPosition === undefined && bPosition !== undefined) return 1;

        return a.index - b.index;
      })
      .map((entry) => entry.record);
  }

  private normalizeFullRoadmapState(
    state: Record<string, unknown>,
  ): FullRoadmapState {
    const sourceEpics = this.sortRecordsByPosition(
      this.readArray(state, 'roadmap_epics') ??
        this.readArray(state, 'epics') ??
        [],
    );
    const roadmapEpics = sourceEpics.map((epicRaw, epicIndex) =>
      this.normalizeEpic(epicRaw, epicIndex),
    );

    return {
      id: this.readUuid(state, 'id'),
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

  private normalizeEpic(
    raw: Record<string, unknown>,
    epicIndex: number,
  ): FullRoadmapEpicDto {
    const sourceFeatures = this.sortRecordsByPosition(
      this.readArray(raw, 'roadmap_features') ??
        this.readArray(raw, 'features') ??
        [],
    );

    return {
      id: this.readUuid(raw, 'id'),
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
    const sourceTasks = this.sortRecordsByPosition(
      this.readArray(raw, 'roadmap_tasks') ??
        this.readArray(raw, 'tasks') ??
        [],
    );

    return {
      id: this.readUuid(raw, 'id'),
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

  private normalizeTask(
    raw: Record<string, unknown>,
    taskIndex: number,
  ): FullRoadmapTaskDto {
    return {
      id: this.readUuid(raw, 'id'),
      title: this.readString(raw, 'title') ?? 'Untitled task',
      description: this.readString(raw, 'description'),
      status: this.readString(raw, 'status') ?? 'todo',
      priority: this.readString(raw, 'priority') ?? 'medium',
      assignee_id: this.readString(raw, 'assignee_id'),
      due_date: this.readString(raw, 'due_date'),
      position: this.readNumber(raw, 'position') ?? taskIndex,
    };
  }

  private tokenizeSearchQuery(query: string): string[] {
    return this.normalizeSearchText(query)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  private normalizeSearchText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseSearchNodeType(
    value: unknown,
  ): 'epic' | 'feature' | 'task' | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'epic' ||
      normalized === 'feature' ||
      normalized === 'task'
    ) {
      return normalized;
    }
    return null;
  }

  private toContextSearchCandidate(
    candidate: RoadmapContextSearchCandidateRecord,
  ): ContextSearchCandidate {
    return {
      id: candidate.id,
      type: candidate.type,
      title: candidate.title,
      description: candidate.description,
      parent_id: candidate.parent_id,
      parent_title: candidate.parent_title,
    };
  }

  private buildResolveLookupCacheKey(
    roadmapId: string,
    nodeType: 'epic' | 'feature' | 'task' | null,
    query: string,
    limit: number,
  ): string {
    const queryHash = createHash('sha1')
      .update(query)
      .digest('hex')
      .slice(0, 16);
    return [
      'roadmap',
      'resolve',
      RESOLVE_LOOKUP_CACHE_VERSION,
      roadmapId,
      nodeType ?? 'any',
      queryHash,
      String(limit),
    ].join(':');
  }

  private async readResolveLookupCache(
    cacheKey: string,
  ): Promise<ContextSearchCandidate[] | null> {
    try {
      return await this.previewStore.getResolveLookup<ContextSearchCandidate[]>(
        cacheKey,
      );
    } catch (error) {
      this.logger.warn(
        `resolve_lookup cache read failed key=${cacheKey}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
      return null;
    }
  }

  private async writeResolveLookupCache(
    cacheKey: string,
    candidates: ContextSearchCandidate[],
  ): Promise<void> {
    try {
      await this.previewStore.setResolveLookup(cacheKey, candidates, {
        ttlSeconds: RESOLVE_LOOKUP_CACHE_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn(
        `resolve_lookup cache write failed key=${cacheKey}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    }
  }

  private scheduleResolveLookupCacheWrite(
    cacheKey: string,
    candidates: ContextSearchCandidate[],
  ): void {
    void this.writeResolveLookupCache(cacheKey, candidates);
  }

  private async invalidateResolveLookupCache(roadmapId: string): Promise<void> {
    try {
      await this.previewStore.deleteResolveLookupByRoadmap(roadmapId);
    } catch (error) {
      this.logger.warn(
        `resolve_lookup cache invalidation failed roadmap_id=${roadmapId}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    }
  }

  private logResolveLookupTelemetry(params: {
    traceId?: string;
    roadmapId: string;
    query: string;
    nodeType: 'epic' | 'feature' | 'task' | null;
    limit: number;
    cacheHit: boolean;
    cacheBypassReason?: 'miss' | 'disabled';
    cacheLookupMs: number;
    dbLookupMs: number;
    totalLookupMs: number;
    candidateCount: number;
    resolveStage?: 'epic' | 'feature' | 'task';
    resolveStageDbMs?: number;
    resolveStageCacheMs?: number;
  }): void {
    this.logger.log(
      [
        'event=resolve_lookup',
        `trace_id=${params.traceId ?? 'none'}`,
        `roadmap_id=${params.roadmapId}`,
        `node_type=${params.nodeType ?? 'any'}`,
        `limit=${params.limit}`,
        `cache_hit=${params.cacheHit}`,
        `cache_bypass_reason=${params.cacheBypassReason ?? 'none'}`,
        `resolve_lookup_cache_ms=${params.cacheLookupMs}`,
        `resolve_lookup_db_ms=${params.dbLookupMs}`,
        `resolve_lookup_total_ms=${params.totalLookupMs}`,
        `candidates=${params.candidateCount}`,
        `resolve_stage=${params.resolveStage ?? 'none'}`,
        `resolve_stage_cache_ms=${params.resolveStageCacheMs ?? 0}`,
        `resolve_stage_db_ms=${params.resolveStageDbMs ?? 0}`,
      ].join(' '),
    );
  }

  private logRoadmapAiHandlerTiming(params: {
    event: string;
    traceId?: string;
    roadmapId: string;
    method: 'GET' | 'POST';
    path: string;
    authzMs?: number;
    repoLookupMs?: number;
    cacheLookupMs?: number;
    cacheWriteMs?: number;
    dbLookupMs?: number;
    rankingMs?: number;
    semanticDiffApplyMs?: number;
    previewStoreSetMs?: number;
    previewStoreGetMs?: number;
    totalHandlerMs: number;
    previewId?: string;
    resolutionId?: string;
    resolveStage?: 'epic' | 'feature' | 'task';
  }): void {
    const segments = [
      `event=${params.event}`,
      `trace_id=${params.traceId ?? 'none'}`,
      `roadmap_id=${params.roadmapId}`,
      `method=${params.method}`,
      `path=${params.path}`,
      `authz_ms=${params.authzMs ?? 0}`,
      `repo_lookup_ms=${params.repoLookupMs ?? 0}`,
      `cache_lookup_ms=${params.cacheLookupMs ?? 0}`,
      `cache_write_ms=${params.cacheWriteMs ?? 0}`,
      `db_lookup_ms=${params.dbLookupMs ?? 0}`,
      `ranking_ms=${params.rankingMs ?? 0}`,
      `semantic_diff_apply_ms=${params.semanticDiffApplyMs ?? 0}`,
      `preview_store_set_ms=${params.previewStoreSetMs ?? 0}`,
      `preview_store_get_ms=${params.previewStoreGetMs ?? 0}`,
      `total_handler_ms=${params.totalHandlerMs}`,
      `preview_id=${params.previewId ?? 'none'}`,
      `resolution_id=${params.resolutionId ?? 'none'}`,
      `resolve_stage=${params.resolveStage ?? 'none'}`,
    ];
    this.logger.log(segments.join(' '));
  }

  private rankContextSearchMatches(
    candidates: ContextSearchCandidate[],
    query: string,
    queryTokens: string[],
    typeHint: Exclude<RoadmapNodeType, 'roadmap'> | undefined,
    limit: number,
  ): RoadmapAiContextSearchMatchDto[] {
    return candidates
      .map((candidate) =>
        this.scoreContextSearchCandidate(
          candidate,
          query,
          queryTokens,
          typeHint,
        ),
      )
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      })
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        parent_id: item.parent_id,
        parent_title: item.parent_title,
        score: Number(item.score.toFixed(4)),
        matched_fields: item.matched_fields.length
          ? item.matched_fields
          : undefined,
      }));
  }

  private isStrongUniqueContextSearchMatch(
    matches: RoadmapAiContextSearchMatchDto[],
  ): boolean {
    if (matches.length === 1) {
      const top = Number(matches[0]?.score ?? 0);
      return top >= 0.9;
    }
    if (matches.length < 2) return false;
    const top = Number(matches[0]?.score ?? 0);
    const second = Number(matches[1]?.score ?? 0);
    return top >= 0.95 && top - second >= 0.15;
  }

  private extractTypeHint(
    tokens: string[],
  ): Exclude<RoadmapNodeType, 'roadmap'> | undefined {
    if (tokens.includes('epic')) return 'epic';
    if (tokens.includes('feature')) return 'feature';
    if (tokens.includes('task')) return 'task';
    return undefined;
  }

  private scoreContextSearchCandidate(
    candidate: ContextSearchCandidate,
    query: string,
    queryTokens: string[],
    typeHint: Exclude<RoadmapNodeType, 'roadmap'> | undefined,
  ): ContextSearchCandidate & { score: number; matched_fields: string[] } {
    const matchedFields: string[] = [];
    let score = 0;

    const titleScore = this.scoreFieldMatch(
      candidate.title,
      query,
      queryTokens,
    );
    if (titleScore > 0) {
      score += titleScore * 1.0;
      matchedFields.push('title');
    }

    const descriptionScore = this.scoreFieldMatch(
      candidate.description,
      query,
      queryTokens,
    );
    if (descriptionScore > 0) {
      score += descriptionScore * 0.45;
      matchedFields.push('description');
    }

    const parentTitleScore = this.scoreFieldMatch(
      candidate.parent_title,
      query,
      queryTokens,
    );
    if (parentTitleScore > 0) {
      score += parentTitleScore * 0.35;
      matchedFields.push('parent_title');
    }

    if (typeHint && candidate.type === typeHint) {
      score += 0.2;
      matchedFields.push('type_hint');
    }
    const boundedScore = Math.max(0, Math.min(1, score));

    return {
      ...candidate,
      score: boundedScore,
      matched_fields: [...new Set(matchedFields)],
    };
  }

  private scoreFieldMatch(
    value: string | undefined,
    query: string,
    queryTokens: string[],
  ): number {
    if (!value) return 0;
    const normalized = this.normalizeSearchText(value);
    if (!normalized.trim()) return 0;

    if (normalized === query) return 1.0;
    if (normalized.startsWith(query)) return 0.9;
    if (normalized.includes(query)) return 0.72;

    if (queryTokens.length > 1) {
      const matchedTokenCount = queryTokens.filter((token) =>
        normalized.includes(token),
      ).length;
      if (matchedTokenCount === queryTokens.length) return 0.55;
      if (matchedTokenCount > 0) return 0.35;
    }
    return 0;
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

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  private requireNodeId(
    id: string | undefined,
    nodeType: RoadmapNodeType,
  ): string {
    if (id) return id;
    throw new InternalServerErrorException(
      `Context node is missing a persisted ${nodeType} id`,
    );
  }

  private requireRevisionToken(updatedAt: string | undefined): string {
    if (updatedAt) return updatedAt;
    throw new InternalServerErrorException(
      'Roadmap revision token is missing (updated_at is required for optimistic concurrency).',
    );
  }
}
