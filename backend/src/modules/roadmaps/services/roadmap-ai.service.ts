import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
  RoadmapAiChangeTimelineEntryDto,
  RoadmapAiContextChildDto,
  RoadmapAiContextChildrenQueryDto,
  RoadmapAiContextChildrenResponseDto,
  RoadmapAiContextActorResponseDto,
  RoadmapAiContextPreviewSelectorQueryDto,
  RoadmapAiContextTasksAssignedQueryDto,
  RoadmapAiContextTasksAssignedResponseDto,
  RoadmapAiContextTasksFilterQueryDto,
  RoadmapAiContextTasksFilteredResponseDto,
  RoadmapAiContextFeaturesQueryDto,
  RoadmapAiContextNodeResponseDto,
  RoadmapAiContextResolutionChildrenQueryDto,
  RoadmapAiContextResolveQueryDto,
  RoadmapAiContextResolveResponseDto,
  RoadmapAiContextSearchMatchDto,
  RoadmapAiContextSearchQueryDto,
  RoadmapAiContextSearchResponseDto,
  RoadmapAiContextSummaryResponseDto,
  RoadmapAiDiscardDto,
  RoadmapAiDiscardResponseDto,
  RoadmapAiOperationDto,
  RoadmapAiOperationResolutionDto,
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
import { deriveFeatureStatus } from './derive-feature-status';

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
  operationResults: RoadmapAiOperationResolutionDto[];
};

type ApplyOperationsResult = {
  issues: RoadmapValidationIssueDto[];
  tempIdMap: Map<string, string>;
  operationResults: RoadmapAiOperationResolutionDto[];
};

type ChangeTimelineEntryRecord = {
  changeId: string;
  committedAt: string;
  discardedAt?: string;
  status: 'applied' | 'discarded';
  operations: RoadmapAiOperationDto[];
  operationsCount: number;
  semanticDiff: SemanticDiffDto;
  tempIdMapping?: Record<string, string>;
  stateBefore: FullRoadmapState;
  stateAfter: FullRoadmapState;
  revisionTokenBefore: string;
  revisionTokenAfter: string;
};

type ChangeTimelineRecord = {
  roadmapId: string;
  userId: string;
  updatedAt: string;
  entries: ChangeTimelineEntryRecord[];
};

type FlatNodeSnapshot = {
  id: string;
  type: RoadmapNodeType;
  parentId?: string;
  position?: number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  tags?: string[];
  color?: string;
  isDeliverable?: boolean;
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

type ResolveLookupNodeType = 'epic' | 'feature' | 'task';

type ResolutionRecord = {
  roadmapId: string;
  userId: string;
  createdAt: string;
  matches: RoadmapAiContextSearchMatchDto[];
};

type ContextStateSelection = {
  state: FullRoadmapState;
  source: 'live' | 'preview';
  previewId?: string;
};

type AuthzDecisionCacheValue = {
  expiresAtMs: number;
  roadmap: Record<string, unknown>;
};

const PREVIEW_TTL_MS = 1000 * 60 * 30;
const RESOLUTION_TTL_SECONDS = 60 * 10;
const CHANGE_TIMELINE_TTL_SECONDS = 60 * 60 * 24 * 30;
const CHANGE_TIMELINE_MAX_ENTRIES = 250;
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
  // Scoped to a single state tree. Built lazily on first findNodeById miss,
  // invalidated by any structural mutation (add/move/delete). Makes bulk
  // fan-out over targets[] O(N + M) instead of O(N × M).
  private readonly nodeIndexCache = new WeakMap<
    FullRoadmapState,
    Map<string, NodeLocator>
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
    const applyResult = this.applyOperations(candidate, dto.operations);
    const operationIssues = applyResult.issues;
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
      operationResults: applyResult.operationResults,
    };
    const previewStoreSetStartedAt = Date.now();
    await this.previewStore.setPreview(
      previewId,
      record as unknown as Record<string, unknown>,
      Math.ceil(PREVIEW_TTL_MS / 1000),
    );
    this.logger.log(
      [
        'event=roadmap_ai_preview_stored',
        `roadmap_id=${roadmapId}`,
        `preview_id=${previewId}`,
        `ttl_seconds=${Math.ceil(PREVIEW_TTL_MS / 1000)}`,
        `created_at=${record.createdAt}`,
        `expires_at=${new Date(
          Date.parse(record.createdAt) + PREVIEW_TTL_MS,
        ).toISOString()}`,
      ].join(' '),
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
      operation_results: applyResult.operationResults,
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
      operation_results: preview.operationResults,
    };
  }

  async getContextSummary(
    roadmapId: string,
    query: RoadmapAiContextPreviewSelectorQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextSummaryResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const contextState = await this.resolveContextStateSelection(
      roadmapId,
      userId,
      query.preview_id,
    );
    const state = contextState.state;
    const roadmapNodeId = this.requireNodeId(state.id, 'roadmap');

    // Fetch the roadmap's current `updated_at` so the summary response
    // carries a fresh revision_token. The agent reads this every edit
    // turn and refreshes its cached session.revision_token, preventing
    // 409 STALE_REVISION on the next commit when anything (timeline
    // append, cache invalidation, another client) bumped `updated_at`
    // after our previous commit returned.
    const persistedUpdatedAt = await this.roadmapsRepo.findUpdatedAt(
      roadmapId,
    );

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
      revision_token: this.requireRevisionToken(persistedUpdatedAt ?? undefined),
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
                features: (epic.roadmap_features ?? []).flatMap((feature) =>
                  feature.id
                    ? [
                        {
                          id: feature.id,
                          title: feature.title ?? 'Untitled feature',
                          status: deriveFeatureStatus(feature.roadmap_tasks),
                        },
                      ]
                    : [],
                ),
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
      previewId: contextState.previewId,
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
      this.scheduleResolutionWrite(resolutionId, record, roadmapId, traceId);
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

  async resolveContext(
    roadmapId: string,
    query: RoadmapAiContextResolveQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextResolveResponseDto> {
    const handlerStartedAt = Date.now();
    // Parallelize the two independent Supabase round-trips:
    //   1. `searchContextNodes` — scans the full-text candidate index.
    //   2. `findFull` — fetches the roadmap graph we'll walk in-memory to
    //      derive the top match's parent + children in one shot.
    // The earlier version called `getContextNodeDetails` + `getContextNodeChildren`
    // in Promise.all, but each of those internally called `findFull` again,
    // giving us 2× findFull per batch (plus 3× authz). On Vercel that turned
    // a 1.9s legacy resolve into a 5–6s batch — exactly the latency we set
    // out to remove. Now: 1× authz (inside searchContextNodes) + 1× findFull.
    const includeParent = query.include_parent !== false;
    const includeChildren = query.include_children !== false;
    const childrenLimit = Math.min(Math.max(query.children_limit ?? 10, 1), 50);
    const needsState = includeParent || includeChildren;

    const [search, fullState] = await Promise.all([
      this.searchContextNodes(
        roadmapId,
        { query: query.query, node_type: query.node_type, limit: query.limit },
        userId,
        traceId,
      ),
      needsState
        ? this.roadmapsRepo.findFull(roadmapId, userId).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!search.matches.length) {
      this.logRoadmapAiHandlerTiming({
        event: 'roadmap_ai_context_resolve_timing',
        traceId,
        roadmapId,
        method: 'GET',
        path: '/roadmaps/:id/ai/context/resolve',
        totalHandlerMs: Date.now() - handlerStartedAt,
      });
      return {
        resolution_id: search.resolution_id,
        matches: search.matches,
        top_match: null,
      };
    }
    const top = search.matches[0];
    let parentResult: RoadmapAiContextNodeResponseDto | null = null;
    let childrenResult: RoadmapAiContextChildrenResponseDto = { children: [] };

    if (needsState && fullState) {
      const state = this.normalizeFullRoadmapState(
        fullState as Record<string, unknown>,
      );
      if (includeParent && top.parent_id) {
        parentResult = this.buildContextNodeDetailsFromState(state, top.parent_id);
      }
      if (includeChildren) {
        childrenResult = {
          children: this.buildContextNodeChildrenFromState(
            state,
            top.id,
            childrenLimit,
          ),
        };
      }
    }

    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_resolve_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/resolve',
      totalHandlerMs: Date.now() - handlerStartedAt,
    });
    return {
      resolution_id: search.resolution_id,
      matches: search.matches,
      top_match: {
        node: top,
        parent: parentResult,
        children: childrenResult.children,
      },
    };
  }

  private buildContextNodeDetailsFromState(
    state: FullRoadmapState,
    nodeId: string,
  ): RoadmapAiContextNodeResponseDto | null {
    if (!this.isUuid(nodeId)) return null;
    const roadmapNodeId = this.requireNodeId(state.id, 'roadmap');
    if (roadmapNodeId === nodeId) {
      return {
        id: roadmapNodeId,
        type: 'roadmap',
        title: state.name,
        description: state.description,
        status: state.status,
        start_date: state.start_date,
        end_date: state.end_date,
      };
    }
    const locator = this.findNodeById(state, nodeId);
    if (!locator || locator.type === 'roadmap') return null;
    if (locator.type === 'epic') {
      return {
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
    }
    if (locator.type === 'feature') {
      return {
        id: this.requireNodeId(locator.feature.id, 'feature'),
        type: 'feature',
        title: locator.feature.title ?? 'Untitled feature',
        description: locator.feature.description,
        status: deriveFeatureStatus(locator.feature.roadmap_tasks),
        start_date: locator.feature.start_date,
        end_date: locator.feature.end_date,
        parent_id: this.requireNodeId(locator.epic.id, 'epic'),
      };
    }
    return {
      id: this.requireNodeId(locator.task.id, 'task'),
      type: 'task',
      title: locator.task.title ?? 'Untitled task',
      description: locator.task.description,
      status: locator.task.status,
      priority: locator.task.priority,
      due_date: locator.task.due_date,
      parent_id: this.requireNodeId(locator.feature.id, 'feature'),
    };
  }

  private buildContextNodeChildrenFromState(
    state: FullRoadmapState,
    nodeId: string,
    limit: number,
  ): RoadmapAiContextChildDto[] {
    if (!this.isUuid(nodeId)) return [];
    const roadmapNodeId = this.requireNodeId(state.id, 'roadmap');
    if (roadmapNodeId === nodeId) {
      return (state.roadmap_epics ?? []).slice(0, limit).flatMap((epic) =>
        epic.id
          ? [
              {
                id: epic.id,
                type: 'epic' as const,
                title: epic.title ?? 'Untitled epic',
                status: epic.status,
                parent_id: roadmapNodeId,
              },
            ]
          : [],
      );
    }
    const locator = this.findNodeById(state, nodeId);
    if (!locator) return [];
    if (locator.type === 'epic') {
      const parentId = this.requireNodeId(locator.epic.id, 'epic');
      return (locator.epic.roadmap_features ?? [])
        .slice(0, limit)
        .flatMap((feature) =>
          feature.id
            ? [
                {
                  id: feature.id,
                  type: 'feature' as const,
                  title: feature.title ?? 'Untitled feature',
                  status: deriveFeatureStatus(feature.roadmap_tasks),
                  parent_id: parentId,
                },
              ]
            : [],
        );
    }
    if (locator.type === 'feature') {
      const parentId = this.requireNodeId(locator.feature.id, 'feature');
      return (locator.feature.roadmap_tasks ?? [])
        .slice(0, limit)
        .flatMap((task) =>
          task.id
            ? [
                {
                  id: task.id,
                  type: 'task' as const,
                  title: task.title ?? 'Untitled task',
                  status: task.status,
                  parent_id: parentId,
                },
              ]
            : [],
        );
    }
    return [];
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
                status: deriveFeatureStatus(feature.roadmap_tasks),
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
    const contextState = await this.resolveContextStateSelection(
      roadmapId,
      userId,
      query.preview_id,
    );
    const state = contextState.state;

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
      previewId: contextState.previewId,
    });
    return { tasks };
  }

  async getContextTasksFiltered(
    roadmapId: string,
    query: RoadmapAiContextTasksFilterQueryDto,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiContextTasksFilteredResponseDto> {
    const handlerStartedAt = Date.now();
    const authzStartedAt = Date.now();
    await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const contextState = await this.resolveContextStateSelection(
      roadmapId,
      userId,
      query.preview_id,
    );
    const state = contextState.state;

    const normalizedStatusFilter =
      typeof query.status === 'string' && query.status.trim().length > 0
        ? query.status.trim().toLowerCase()
        : 'all';

    const parentType =
      typeof query.parent_type === 'string' &&
      query.parent_type.trim().length > 0
        ? query.parent_type.trim().toLowerCase()
        : undefined;
    const parentId =
      typeof query.parent_id === 'string' && query.parent_id.trim().length > 0
        ? query.parent_id.trim()
        : undefined;

    if (parentType && !parentId) {
      throw this.contextBadRequest(
        'INVALID_ARGUMENT',
        'parent_id is required when parent_type is provided.',
      );
    }

    const assigneeId =
      typeof query.assignee_id === 'string' &&
      query.assignee_id.trim().length > 0
        ? query.assignee_id.trim()
        : undefined;
    const keyword =
      typeof query.keyword === 'string' && query.keyword.trim().length > 0
        ? query.keyword.trim().toLowerCase()
        : '';
    const includeCompletedRaw = query.include_completed === 'true';
    const includeCompleted =
      includeCompletedRaw ||
      ['done', 'completed', 'archived'].includes(normalizedStatusFilter);
    const limit = Math.min(Math.max(query.limit ?? 500, 1), 2000);

    const tasks: RoadmapAiContextTasksFilteredResponseDto['tasks'] = [];
    for (const epic of state.roadmap_epics ?? []) {
      if (tasks.length >= limit) break;
      const epicId = epic.id;
      const epicTitle = epic.title ?? 'Untitled epic';
      for (const feature of epic.roadmap_features ?? []) {
        if (tasks.length >= limit) break;
        const featureId = feature.id;
        const featureTitle = feature.title ?? 'Untitled feature';
        for (const task of feature.roadmap_tasks ?? []) {
          if (tasks.length >= limit) break;
          if (!task.id) continue;

          const taskStatus =
            typeof task.status === 'string'
              ? task.status.trim().toLowerCase()
              : '';
          const isOpen = this.isOpenTaskStatus(task.status);
          if (!includeCompleted && !isOpen) continue;

          if (normalizedStatusFilter === 'open' && !isOpen) continue;
          if (
            normalizedStatusFilter !== 'open' &&
            normalizedStatusFilter !== 'all' &&
            taskStatus !== normalizedStatusFilter
          ) {
            continue;
          }

          if (parentId) {
            if (parentType === 'epic' && epicId !== parentId) continue;
            if (parentType === 'feature' && featureId !== parentId) continue;
            if (!parentType && parentId !== epicId && parentId !== featureId) {
              continue;
            }
          }

          const taskAssigneeId =
            typeof task.assignee_id === 'string' &&
            task.assignee_id.trim().length > 0
              ? task.assignee_id.trim()
              : undefined;
          if (assigneeId && taskAssigneeId !== assigneeId) continue;

          if (keyword) {
            const searchableText = [task.title, featureTitle, epicTitle]
              .filter(
                (part) => typeof part === 'string' && part.trim().length > 0,
              )
              .join(' ')
              .toLowerCase();
            if (!searchableText.includes(keyword)) continue;
          }

          tasks.push({
            id: task.id,
            type: 'task',
            title: task.title ?? 'Untitled task',
            status: task.status,
            priority: task.priority,
            assignee_id: taskAssigneeId,
            feature_id: featureId,
            feature_title: featureTitle,
            epic_id: epicId,
            epic_title: epicTitle,
          });
        }
      }
    }

    this.logRoadmapAiHandlerTiming({
      event: 'roadmap_ai_context_tasks_filtered_timing',
      traceId,
      roadmapId,
      method: 'GET',
      path: '/roadmaps/:id/ai/context/tasks',
      authzMs,
      totalHandlerMs: Date.now() - handlerStartedAt,
      previewId: contextState.previewId,
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
        status: deriveFeatureStatus(locator.feature.roadmap_tasks),
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
                  status: epic.status,
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
                    status: deriveFeatureStatus(feature.roadmap_tasks),
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
                    status: task.status,
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
    const startedAt = Date.now();
    const includeRoadmap = dto.include_roadmap !== false;
    const includeTimeline = dto.include_timeline !== false;
    const operations = Array.isArray(dto.operations) ? dto.operations : [];
    if (operations.length === 0) {
      throw new BadRequestException({
        message: 'Commit requires at least one operation',
        code: 'EMPTY_OPERATIONS',
      });
    }

    this.logger.log(
      [
        'event=roadmap_ai_commit_start',
        `roadmap_id=${roadmapId}`,
        `operation_count=${operations.length}`,
        `revision_token_provided=${Boolean(dto.revision_token)}`,
        `include_roadmap=${includeRoadmap}`,
        `include_timeline=${includeTimeline}`,
      ].join(' '),
    );

    const authzStartedAt = Date.now();
    const current = await this.assertCanEditRoadmap(roadmapId, userId);
    const authzMs = Date.now() - authzStartedAt;
    const currentRevisionToken = this.requireRevisionToken(current.updated_at);
    if (dto.revision_token && dto.revision_token !== currentRevisionToken) {
      this.logger.warn(
        [
          'event=roadmap_ai_commit_revision_mismatch',
          `roadmap_id=${roadmapId}`,
          `provided_revision_token=${dto.revision_token}`,
          `current_revision_token=${currentRevisionToken}`,
        ].join(' '),
      );
      throw new ConflictException({
        message: 'Revision token does not match current roadmap revision',
        code: 'STALE_REVISION',
      });
    }

    const repoLookupStartedAt = Date.now();
    const full = includeRoadmap
      ? await this.roadmapsRepo.findFull(roadmapId, userId)
      : await this.roadmapsRepo.findFull(roadmapId, userId, {
          includeTaskAssigneeProfile: false,
        });
    const repoLookupMs = Date.now() - repoLookupStartedAt;
    if (!full) {
      throw new NotFoundException('Roadmap not found');
    }

    const semanticDiffApplyStartedAt = Date.now();
    const base = this.normalizeFullRoadmapState(
      full as Record<string, unknown>,
    );
    const candidate = this.clone(base);
    const applyResult = this.applyOperations(candidate, operations);
    const operationIssues = applyResult.issues;
    const validationIssues = [
      ...operationIssues,
      ...this.validateState(candidate),
      ...this.validateOptimisticRevision(dto.base_revision),
    ];
    const semanticDiff = this.computeSemanticDiff(base, candidate);
    const semanticDiffApplyMs = Date.now() - semanticDiffApplyStartedAt;
    const errorIssues = validationIssues.filter(
      (issue) => issue.severity === 'error',
    );
    if (errorIssues.length > 0) {
      throw new BadRequestException({
        message: 'Commit has validation errors and cannot be applied',
        validation_issues: errorIssues,
      });
    }

    if (!current.owner_id) {
      this.logger.error(
        [
          'event=roadmap_ai_commit_owner_missing',
          `roadmap_id=${roadmapId}`,
        ].join(' '),
      );
      throw new InternalServerErrorException(
        'Roadmap owner is missing for an existing roadmap',
      );
    }

    const stateCounts = this.summarizeRoadmapState(candidate);
    const semanticDiffSummary = semanticDiff.summary ?? {};
    this.logger.log(
      [
        'event=roadmap_ai_commit_upsert_start',
        `roadmap_id=${roadmapId}`,
        `operation_count=${operations.length}`,
        `epics=${stateCounts.epics}`,
        `features=${stateCounts.features}`,
        `tasks=${stateCounts.tasks}`,
        `semantic_changes=${semanticDiffSummary.total_changes ?? 0}`,
      ].join(' '),
    );

    const upsertStartedAt = Date.now();
    const upsertedAt = await this.patchRepo.upsertFullRoadmap({
      roadmapId,
      ownerId: current.owner_id,
      fullState: candidate,
      createIfMissing: false,
    });
    const upsertMs = Date.now() - upsertStartedAt;

    this.logger.log(
      [
        'event=roadmap_ai_commit_upsert_success',
        `roadmap_id=${roadmapId}`,
      ].join(' '),
    );

    let persistedReloadMs = 0;
    let candidateSnapshotRecord: Record<string, unknown>;
    let roadmapRecord: Record<string, unknown> | undefined;
    let stateAfter: FullRoadmapState;

    if (includeRoadmap) {
      const persistedReloadStartedAt = Date.now();
      const persisted = await this.roadmapsRepo.findFull(roadmapId, userId);
      persistedReloadMs = Date.now() - persistedReloadStartedAt;
      if (!persisted) {
        this.logger.error(
          [
            'event=roadmap_ai_commit_persisted_missing',
            `roadmap_id=${roadmapId}`,
          ].join(' '),
        );
        throw new InternalServerErrorException(
          'Roadmap not found after successful commit',
        );
      }
      candidateSnapshotRecord = persisted as Record<string, unknown>;
      roadmapRecord = persisted as Record<string, unknown>;
      stateAfter = this.normalizeFullRoadmapState(candidateSnapshotRecord);
    } else {
      // Reuse the applied in-memory state to avoid an extra full roadmap reload.
      candidateSnapshotRecord = this.clone(candidate) as unknown as Record<
        string,
        unknown
      >;
      stateAfter = this.clone(candidate);
    }

    // Derive the revision token from the authoritative post-upsert
    // `updated_at` SELECT rather than the RPC's returned timestamp.
    // The RPC value disagrees with later reads of the same row under
    // Postgres microsecond precision vs JS millisecond ISO formatting,
    // and under any post-upsert DB trigger that bumps `updated_at`. The
    // drift caused `409 STALE_REVISION` on the very next commit from the
    // same client (see logs.txt:2540). The lean SELECT below is ~1ms on
    // the primary-key index and runs only when `includeRoadmap` is false
    // — the full reload at line 1591 already carries an authoritative
    // `updated_at` when enabled.
    const revisionTokenLookupStartedAt = Date.now();
    let persistedUpdatedAt: string | null = null;
    if (includeRoadmap) {
      const raw = (candidateSnapshotRecord as Record<string, unknown>)
        .updated_at;
      if (typeof raw === 'string') {
        persistedUpdatedAt = raw;
      }
    }
    if (persistedUpdatedAt === null) {
      persistedUpdatedAt = await this.roadmapsRepo.findUpdatedAt(roadmapId);
    }
    const revisionTokenLookupMs = Date.now() - revisionTokenLookupStartedAt;
    const upsertReportedUpdatedAt = upsertedAt?.toISOString() ?? null;
    const revisionTokenAfter = this.requireRevisionToken(
      persistedUpdatedAt ?? upsertReportedUpdatedAt ?? currentRevisionToken,
    );
    const committedAt = new Date().toISOString();
    const changeId = randomUUID();
    const tempIdMapping: Record<string, string> = {};
    for (const result of applyResult.operationResults) {
      tempIdMapping[result.temp_id] = result.assigned_id;
    }

    // Run timeline append and cache invalidation in parallel — neither depends
    // on the other and both only require the upsert to have completed.
    const timelineStartedAt = Date.now();
    const resolveCacheInvalidateStartedAt = Date.now();
    const [timeline] = await Promise.all([
      this.appendChangeToTimeline({
        roadmapId,
        userId,
        entry: {
          changeId,
          committedAt,
          status: 'applied',
          operations,
          operationsCount: operations.length,
          semanticDiff,
          stateBefore: this.clone(base),
          stateAfter,
          tempIdMapping,
          revisionTokenBefore: currentRevisionToken,
          revisionTokenAfter,
        },
        tolerateStoreFailure: true,
        includeEntriesInResponse: includeTimeline,
      }),
      this.invalidateResolveLookupCache(
        roadmapId,
        this.collectResolveLookupNodeTypesFromSemanticDiff(semanticDiff),
      ),
    ]);
    const timelineMs = Date.now() - timelineStartedAt;
    const resolveCacheInvalidateMs =
      Date.now() - resolveCacheInvalidateStartedAt;
    const totalElapsedMs = Date.now() - startedAt;

    const revisionTokenDrifted =
      upsertReportedUpdatedAt !== null &&
      upsertReportedUpdatedAt !== revisionTokenAfter;
    this.logger.log(
      [
        'event=roadmap_ai_commit_success',
        `roadmap_id=${roadmapId}`,
        `change_id=${changeId}`,
        `revision_token=${revisionTokenAfter}`,
        `upsert_reported_updated_at=${upsertReportedUpdatedAt ?? 'null'}`,
        `revision_token_drifted=${revisionTokenDrifted}`,
        `elapsed_ms=${totalElapsedMs}`,
        `authz_ms=${authzMs}`,
        `repo_lookup_ms=${repoLookupMs}`,
        `semantic_diff_apply_ms=${semanticDiffApplyMs}`,
        `upsert_ms=${upsertMs}`,
        `persisted_reload_ms=${persistedReloadMs}`,
        `revision_lookup_ms=${revisionTokenLookupMs}`,
        `timeline_ms=${timelineMs}`,
        `resolve_cache_invalidate_ms=${resolveCacheInvalidateMs}`,
        `include_roadmap=${includeRoadmap}`,
        `include_timeline=${includeTimeline}`,
      ].join(' '),
    );

    const response: RoadmapAiCommitResponseDto = {
      change_id: changeId,
      committed_at: committedAt,
      revision_token: revisionTokenAfter,
      semantic_diff: semanticDiff,
      candidate_snapshot: candidateSnapshotRecord,
      timeline,
      operation_results: applyResult.operationResults,
    };

    if (includeRoadmap) {
      response.roadmap = roadmapRecord;
    }

    return response;
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

  async discard(
    roadmapId: string,
    dto: RoadmapAiDiscardDto,
    userId: string,
  ): Promise<RoadmapAiDiscardResponseDto> {
    const current = await this.assertCanEditRoadmap(roadmapId, userId);
    if (!current.owner_id) {
      throw new InternalServerErrorException(
        'Roadmap owner is missing for an existing roadmap',
      );
    }

    const timelineRecord = await this.getChangeTimeline(roadmapId, userId);
    const targetIndex = timelineRecord.entries.findIndex(
      (entry) => entry.changeId === dto.change_id,
    );
    if (targetIndex < 0) {
      throw new NotFoundException('Change not found');
    }

    const discardedAt = new Date().toISOString();
    const rollbackState = this.clone(
      timelineRecord.entries[targetIndex].stateBefore,
    );
    await this.patchRepo.upsertFullRoadmap({
      roadmapId,
      ownerId: current.owner_id,
      fullState: rollbackState,
      createIfMissing: false,
    });

    const affectedEntries = timelineRecord.entries.slice(targetIndex);
    for (
      let index = targetIndex;
      index < timelineRecord.entries.length;
      index += 1
    ) {
      timelineRecord.entries[index].status = 'discarded';
      timelineRecord.entries[index].discardedAt = discardedAt;
    }
    timelineRecord.updatedAt = discardedAt;
    await this.persistChangeTimeline(timelineRecord);
    await this.invalidateResolveLookupCache(
      roadmapId,
      this.collectResolveLookupNodeTypesFromTimelineEntries(affectedEntries),
    );

    const persisted = await this.roadmapsRepo.findFull(roadmapId, userId);
    const persistedMeta = await this.roadmapsRepo.findById(roadmapId, userId);
    const revisionToken = this.requireRevisionToken(
      persistedMeta?.updated_at ?? discardedAt,
    );

    return {
      change_id: dto.change_id,
      discarded_at: discardedAt,
      revision_token: revisionToken,
      timeline: timelineRecord.entries.map((entry) =>
        this.toTimelineEntryDto(entry),
      ),
      roadmap: (persisted ?? rollbackState) as Record<string, unknown>,
    };
  }

  async rollback(
    roadmapId: string,
    dto: RoadmapAiRollbackDto,
    userId: string,
  ): Promise<RoadmapAiRollbackResponseDto> {
    const current = await this.assertCanEditRoadmap(roadmapId, userId);
    if (!current.owner_id) {
      throw new InternalServerErrorException(
        'Roadmap owner is missing for an existing roadmap',
      );
    }

    const timelineRecord = await this.getChangeTimeline(roadmapId, userId);
    const targetIndex = timelineRecord.entries.findIndex(
      (entry) => entry.changeId === dto.change_id,
    );
    if (targetIndex < 0) {
      throw new NotFoundException('Change not found');
    }

    let applyUntilIndex = targetIndex;
    while (
      applyUntilIndex + 1 < timelineRecord.entries.length &&
      timelineRecord.entries[applyUntilIndex + 1].status === 'discarded'
    ) {
      applyUntilIndex += 1;
    }

    const reappliedAt = new Date().toISOString();
    const replayState = this.clone(
      timelineRecord.entries[applyUntilIndex].stateAfter,
    );
    await this.patchRepo.upsertFullRoadmap({
      roadmapId,
      ownerId: current.owner_id,
      fullState: replayState,
      createIfMissing: false,
    });

    const affectedEntries = timelineRecord.entries.slice(
      targetIndex,
      applyUntilIndex + 1,
    );
    for (let index = targetIndex; index <= applyUntilIndex; index += 1) {
      timelineRecord.entries[index].status = 'applied';
      timelineRecord.entries[index].discardedAt = undefined;
    }
    timelineRecord.updatedAt = reappliedAt;
    await this.persistChangeTimeline(timelineRecord);
    await this.invalidateResolveLookupCache(
      roadmapId,
      this.collectResolveLookupNodeTypesFromTimelineEntries(affectedEntries),
    );

    const persisted = await this.roadmapsRepo.findFull(roadmapId, userId);
    const persistedMeta = await this.roadmapsRepo.findById(roadmapId, userId);
    const revisionToken = this.requireRevisionToken(
      persistedMeta?.updated_at ?? reappliedAt,
    );

    return {
      change_id: dto.change_id,
      reapplied_at: reappliedAt,
      revision_token: revisionToken,
      timeline: timelineRecord.entries.map((entry) =>
        this.toTimelineEntryDto(entry),
      ),
      roadmap: (persisted ?? replayState) as Record<string, unknown>,
    };
  }

  private async getChangeTimeline(
    roadmapId: string,
    userId: string,
  ): Promise<ChangeTimelineRecord> {
    const now = new Date().toISOString();
    const stored =
      await this.previewStore.getChangeTimeline<ChangeTimelineRecord>(
        roadmapId,
        userId,
      );

    if (!stored || !Array.isArray(stored.entries)) {
      return {
        roadmapId,
        userId,
        updatedAt: now,
        entries: [],
      };
    }

    return {
      roadmapId,
      userId,
      updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : now,
      entries: stored.entries.filter(
        (entry) =>
          Boolean(entry) &&
          typeof entry.changeId === 'string' &&
          Boolean(entry.changeId) &&
          entry.stateBefore !== undefined &&
          entry.stateAfter !== undefined,
      ),
    };
  }

  private async persistChangeTimeline(
    record: ChangeTimelineRecord,
  ): Promise<void> {
    await this.previewStore.setChangeTimeline(
      record.roadmapId,
      record.userId,
      record as unknown as Record<string, unknown>,
      { ttlSeconds: CHANGE_TIMELINE_TTL_SECONDS },
    );
  }

  private async appendChangeToTimeline(params: {
    roadmapId: string;
    userId: string;
    entry: ChangeTimelineEntryRecord;
    tolerateStoreFailure: boolean;
    includeEntriesInResponse?: boolean;
  }): Promise<RoadmapAiChangeTimelineEntryDto[]> {
    try {
      const timelineRecord = await this.getChangeTimeline(
        params.roadmapId,
        params.userId,
      );
      timelineRecord.entries.push(params.entry);
      if (timelineRecord.entries.length > CHANGE_TIMELINE_MAX_ENTRIES) {
        timelineRecord.entries = timelineRecord.entries.slice(
          timelineRecord.entries.length - CHANGE_TIMELINE_MAX_ENTRIES,
        );
      }
      timelineRecord.updatedAt = params.entry.committedAt;
      await this.persistChangeTimeline(timelineRecord);
      if (params.includeEntriesInResponse === false) {
        return [];
      }
      return timelineRecord.entries.map((entry) =>
        this.toTimelineEntryDto(entry),
      );
    } catch (error) {
      if (!params.tolerateStoreFailure) {
        throw error;
      }
      this.logger.warn(
        [
          'event=roadmap_ai_timeline_store_failed',
          `roadmap_id=${params.roadmapId}`,
          `error=${(error as Error)?.message ?? 'unknown'}`,
        ].join(' '),
      );
      return [];
    }
  }

  private toTimelineEntryDto(
    entry: ChangeTimelineEntryRecord,
  ): RoadmapAiChangeTimelineEntryDto {
    return {
      change_id: entry.changeId,
      committed_at: entry.committedAt,
      discarded_at: entry.discardedAt,
      status: entry.status,
      operations_count: entry.operationsCount,
      semantic_diff: entry.semanticDiff,
      temp_id_mapping: entry.tempIdMapping,
    };
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

  private async resolveContextStateSelection(
    roadmapId: string,
    userId: string,
    previewId?: string,
  ): Promise<ContextStateSelection> {
    const normalizedPreviewId =
      typeof previewId === 'string' && previewId.trim().length > 0
        ? previewId.trim()
        : undefined;
    if (normalizedPreviewId) {
      if (!this.isUuid(normalizedPreviewId)) {
        throw this.contextBadRequest(
          'INVALID_UUID',
          'preview_id must be a valid UUID.',
        );
      }
      const preview =
        await this.previewStore.getPreview<PreviewRecord>(normalizedPreviewId);
      if (
        !preview ||
        preview.roadmapId !== roadmapId ||
        preview.userId !== userId
      ) {
        throw this.contextNotFound(
          'PREVIEW_NOT_FOUND',
          'Preview not found or not accessible for this roadmap context.',
        );
      }
      return {
        state: this.clone(preview.candidate),
        source: 'preview',
        previewId: normalizedPreviewId,
      };
    }

    const full = await this.roadmapsRepo.findFull(roadmapId, userId);
    if (!full)
      throw this.contextNotFound('NODE_NOT_FOUND', 'Roadmap not found');
    return {
      state: this.normalizeFullRoadmapState(full as Record<string, unknown>),
      source: 'live',
    };
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

  private resolveOperationIdentity(params: {
    idValue?: string;
    refValue?: string;
    idPath: string;
    refPath: string;
    required: boolean;
    missingMessage?: string;
    unresolvedRefMessage: string;
    issues: RoadmapValidationIssueDto[];
    tempIdMap: Map<string, string>;
  }): string | undefined {
    const hasId =
      typeof params.idValue === 'string' && params.idValue.trim().length > 0;
    const hasRef =
      typeof params.refValue === 'string' && params.refValue.trim().length > 0;

    if (hasId && hasRef) {
      params.issues.push(
        this.issue(
          'INVALID_TYPE',
          'error',
          params.idPath,
          `Provide only one of ${params.idPath.split('/').pop()} or ${params.refPath.split('/').pop()}`,
        ),
      );
      return undefined;
    }

    if (hasId) {
      return params.idValue;
    }

    if (hasRef) {
      const normalizedRef = params.refValue?.trim() ?? '';
      const resolved = params.tempIdMap.get(normalizedRef);
      if (!resolved) {
        params.issues.push(
          this.issue(
            'BROKEN_RELATIONSHIP',
            'error',
            params.refPath,
            params.unresolvedRefMessage,
          ),
        );
      }
      return resolved;
    }

    if (params.required) {
      params.issues.push(
        this.issue(
          'MISSING_REQUIRED_FIELD',
          'error',
          params.idPath,
          params.missingMessage ??
            `${params.idPath.split('/').pop()} is required`,
        ),
      );
    }
    return undefined;
  }

  private registerCreateOperationResolution(
    operation: RoadmapAiOperationDto,
    operationIndex: number,
    nodeType: Exclude<RoadmapNodeType, 'roadmap'>,
    assignedId: string,
    path: string,
    issues: RoadmapValidationIssueDto[],
    tempIdMap: Map<string, string>,
    operationResults: RoadmapAiOperationResolutionDto[],
  ): boolean {
    const tempId =
      typeof operation.temp_id === 'string' ? operation.temp_id.trim() : '';
    if (!tempId) {
      return true;
    }

    const existing = tempIdMap.get(tempId);
    if (existing) {
      issues.push(
        this.issue(
          'DUPLICATE_ID',
          'error',
          `${path}/temp_id`,
          `temp_id "${tempId}" was already assigned in this operation batch`,
        ),
      );
      return false;
    }

    tempIdMap.set(tempId, assignedId);
    operationResults.push({
      operation_index: operationIndex,
      temp_id: tempId,
      assigned_id: assignedId,
      node_type: nodeType,
    });
    return true;
  }

  private applyOperations(
    state: FullRoadmapState,
    operations: RoadmapAiOperationDto[],
  ): ApplyOperationsResult {
    const issues: RoadmapValidationIssueDto[] = [];
    const tempIdMap = new Map<string, string>();
    const operationResults: RoadmapAiOperationResolutionDto[] = [];

    operations.forEach((operation, index) => {
      const opPath = `/operations/${index}`;
      switch (operation.op) {
        case 'add_epic':
          this.applyAddEpic(
            state,
            operation,
            index,
            opPath,
            issues,
            tempIdMap,
            operationResults,
          );
          break;
        case 'add_feature':
          this.applyAddFeature(
            state,
            operation,
            index,
            opPath,
            issues,
            tempIdMap,
            operationResults,
          );
          break;
        case 'add_task':
          this.applyAddTask(
            state,
            operation,
            index,
            opPath,
            issues,
            tempIdMap,
            operationResults,
          );
          break;
        case 'update_node':
          this.applyToTargets(operation, opPath, (op, path) =>
            this.applyUpdateNode(state, op, path, issues, tempIdMap),
          );
          break;
        case 'move_node':
          this.applyToTargets(operation, opPath, (op, path) =>
            this.applyMoveNode(state, op, path, issues, tempIdMap),
          );
          break;
        case 'delete_node':
          this.applyToTargets(operation, opPath, (op, path) =>
            this.applyDeleteNode(state, op, path, issues, tempIdMap),
          );
          break;
        case 'mark_status':
          this.applyToTargets(operation, opPath, (op, path) =>
            this.applyMarkStatus(state, op, path, issues, tempIdMap),
          );
          break;
        case 'shift_dates':
          this.applyToTargets(operation, opPath, (op, path) =>
            this.applyShiftDates(state, op, path, issues, tempIdMap),
          );
          break;
      }
    });

    this.reindexPositions(state);
    return {
      issues,
      tempIdMap,
      operationResults,
    };
  }

  private applyToTargets(
    operation: RoadmapAiOperationDto,
    path: string,
    apply: (op: RoadmapAiOperationDto, path: string) => void,
  ) {
    const targets = operation.targets;
    if (!Array.isArray(targets) || targets.length === 0) {
      apply(operation, path);
      return;
    }
    targets.forEach((entry, index) => {
      const trimmed = typeof entry === 'string' ? entry.trim() : '';
      const synthetic: RoadmapAiOperationDto = { ...operation };
      delete synthetic.targets;
      if (trimmed && this.isUuid(trimmed)) {
        synthetic.node_id = trimmed;
        synthetic.node_ref = undefined;
      } else {
        synthetic.node_ref = trimmed;
        synthetic.node_id = undefined;
      }
      apply(synthetic, `${path}/targets/${index}`);
    });
  }

  private applyAddEpic(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    index: number,
    path: string,
    issues: RoadmapValidationIssueDto[],
    tempIdMap: Map<string, string>,
    operationResults: RoadmapAiOperationResolutionDto[],
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

    const assignedId = this.readUuid(operation.data, 'id') ?? randomUUID();
    if (
      !this.registerCreateOperationResolution(
        operation,
        index,
        'epic',
        assignedId,
        path,
        issues,
        tempIdMap,
        operationResults,
      )
    ) {
      return;
    }

    const epic: FullRoadmapEpicDto = {
      id: assignedId,
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
    this.invalidateNodeIndex(state);
  }

  private applyAddFeature(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    index: number,
    path: string,
    issues: RoadmapValidationIssueDto[],
    tempIdMap: Map<string, string>,
    operationResults: RoadmapAiOperationResolutionDto[],
  ) {
    const parentId = this.resolveOperationIdentity({
      idValue: operation.parent_id,
      refValue: operation.parent_ref,
      idPath: `${path}/parent_id`,
      refPath: `${path}/parent_ref`,
      required: true,
      missingMessage: 'parent_id or parent_ref is required for add_feature',
      unresolvedRefMessage: 'add_feature requires an existing epic parent',
      issues,
      tempIdMap,
    });
    if (!parentId) {
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

    const assignedId = this.readUuid(operation.data, 'id') ?? randomUUID();
    if (
      !this.registerCreateOperationResolution(
        operation,
        index,
        'feature',
        assignedId,
        path,
        issues,
        tempIdMap,
        operationResults,
      )
    ) {
      return;
    }

    const feature: FullRoadmapFeatureDto = {
      id: assignedId,
      title,
      description: this.readString(operation.data, 'description'),
      is_deliverable:
        this.readBoolean(operation.data, 'is_deliverable') ?? true,
      start_date: this.readString(operation.data, 'start_date'),
      end_date: this.readString(operation.data, 'end_date'),
      roadmap_tasks: [],
      position: 0,
    };

    const targetPosition = this.resolveInsertPosition(
      operation.position,
      parent.epic.roadmap_features?.length ?? 0,
    );
    (parent.epic.roadmap_features ??= []).splice(targetPosition, 0, feature);
    this.invalidateNodeIndex(state);
  }

  private applyAddTask(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    index: number,
    path: string,
    issues: RoadmapValidationIssueDto[],
    tempIdMap: Map<string, string>,
    operationResults: RoadmapAiOperationResolutionDto[],
  ) {
    const parentId = this.resolveOperationIdentity({
      idValue: operation.parent_id,
      refValue: operation.parent_ref,
      idPath: `${path}/parent_id`,
      refPath: `${path}/parent_ref`,
      required: true,
      missingMessage: 'parent_id or parent_ref is required for add_task',
      unresolvedRefMessage: 'add_task requires an existing feature parent',
      issues,
      tempIdMap,
    });
    if (!parentId) {
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

    const assignedId = this.readUuid(operation.data, 'id') ?? randomUUID();
    if (
      !this.registerCreateOperationResolution(
        operation,
        index,
        'task',
        assignedId,
        path,
        issues,
        tempIdMap,
        operationResults,
      )
    ) {
      return;
    }

    const task: FullRoadmapTaskDto = {
      id: assignedId,
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
    this.invalidateNodeIndex(state);
  }

  private applyUpdateNode(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
    tempIdMap: Map<string, string>,
  ) {
    const nodeId = this.resolveOperationIdentity({
      idValue: operation.node_id,
      refValue: operation.node_ref,
      idPath: `${path}/node_id`,
      refPath: `${path}/node_ref`,
      required: true,
      missingMessage: 'node_id or node_ref is required for update_node',
      unresolvedRefMessage: 'Target node was not found',
      issues,
      tempIdMap,
    });
    if (!nodeId) {
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

    const locator = this.findNodeById(state, nodeId);
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
            { type: locator.type, id: nodeId },
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
    tempIdMap: Map<string, string>,
  ) {
    const nodeId = this.resolveOperationIdentity({
      idValue: operation.node_id,
      refValue: operation.node_ref,
      idPath: `${path}/node_id`,
      refPath: `${path}/node_ref`,
      required: true,
      missingMessage: 'node_id or node_ref is required for move_node',
      unresolvedRefMessage: 'Target node was not found',
      issues,
      tempIdMap,
    });
    if (!nodeId) {
      return;
    }

    const locator = this.findNodeById(state, nodeId);
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
      this.invalidateNodeIndex(state);
      return;
    }

    if (locator.type === 'feature') {
      const resolvedNewParentId = this.resolveOperationIdentity({
        idValue: operation.new_parent_id,
        refValue: operation.new_parent_ref,
        idPath: `${path}/new_parent_id`,
        refPath: `${path}/new_parent_ref`,
        required: false,
        unresolvedRefMessage:
          'Feature move requires an existing epic destination',
        issues,
        tempIdMap,
      });
      if (
        !resolvedNewParentId &&
        (operation.new_parent_id || operation.new_parent_ref)
      ) {
        return;
      }

      const targetEpicId = resolvedNewParentId ?? locator.epic.id;
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
      this.invalidateNodeIndex(state);
      return;
    }

    const resolvedNewParentId = this.resolveOperationIdentity({
      idValue: operation.new_parent_id,
      refValue: operation.new_parent_ref,
      idPath: `${path}/new_parent_id`,
      refPath: `${path}/new_parent_ref`,
      required: false,
      unresolvedRefMessage:
        'Task move requires an existing feature destination',
      issues,
      tempIdMap,
    });
    if (
      !resolvedNewParentId &&
      (operation.new_parent_id || operation.new_parent_ref)
    ) {
      return;
    }

    const targetFeatureId = resolvedNewParentId ?? locator.feature.id;
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
    this.invalidateNodeIndex(state);
  }

  private applyDeleteNode(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
    tempIdMap: Map<string, string>,
  ) {
    const nodeId = this.resolveOperationIdentity({
      idValue: operation.node_id,
      refValue: operation.node_ref,
      idPath: `${path}/node_id`,
      refPath: `${path}/node_ref`,
      required: true,
      missingMessage: 'node_id or node_ref is required for delete_node',
      unresolvedRefMessage: 'Target node was not found',
      issues,
      tempIdMap,
    });
    if (!nodeId) {
      return;
    }

    const locator = this.findNodeById(state, nodeId);
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
      this.invalidateNodeIndex(state);
      return;
    }

    if (locator.type === 'feature') {
      (locator.epic.roadmap_features ?? []).splice(locator.featureIndex, 1);
      this.invalidateNodeIndex(state);
      return;
    }

    (locator.feature.roadmap_tasks ?? []).splice(locator.taskIndex, 1);
    this.invalidateNodeIndex(state);
  }

  private applyMarkStatus(
    state: FullRoadmapState,
    operation: RoadmapAiOperationDto,
    path: string,
    issues: RoadmapValidationIssueDto[],
    tempIdMap: Map<string, string>,
  ) {
    const nodeId = this.resolveOperationIdentity({
      idValue: operation.node_id,
      refValue: operation.node_ref,
      idPath: `${path}/node_id`,
      refPath: `${path}/node_ref`,
      required: true,
      missingMessage: 'node_id or node_ref is required for mark_status',
      unresolvedRefMessage: 'Target node was not found',
      issues,
      tempIdMap,
    });
    if (!nodeId) {
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

    const locator = this.findNodeById(state, nodeId);
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

    if (locator.type === 'feature') {
      issues.push(
        this.issue(
          'OUT_OF_SCOPE_MUTATION',
          'error',
          `${path}/node_id`,
          'mark_status is not supported on features; change child task statuses instead',
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
    tempIdMap: Map<string, string>,
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
    const nodeId = this.resolveOperationIdentity({
      idValue: operation.node_id,
      refValue: operation.node_ref,
      idPath: `${path}/node_id`,
      refPath: `${path}/node_ref`,
      required: true,
      missingMessage: 'node_id or node_ref is required for shift_dates',
      unresolvedRefMessage: 'Target node was not found',
      issues,
      tempIdMap,
    });
    if (!nodeId) {
      return;
    }

    const locator = this.findNodeById(state, nodeId);
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
        (feature) => deriveFeatureStatus(feature.roadmap_tasks) !== 'completed',
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

      if (prevNode.title !== nextNode.title) {
        changes.push({
          type: 'TITLE_CHANGED',
          node: { type: nextNode.type, id },
          from: { title: prevNode.title },
          to: { title: nextNode.title },
        });
      }

      if (prevNode.description !== nextNode.description) {
        changes.push({
          type: 'DESCRIPTION_CHANGED',
          node: { type: nextNode.type, id },
          from: { description: prevNode.description },
          to: { description: nextNode.description },
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

      if (prevNode.priority !== nextNode.priority) {
        changes.push({
          type: 'PRIORITY_CHANGED',
          node: { type: nextNode.type, id },
          from: { priority: prevNode.priority },
          to: { priority: nextNode.priority },
        });
      }

      if (prevNode.assigneeId !== nextNode.assigneeId) {
        changes.push({
          type: 'ASSIGNEE_CHANGED',
          node: { type: nextNode.type, id },
          from: { assignee_id: prevNode.assigneeId },
          to: { assignee_id: nextNode.assigneeId },
        });
      }

      if (
        JSON.stringify(prevNode.tags ?? []) !==
        JSON.stringify(nextNode.tags ?? [])
      ) {
        changes.push({
          type: 'TAGS_CHANGED',
          node: { type: nextNode.type, id },
          from: { tags: prevNode.tags ?? [] },
          to: { tags: nextNode.tags ?? [] },
        });
      }

      if (prevNode.color !== nextNode.color) {
        changes.push({
          type: 'COLOR_CHANGED',
          node: { type: nextNode.type, id },
          from: { color: prevNode.color },
          to: { color: nextNode.color },
        });
      }

      if (prevNode.isDeliverable !== nextNode.isDeliverable) {
        changes.push({
          type: 'DELIVERABLE_CHANGED',
          node: { type: nextNode.type, id },
          from: { is_deliverable: prevNode.isDeliverable },
          to: { is_deliverable: nextNode.isDeliverable },
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
      title: state.name,
      description: state.description,
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
        title: epic.title,
        description: epic.description,
        status: epic.status,
        priority: epic.priority,
        tags: Array.isArray(epic.tags) ? epic.tags : undefined,
        color: epic.color,
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
          title: feature.title,
          description: feature.description,
          status: deriveFeatureStatus(feature.roadmap_tasks),
          isDeliverable: feature.is_deliverable,
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
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            assigneeId: task.assignee_id,
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
    let index = this.nodeIndexCache.get(state);
    if (!index) {
      index = this.buildNodeIndex(state);
      this.nodeIndexCache.set(state, index);
    }
    return index.get(nodeId) ?? null;
  }

  private invalidateNodeIndex(state: FullRoadmapState): void {
    this.nodeIndexCache.delete(state);
  }

  private buildNodeIndex(
    state: FullRoadmapState,
  ): Map<string, NodeLocator> {
    const index = new Map<string, NodeLocator>();
    if (state.id) {
      index.set(state.id, { type: 'roadmap', roadmap: state });
    }
    const epics = state.roadmap_epics ?? [];
    for (let epicIndex = 0; epicIndex < epics.length; epicIndex++) {
      const epic = epics[epicIndex];
      if (!epic) continue;
      if (epic.id) {
        index.set(epic.id, { type: 'epic', epic, epicIndex, roadmap: state });
      }
      const features = epic.roadmap_features ?? [];
      for (
        let featureIndex = 0;
        featureIndex < features.length;
        featureIndex++
      ) {
        const feature = features[featureIndex];
        if (!feature) continue;
        if (feature.id) {
          index.set(feature.id, {
            type: 'feature',
            feature,
            featureIndex,
            epic,
            epicIndex,
            roadmap: state,
          });
        }
        const tasks = feature.roadmap_tasks ?? [];
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
          const task = tasks[taskIndex];
          if (!task) continue;
          if (task.id) {
            index.set(task.id, {
              type: 'task',
              task,
              taskIndex,
              feature,
              featureIndex,
              epic,
              epicIndex,
              roadmap: state,
            });
          }
        }
      }
    }
    return index;
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

  private scheduleResolutionWrite(
    resolutionId: string,
    record: ResolutionRecord,
    roadmapId: string,
    traceId?: string,
  ): void {
    void this.previewStore
      .setResolution(
        resolutionId,
        record as unknown as Record<string, unknown>,
        RESOLUTION_TTL_SECONDS,
      )
      .catch((error: unknown) => {
        this.logger.warn(
          [
            'event=resolution_store_failed',
            `trace_id=${traceId ?? 'none'}`,
            `roadmap_id=${roadmapId}`,
            `resolution_id=${resolutionId}`,
            `error=${error instanceof Error ? error.message : 'unknown_error'}`,
          ].join(' '),
        );
      });
  }

  private async invalidateResolveLookupCache(
    roadmapId: string,
    nodeTypes?: Iterable<ResolveLookupNodeType>,
  ): Promise<void> {
    try {
      const normalizedTypes = new Set<ResolveLookupNodeType>(nodeTypes ?? []);
      if (
        normalizedTypes.size === 0 ||
        normalizedTypes.size >= 3 ||
        typeof (
          this.previewStore as unknown as {
            deleteResolveLookupByRoadmapAndNodeTypes?: unknown;
          }
        ).deleteResolveLookupByRoadmapAndNodeTypes !== 'function'
      ) {
        await this.previewStore.deleteResolveLookupByRoadmap(roadmapId);
      } else {
        await (
          this.previewStore as unknown as {
            deleteResolveLookupByRoadmapAndNodeTypes: (
              roadmapId: string,
              nodeTypes: ResolveLookupNodeType[],
            ) => Promise<void>;
          }
        ).deleteResolveLookupByRoadmapAndNodeTypes(roadmapId, [
          ...normalizedTypes,
        ]);
      }
    } catch (error) {
      this.logger.warn(
        `resolve_lookup cache invalidation failed roadmap_id=${roadmapId}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    }
  }

  private collectResolveLookupNodeTypesFromTimelineEntries(
    entries: ChangeTimelineEntryRecord[],
  ): Set<ResolveLookupNodeType> {
    const nodeTypes = new Set<ResolveLookupNodeType>();
    for (const entry of entries) {
      this.collectResolveLookupNodeTypesFromSemanticDiff(
        entry?.semanticDiff,
        nodeTypes,
      );
    }
    return nodeTypes;
  }

  private collectResolveLookupNodeTypesFromSemanticDiff(
    semanticDiff: SemanticDiffDto | undefined,
    target: Set<ResolveLookupNodeType> = new Set<ResolveLookupNodeType>(),
  ): Set<ResolveLookupNodeType> {
    for (const change of semanticDiff?.changes ?? []) {
      const nodeType = change?.node?.type;
      if (
        nodeType === 'epic' ||
        nodeType === 'feature' ||
        nodeType === 'task'
      ) {
        target.add(nodeType);
      }
    }
    return target;
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
