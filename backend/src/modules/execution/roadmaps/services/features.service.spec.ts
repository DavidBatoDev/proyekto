import { Logger } from '@nestjs/common';
import { PlanLimitException } from '../../../shared/entitlements/plan-limit.exception';
import { FeaturesService } from './features.service';
import {
  nodeLimitException,
  planLimitsHarness,
  planLimitsStub,
  type PlanLimitsStub,
} from './__roadmap-plan-limits-test-kit-spec';
import type { RoadmapPlanLimitsService } from './roadmap-plan-limits.service';

/**
 * A feature's roadmap is its epic's. roadmap_features.roadmap_id is what node
 * counts, authorization walks and task scopes key on, so it must never come
 * from the client, and a move into another roadmap's epic must fit that
 * roadmap's node limit and carry the column along.
 */
describe('FeaturesService roadmap scope', () => {
  const userId = 'user-1';
  const ROADMAP = 'rm-1';
  const OTHER_ROADMAP = 'rm-2';
  const sourceCtx = {
    roadmapId: ROADMAP,
    projectId: 'proj-1',
    ownerId: userId,
    permissions: null,
  };
  const otherCtx = {
    roadmapId: OTHER_ROADMAP,
    projectId: 'proj-2',
    ownerId: userId,
    permissions: null,
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
    fn.mock.invocationCallOrder[0];

  function build(
    planLimits: PlanLimitsStub | RoadmapPlanLimitsService = planLimitsStub(),
    options: { taskCount?: number } = {},
  ) {
    const existing = {
      id: 'f-1',
      epic_id: 'e-1',
      roadmap_id: ROADMAP,
      title: 'F',
      position: 0,
    };
    const repo = {
      findById: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({ id: 'f-new' }),
      update: jest
        .fn()
        .mockImplementation((_id: string, dto: Record<string, unknown>) =>
          Promise.resolve({ ...existing, ...dto }),
        ),
    };
    const tasksRepo = {
      findByFeature: jest.fn().mockResolvedValue(
        Array.from({ length: options.taskCount ?? 3 }, (_, i) => ({
          id: `t-${i}`,
        })),
      ),
    };
    const authz = {
      assertFeaturePermission: jest.fn().mockResolvedValue(sourceCtx),
      // e-1 / e-2 live in rm-1; e-9 lives in rm-2.
      assertEpicPermission: jest.fn((epicId: string) =>
        Promise.resolve(epicId === 'e-9' ? otherCtx : sourceCtx),
      ),
    };
    const effects = { emit: jest.fn(), touch: jest.fn() };
    const activity = {
      diff: jest.fn(() => []),
      nodeUpdateAction: jest.fn(() => 'feature.updated'),
    };
    const service = new FeaturesService(
      repo as never,
      tasksRepo as never,
      authz as never,
      effects as never,
      activity as never,
      { createNotification: jest.fn() } as never,
      { inviteMentionedEmails: jest.fn() } as never,
      planLimits as never,
    );
    return { service, repo, tasksRepo, authz, effects };
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it("writes the epic's roadmap, not a mismatched client roadmap_id", async () => {
      const planLimits = planLimitsStub();
      const { service, repo } = build(planLimits);

      await service.create(
        { epic_id: 'e-1', roadmap_id: 'rm-throwaway', title: 'F' },
        userId,
      );

      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(sourceCtx, 1);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ epic_id: 'e-1', roadmap_id: ROADMAP }),
        userId,
      );
      expect(order(planLimits.assertCanAdd)).toBeLessThan(order(repo.create));
    });

    it("counts the epic's full roadmap even when the client names an empty one (real rule)", async () => {
      const { planLimits } = planLimitsHarness({
        subjects: { 'project:proj-1': { workspace_id: 'ws-free' } },
        nodes: { [ROADMAP]: 250, 'rm-throwaway': 0 },
      });
      const { service, repo } = build(planLimits);

      await expect(
        service.create(
          { epic_id: 'e-1', roadmap_id: 'rm-throwaway', title: 'F' },
          userId,
        ),
      ).rejects.toMatchObject({
        payload: expect.objectContaining({
          limit_key: 'roadmap_nodes_per_roadmap',
          limit: 250,
          used: 250,
        }),
      });
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // update: moves
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('moves between epics of one roadmap without a node check or roadmap rewrite', async () => {
      const planLimits = planLimitsStub();
      const { service, repo, tasksRepo, effects } = build(planLimits);

      await service.update('f-1', { epic_id: 'e-2' }, userId);

      expect(planLimits.assertCanAdd).not.toHaveBeenCalled();
      expect(tasksRepo.findByFeature).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('f-1', { epic_id: 'e-2' });
      expect(effects.touch).not.toHaveBeenCalled();
    });

    it('checks the destination roadmap for the feature and its tasks, then rewrites roadmap_id', async () => {
      const planLimits = planLimitsStub();
      const { service, repo, authz, effects } = build(planLimits);

      await service.update('f-1', { epic_id: 'e-9' }, userId);

      expect(authz.assertEpicPermission).toHaveBeenCalledWith(
        'e-9',
        userId,
        'roadmap.edit',
      );
      // 1 feature + 3 tasks land in rm-2.
      expect(planLimits.assertCanAdd).toHaveBeenCalledWith(otherCtx, 4);
      expect(order(planLimits.assertCanAdd)).toBeLessThan(order(repo.update));
      expect(repo.update).toHaveBeenCalledWith('f-1', {
        epic_id: 'e-9',
        roadmap_id: OTHER_ROADMAP,
      });
      // Both canvases change; activity stays on the source roadmap.
      expect(effects.touch).toHaveBeenCalledWith(otherCtx, userId);
      expect(effects.emit).toHaveBeenCalledWith(
        sourceCtx,
        userId,
        expect.anything(),
      );
    });

    it('writes nothing when the destination roadmap is full', async () => {
      const planLimits = planLimitsStub();
      planLimits.assertCanAdd.mockRejectedValue(nodeLimitException());
      const { service, repo, effects } = build(planLimits);

      await expect(
        service.update('f-1', { epic_id: 'e-9' }, userId),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(repo.update).not.toHaveBeenCalled();
      expect(effects.emit).not.toHaveBeenCalled();
      expect(effects.touch).not.toHaveBeenCalled();
    });

    it('refuses to push a Free roadmap at 248 past 250 with a 1 + 3 node move (real rule)', async () => {
      const { planLimits } = planLimitsHarness({
        subjects: { 'project:proj-2': { workspace_id: 'ws-free' } },
        nodes: { [OTHER_ROADMAP]: 248 },
      });
      const { service, repo } = build(planLimits);

      await expect(
        service.update('f-1', { epic_id: 'e-9' }, userId),
      ).rejects.toMatchObject({
        payload: expect.objectContaining({
          limit_key: 'roadmap_nodes_per_roadmap',
          limit: 250,
          used: 248,
        }),
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('reads the tasks once for a move that also sets a status', async () => {
      const planLimits = planLimitsStub();
      const { service, repo, tasksRepo } = build(planLimits);

      await service.update(
        'f-1',
        { epic_id: 'e-9', status: 'completed' },
        userId,
      );

      expect(tasksRepo.findByFeature).toHaveBeenCalledTimes(1);
      // The feature has tasks, so its status stays derived.
      expect(repo.update).toHaveBeenCalledWith('f-1', {
        epic_id: 'e-9',
        roadmap_id: OTHER_ROADMAP,
      });
    });

    it('still honors a status on a task-less feature', async () => {
      const { service, repo } = build(planLimitsStub(), { taskCount: 0 });

      await service.update('f-1', { status: 'completed' }, userId);

      expect(repo.update).toHaveBeenCalledWith('f-1', { status: 'completed' });
    });
  });
});
