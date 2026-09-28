import { Logger } from '@nestjs/common';
import { PlanLimitException } from '../../../shared/entitlements/plan-limit.exception';
import { RoadmapAiService } from './roadmap-ai.service';
import {
  planLimitsHarness,
  planLimitsStub,
  type PlanLimitsStub,
} from './__roadmap-plan-limits-test-kit-spec';
import type { RoadmapPlanLimitsService } from './roadmap-plan-limits.service';

/**
 * The per-roadmap node limit on the AI write paths. Preview surfaces it as a
 * PLAN_LIMIT validation issue; commit, discard (undo) and rollback (redo)
 * enforce the grandfathered rule before the upsert; an idempotent replay is
 * never re-checked; the change log is windowed by the plan's retention.
 *
 * The real-rule cases run the real RoadmapPlanLimitsService and
 * EntitlementsService over a fake repository (Free = 250 nodes).
 */
describe('RoadmapAiService plan limits', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const REVISION_TOKEN = '2026-04-02T11:00:00.000Z';
  const CHANGE_ID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

  const epicId = (index: number) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

  /** A roadmap of `count` bare epics: `count` nodes. */
  const roadmapWith = (count: number) => ({
    id: ROADMAP_ID,
    name: 'Launch',
    status: 'active',
    roadmap_epics: Array.from({ length: count }, (_, index) => ({
      id: epicId(index),
      title: `Epic ${index}`,
      status: 'backlog',
      priority: 'medium',
      position: index,
      roadmap_features: [],
    })),
  });

  function build(options: {
    planLimits: PlanLimitsStub | RoadmapPlanLimitsService;
    liveNodes?: number;
    timelineBefore?: number;
    timelineAfter?: number;
    replay?: unknown;
    db?: unknown;
  }) {
    const previewStore = {
      setPreview: jest.fn().mockResolvedValue(undefined),
      getChangeTimeline: jest.fn().mockResolvedValue(
        options.timelineBefore === undefined
          ? null
          : {
              roadmapId: ROADMAP_ID,
              userId: USER_ID,
              updatedAt: REVISION_TOKEN,
              entries: [
                {
                  changeId: CHANGE_ID,
                  committedAt: REVISION_TOKEN,
                  status: 'discarded',
                  operations: [],
                  operationsCount: 1,
                  semanticDiff: { changes: [], summary: {} },
                  stateBefore: roadmapWith(options.timelineBefore),
                  stateAfter: roadmapWith(options.timelineAfter ?? 0),
                  revisionTokenBefore: REVISION_TOKEN,
                  revisionTokenAfter: REVISION_TOKEN,
                },
              ],
            },
      ),
      setChangeTimeline: jest.fn().mockResolvedValue(undefined),
      deleteResolveLookupByRoadmapAndNodeTypes: jest
        .fn()
        .mockResolvedValue(undefined),
      deleteResolveLookupByRoadmap: jest.fn().mockResolvedValue(undefined),
      readCommitIdempotency: jest
        .fn()
        .mockResolvedValue(options.replay ?? null),
      writeCommitIdempotency: jest.fn().mockResolvedValue(undefined),
    };
    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
        project_id: null,
        updated_at: REVISION_TOKEN,
      }),
      findUpdatedAt: jest.fn().mockResolvedValue(REVISION_TOKEN),
      findFull: jest
        .fn()
        .mockResolvedValue(roadmapWith(options.liveNodes ?? 0)),
    };
    const patchRepo = {
      upsertFullRoadmap: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RoadmapAiService(
      (options.db ?? {}) as never,
      roadmapsRepo as never,
      patchRepo as never,
      { assertRoadmapPermission: jest.fn() } as never,
      previewStore as never,
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
      options.planLimits as never,
    );
    return { service, previewStore, roadmapsRepo, patchRepo };
  }

  const freeRoadmap = (liveNodes: number) =>
    planLimitsHarness({ nodes: { [ROADMAP_ID]: liveNodes } }).planLimits;

  const addEpic = { op: 'add_epic', data: { title: 'One more' } };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('preview', () => {
    it('adds a PLAN_LIMIT error issue when the change would pass the limit', async () => {
      const { service } = build({
        planLimits: freeRoadmap(250),
        liveNodes: 250,
      });

      const result = await service.preview(
        ROADMAP_ID,
        { operations: [addEpic] } as any,
        USER_ID,
      );

      const issue = result.validation_issues.find(
        (candidate) => candidate.code === 'PLAN_LIMIT',
      );
      expect(issue).toMatchObject({
        severity: 'error',
        path: '/roadmap',
        node_ref: { type: 'roadmap', id: ROADMAP_ID },
      });
      expect(issue?.message).toContain('251 nodes');
      expect(issue?.message).toContain('Free plan allows 250 per roadmap');
    });

    it('passes the in-memory before/after totals and adds nothing when allowed', async () => {
      const planLimits = planLimitsStub();
      const { service } = build({ planLimits, liveNodes: 3 });

      const result = await service.preview(
        ROADMAP_ID,
        { operations: [addEpic] } as any,
        USER_ID,
      );

      expect(planLimits.previewIssue).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROADMAP_ID }),
        3,
        4,
      );
      expect(
        result.validation_issues.some((issue) => issue.code === 'PLAN_LIMIT'),
      ).toBe(false);
    });
  });

  describe('commit', () => {
    const commit = (
      service: RoadmapAiService,
      operations: unknown[],
      extra: Record<string, unknown> = {},
    ) =>
      service.commit(
        ROADMAP_ID,
        { revision_token: REVISION_TOKEN, operations, ...extra } as any,
        USER_ID,
      );

    it('refuses growth past the limit without writing', async () => {
      const { service, patchRepo } = build({
        planLimits: freeRoadmap(250),
        liveNodes: 250,
      });

      const error = await commit(service, [addEpic]).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        limit_key: 'roadmap_nodes_per_roadmap',
        context: 'full_state',
        used: 250,
      });
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });

    it('still applies edits and deletes on an over-limit roadmap', async () => {
      const edit = build({ planLimits: freeRoadmap(260), liveNodes: 260 });
      await commit(edit.service, [
        {
          op: 'update_node',
          node_type: 'epic',
          node_id: epicId(0),
          patch: { title: 'Renamed' },
        },
      ]);
      expect(edit.patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);

      const shrink = build({ planLimits: freeRoadmap(260), liveNodes: 260 });
      await commit(shrink.service, [
        { op: 'delete_node', node_type: 'epic', node_id: epicId(1) },
      ]);
      expect(shrink.patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });

    it('counts in memory: the check gets the base and candidate totals', async () => {
      const planLimits = planLimitsStub();
      const { service } = build({ planLimits, liveNodes: 5 });

      await commit(service, [addEpic]);

      expect(planLimits.assertFullStateWrite).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROADMAP_ID }),
        5,
        6,
      );
      expect(planLimits.countNodes).not.toHaveBeenCalled();
    });

    it('never re-checks an idempotent replay', async () => {
      const planLimits = planLimitsStub();
      const { createHash } =
        jest.requireActual<typeof import('crypto')>('crypto');
      const operations = [addEpic];
      const { service, patchRepo } = build({
        planLimits,
        liveNodes: 250,
        replay: {
          operations_hash: createHash('sha256')
            .update(JSON.stringify(operations))
            .digest('hex'),
          response: { change_id: CHANGE_ID },
        },
      });

      await expect(
        commit(service, operations, { idempotency_key: 'retry-key' }),
      ).resolves.toEqual({ change_id: CHANGE_ID });
      expect(planLimits.assertFullStateWrite).not.toHaveBeenCalled();
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });
  });

  describe('discard (undo) and rollback (redo)', () => {
    it('blocks a discard restoring above both the limit and the live count', async () => {
      const { service, patchRepo } = build({
        planLimits: freeRoadmap(260),
        liveNodes: 260,
        timelineBefore: 270,
      });

      await expect(
        service.discard(ROADMAP_ID, { change_id: CHANGE_ID }, USER_ID),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });

    it('allows a discard that shrinks, even on an over-limit roadmap', async () => {
      const { service, patchRepo } = build({
        planLimits: freeRoadmap(260),
        liveNodes: 260,
        timelineBefore: 255,
      });

      await service.discard(ROADMAP_ID, { change_id: CHANGE_ID }, USER_ID);
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });

    it('never reads the live count when the restored tree fits', async () => {
      const harness = planLimitsHarness({ nodes: { [ROADMAP_ID]: 100 } });
      const { service, patchRepo } = build({
        planLimits: harness.planLimits,
        liveNodes: 100,
        timelineBefore: 240,
      });

      await service.discard(ROADMAP_ID, { change_id: CHANGE_ID }, USER_ID);
      expect(harness.repo.countRoadmapNodes).not.toHaveBeenCalled();
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });

    it('blocks a redo that would grow past the limit', async () => {
      const { service, patchRepo } = build({
        planLimits: freeRoadmap(250),
        liveNodes: 250,
        timelineBefore: 250,
        timelineAfter: 252,
      });

      await expect(
        service.rollback(ROADMAP_ID, { change_id: CHANGE_ID }, USER_ID),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });
  });

  describe('listChangeHistory retention', () => {
    function historyDb() {
      const chain = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        lt: jest.fn(() => chain),
        gte: jest.fn(() => chain),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return { db: { from: jest.fn(() => chain) }, chain };
    }

    it('hides rows older than the plan cutoff', async () => {
      const planLimits = planLimitsStub();
      planLimits.retentionCutoff.mockResolvedValue('2026-09-15T00:00:00.000Z');
      const { db, chain } = historyDb();
      const { service } = build({ planLimits, db });

      await service.listChangeHistory(ROADMAP_ID, USER_ID);

      expect(planLimits.retentionCutoff).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROADMAP_ID }),
      );
      expect(chain.gte).toHaveBeenCalledWith(
        'committed_at',
        '2026-09-15T00:00:00.000Z',
      );
    });

    it('adds no filter on an unlimited plan', async () => {
      const { db, chain } = historyDb();
      const { service } = build({ planLimits: planLimitsStub(), db });

      await service.listChangeHistory(ROADMAP_ID, USER_ID);

      expect(chain.gte).not.toHaveBeenCalled();
    });
  });
});
