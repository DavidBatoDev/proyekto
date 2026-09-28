import { Logger } from '@nestjs/common';
import { PlanLimitException } from '../../../shared/entitlements/plan-limit.exception';
import { EpicsService } from './epics.service';
import { FeaturesService } from './features.service';
import { TasksService } from './tasks.service';
import {
  nodeLimitException,
  planLimitsHarness,
  planLimitsStub,
  type PlanLimitsStub,
} from './__roadmap-plan-limits-test-kit-spec';
import type { RoadmapPlanLimitsService } from './roadmap-plan-limits.service';

/**
 * Per-node creates against the per-roadmap node limit: the check runs after
 * the permission walk and before ANY write, and a duplicate is judged on its
 * whole prefetched subtree, so a rejected gesture leaves nothing behind.
 */
describe('per-node roadmap creates respect the node limit', () => {
  const userId = 'user-1';
  const roadmapId = 'rm-1';
  const projectId = 'proj-1';
  const ctx = {
    roadmapId,
    projectId,
    ownerId: userId,
    permissions: null,
  };

  const authz = () => ({
    assertRoadmapPermission: jest.fn().mockResolvedValue(ctx),
    assertEpicPermission: jest.fn().mockResolvedValue(ctx),
    assertFeaturePermission: jest
      .fn()
      .mockResolvedValue({ ...ctx, featureId: 'f-1' }),
    assertTaskPermission: jest
      .fn()
      .mockResolvedValue({ ...ctx, featureId: 'f-1' }),
    assertProjectRoadmapPermission: jest.fn().mockResolvedValue({}),
    assertViewPermission: jest.fn().mockResolvedValue(ctx),
    resolveRoadmapId: jest.fn(),
  });
  const effects = () => ({ emit: jest.fn(), record: jest.fn() });
  const activity = () => ({
    diff: jest.fn(() => []),
    nodeUpdateAction: jest.fn(),
    reorderMetadata: jest.fn(() => ({})),
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
    fn.mock.invocationCallOrder[0];

  // -------------------------------------------------------------------------
  // Epics
  // -------------------------------------------------------------------------

  describe('EpicsService', () => {
    function build(
      planLimits: PlanLimitsStub | RoadmapPlanLimitsService = planLimitsStub(),
    ) {
      const repo = {
        findById: jest.fn().mockResolvedValue({
          id: 'e-1',
          roadmap_id: roadmapId,
          title: 'Epic',
          position: 0,
        }),
        create: jest.fn().mockResolvedValue({ id: 'e-new', title: 'Epic' }),
      };
      const featuresRepo = {
        findByEpic: jest.fn().mockResolvedValue([
          { id: 'f-1', title: 'F1' },
          { id: 'f-2', title: 'F2' },
        ]),
        create: jest
          .fn()
          .mockImplementation((dto: { title: string }) =>
            Promise.resolve({ id: `new-${dto.title}` }),
          ),
      };
      const tasksRepo = {
        findByFeature: jest
          .fn()
          .mockImplementation((featureId: string) =>
            Promise.resolve(
              featureId === 'f-1'
                ? [{ title: 'T1' }, { title: 'T2' }]
                : [{ title: 'T3' }],
            ),
          ),
        create: jest.fn().mockResolvedValue({ id: 't-new' }),
      };
      const service = new EpicsService(
        repo as never,
        featuresRepo as never,
        tasksRepo as never,
        authz() as never,
        effects() as never,
        activity() as never,
        { createNotification: jest.fn() } as never,
        { inviteMentionedEmails: jest.fn() } as never,
        planLimits as never,
      );
      return { service, repo, featuresRepo, tasksRepo };
    }

    it('create checks one node after authz and before the insert', async () => {
      const planLimits = planLimitsStub();
      const { service, repo } = build(planLimits);

      await service.create({ roadmap_id: roadmapId, title: 'E' }, userId);

      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(ctx, 1);
      expect(order(planLimits.assertCanAdd)).toBeLessThan(order(repo.create));
    });

    it('create inserts nothing when the limit rejects', async () => {
      const planLimits = planLimitsStub();
      planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
      const { service, repo } = build(planLimits);

      await expect(
        service.create({ roadmap_id: roadmapId, title: 'E' }, userId),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('duplicate asserts 1 + features + tasks before any create', async () => {
      const planLimits = planLimitsStub();
      const { service, repo, tasksRepo } = build(planLimits);

      await service.duplicate('e-1', userId);

      // 1 epic + 2 features + 3 tasks.
      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(ctx, 6);
      expect(order(planLimits.assertCanAdd)).toBeLessThan(order(repo.create));
      // The subtree is read once, up front, and reused for the clone.
      expect(tasksRepo.findByFeature).toHaveBeenCalledTimes(2);
      expect(tasksRepo.create).toHaveBeenCalledTimes(3);
    });

    it('a rejected duplicate writes nothing at all', async () => {
      const planLimits = planLimitsStub();
      planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
      const { service, repo, featuresRepo, tasksRepo } = build(planLimits);

      await expect(service.duplicate('e-1', userId)).rejects.toBeInstanceOf(
        PlanLimitException,
      );
      expect(repo.create).not.toHaveBeenCalled();
      expect(featuresRepo.create).not.toHaveBeenCalled();
      expect(tasksRepo.create).not.toHaveBeenCalled();
    });

    it('a Free roadmap at 245 nodes cannot take a 6-node clone (real rule)', async () => {
      const { planLimits } = planLimitsHarness({
        subjects: { [`project:${projectId}`]: { workspace_id: 'ws-free' } },
        nodes: { [roadmapId]: 245 },
      });
      const { service, repo } = build(planLimits);

      await expect(service.duplicate('e-1', userId)).rejects.toMatchObject({
        payload: expect.objectContaining({
          limit_key: 'roadmap_nodes_per_roadmap',
          limit: 250,
          used: 245,
        }),
      });
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Features
  // -------------------------------------------------------------------------

  describe('FeaturesService', () => {
    function build(planLimits: PlanLimitsStub = planLimitsStub()) {
      const repo = {
        findById: jest.fn().mockResolvedValue({
          id: 'f-1',
          epic_id: 'e-1',
          roadmap_id: roadmapId,
          title: 'F',
          position: 0,
        }),
        findByEpic: jest.fn().mockResolvedValue([
          { id: 'f-1', position: 0 },
          { id: 'f-2', position: 1 },
        ]),
        bulkReorder: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'f-new' }),
      };
      const tasksRepo = {
        findByFeature: jest
          .fn()
          .mockResolvedValue([{ title: 'A' }, { title: 'B' }, { title: 'C' }]),
        create: jest.fn().mockResolvedValue({ id: 't-new' }),
      };
      const service = new FeaturesService(
        repo as never,
        tasksRepo as never,
        authz() as never,
        effects() as never,
        activity() as never,
        { createNotification: jest.fn() } as never,
        { inviteMentionedEmails: jest.fn() } as never,
        planLimits as never,
      );
      return { service, repo, tasksRepo };
    }

    it('create inserts nothing when the limit rejects', async () => {
      const planLimits = planLimitsStub();
      planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
      const { service, repo } = build(planLimits);

      await expect(
        service.create({ epic_id: 'e-1', title: 'F' } as never, userId),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(
        expect.objectContaining({ roadmapId }),
        1,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('duplicate asserts 1 + tasks before the sibling shift', async () => {
      const planLimits = planLimitsStub();
      const { service, repo } = build(planLimits);

      await service.duplicate('f-1', userId);

      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(
        expect.objectContaining({ roadmapId }),
        4,
      );
      expect(order(planLimits.assertCanAdd)).toBeLessThan(
        order(repo.bulkReorder),
      );
    });

    it('a rejected duplicate neither shifts siblings nor clones', async () => {
      const planLimits = planLimitsStub();
      planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
      const { service, repo, tasksRepo } = build(planLimits);

      await expect(service.duplicate('f-1', userId)).rejects.toBeInstanceOf(
        PlanLimitException,
      );
      expect(repo.bulkReorder).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
      expect(tasksRepo.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  /**
   * A supabase stand-in for the timer scaffold: `reads` is the first row each
   * table answers (null = none), and every insert is recorded.
   */
  function scaffoldDb(reads: Record<string, { id: string } | null>) {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const from = jest.fn((table: string) => {
      const chain = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        maybeSingle: jest.fn(() =>
          Promise.resolve({ data: reads[table] ?? null, error: null }),
        ),
        insert: jest.fn((row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: `new-${table}` }, error: null }),
            }),
          };
        }),
      };
      return chain;
    });
    return { db: { from }, inserts };
  }

  describe('TasksService', () => {
    function build(
      planLimits: PlanLimitsStub = planLimitsStub(),
      db: { from: jest.Mock } = scaffoldDb({}).db,
    ) {
      const task = { id: 't-1', feature_id: 'f-1', title: 'T', position: 0 };
      const repo = {
        findById: jest.fn().mockResolvedValue(task),
        findByFeature: jest.fn().mockResolvedValue([
          { id: 't-1', position: 0 },
          { id: 't-2', position: 1 },
        ]),
        bulkReorder: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue(task),
        getHistory: jest.fn().mockResolvedValue([]),
      };
      const authzMock = authz();
      const featureStatusSync = {
        syncAfterTaskChange: jest.fn().mockResolvedValue(undefined),
      };
      const effectsMock = effects();
      const service = new TasksService(
        repo as never,
        authzMock as never,
        db as never,
        {
          notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined),
        } as never,
        effectsMock as never,
        activity() as never,
        featureStatusSync as never,
        planLimits as never,
      );
      return {
        service,
        repo,
        authz: authzMock,
        featureStatusSync,
        effects: effectsMock,
      };
    }

    it('create inserts nothing when the limit rejects', async () => {
      const planLimits = planLimitsStub();
      planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
      const { service, repo, featureStatusSync } = build(planLimits);

      await expect(
        service.create({ feature_id: 'f-1', title: 'T' } as never, userId),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(
        expect.objectContaining({ roadmapId }),
        1,
      );
      expect(repo.create).not.toHaveBeenCalled();
      expect(featureStatusSync.syncAfterTaskChange).not.toHaveBeenCalled();
    });

    it('duplicate asserts one node before the sibling shift', async () => {
      const planLimits = planLimitsStub();
      const { service, repo } = build(planLimits);

      await service.duplicate('t-1', userId);

      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(
        expect.objectContaining({ roadmapId }),
        1,
      );
      expect(order(planLimits.assertCanAdd)).toBeLessThan(
        order(repo.bulkReorder),
      );
    });

    it('a rejected duplicate neither shifts siblings nor clones', async () => {
      const planLimits = planLimitsStub();
      planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
      const { service, repo } = build(planLimits);

      await expect(service.duplicate('t-1', userId)).rejects.toBeInstanceOf(
        PlanLimitException,
      );
      expect(repo.bulkReorder).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    describe('quickCreateFromTimer', () => {
      const dto = { project_id: projectId, title: ' Logged work ' } as never;

      it('adds one node when the whole scaffold exists', async () => {
        const planLimits = planLimitsStub();
        const { db, inserts } = scaffoldDb({
          roadmaps: { id: 'rm-1' },
          roadmap_epics: { id: 'e-1' },
          roadmap_features: { id: 'f-1' },
        });
        const { service, repo, authz, effects } = build(planLimits, db);

        await service.quickCreateFromTimer(dto, userId);

        expect(planLimits.assertCanAdd).toHaveBeenCalledWith(
          { roadmapId: 'rm-1', projectId, ownerId: null },
          1,
        );
        expect(inserts).toEqual([]);
        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ feature_id: 'f-1', title: 'Logged work' }),
          userId,
        );
        // The chain is already known: no extra roadmap lookup to notify.
        expect(authz.resolveRoadmapId).not.toHaveBeenCalled();
        expect(effects.emit).toHaveBeenCalledWith(
          expect.objectContaining({ roadmapId: 'rm-1', projectId }),
          userId,
          expect.anything(),
        );
      });

      it('counts the missing epic and feature it would scaffold', async () => {
        const planLimits = planLimitsStub();
        const { db, inserts } = scaffoldDb({ roadmaps: { id: 'rm-1' } });
        const { service } = build(planLimits, db);

        await service.quickCreateFromTimer(dto, userId);

        expect(planLimits.assertCanAdd).toHaveBeenCalledWith(
          { roadmapId: 'rm-1', projectId, ownerId: null },
          3,
        );
        expect(inserts.map((i) => i.table)).toEqual([
          'roadmap_epics',
          'roadmap_features',
        ]);
      });

      it('counts from 0 when the project has no roadmap yet', async () => {
        const planLimits = planLimitsStub();
        const { db, inserts } = scaffoldDb({});
        const { service } = build(planLimits, db);

        await service.quickCreateFromTimer(dto, userId);

        expect(planLimits.assertCanAdd).toHaveBeenCalledWith(
          { roadmapId: null, projectId, ownerId: null },
          3,
        );
        expect(inserts.map((i) => i.table)).toEqual([
          'roadmaps',
          'roadmap_epics',
          'roadmap_features',
        ]);
      });

      it('inserts nothing when the limit rejects', async () => {
        const planLimits = planLimitsStub();
        planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
        const { db, inserts } = scaffoldDb({ roadmaps: { id: 'rm-1' } });
        const { service, repo } = build(planLimits, db);

        await expect(
          service.quickCreateFromTimer(dto, userId),
        ).rejects.toBeInstanceOf(PlanLimitException);
        expect(inserts).toEqual([]);
        expect(repo.create).not.toHaveBeenCalled();
      });
    });

    describe('getHistory retention', () => {
      it('passes the plan cutoff to the repository', async () => {
        const planLimits = planLimitsStub();
        planLimits.retentionCutoff.mockResolvedValue(
          '2026-09-15T00:00:00.000Z',
        );
        const { service, repo } = build(planLimits);

        await service.getHistory('t-1', userId);

        expect(planLimits.retentionCutoff).toHaveBeenCalledWith(ctx);
        expect(repo.getHistory).toHaveBeenCalledWith('t-1', {
          since: '2026-09-15T00:00:00.000Z',
        });
      });

      it('passes no cutoff on an unlimited plan', async () => {
        const { service, repo } = build();

        await service.getHistory('t-1', userId);

        expect(repo.getHistory).toHaveBeenCalledWith('t-1', undefined);
      });
    });
  });
});
