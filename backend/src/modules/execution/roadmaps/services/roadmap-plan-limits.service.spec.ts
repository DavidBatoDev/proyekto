import { Logger } from '@nestjs/common';
import { PlanLimitException } from '../../../shared/entitlements/plan-limit.exception';
import { planLimitsHarness } from './__roadmap-plan-limits-test-kit-spec';

/**
 * The per-roadmap node limit and retention window, run against the REAL
 * EntitlementsService over a fake repository seeded like the migration
 * (Free: 250 nodes per roadmap, 7 days of history; Pro and above unlimited
 * nodes).
 */
describe('RoadmapPlanLimitsService', () => {
  const FREE_ROADMAP = 'rm-free';
  const PRO_ROADMAP = 'rm-pro';

  async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected a rejection');
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('assertCanAdd (per-node creates)', () => {
    it('never counts nodes on an unlimited plan', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: { [`roadmap:${PRO_ROADMAP}`]: { workspace_id: 'ws-pro' } },
        nodes: { [PRO_ROADMAP]: 5000 },
      });

      await expect(
        planLimits.assertCanAdd(
          { roadmapId: PRO_ROADMAP, projectId: null, ownerId: 'u-1' },
          10,
        ),
      ).resolves.toBeUndefined();
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('lets a Free roadmap at 249 add one node and stops it at 250', async () => {
      const at249 = planLimitsHarness({ nodes: { [FREE_ROADMAP]: 249 } });
      await expect(
        at249.planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 1),
      ).resolves.toBeUndefined();

      const at250 = planLimitsHarness({ nodes: { [FREE_ROADMAP]: 250 } });
      const error = await rejection(
        at250.planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 1),
      );
      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        code: 'plan_limit',
        kind: 'count',
        limit_key: 'roadmap_nodes_per_roadmap',
        limit: 250,
        used: 250,
        plan: 'free',
        upgrade_plan: 'pro',
        context: 'create',
      });
      expect((error as PlanLimitException).getStatus()).toBe(403);
    });

    it('counts a whole subtree against the limit', async () => {
      const { planLimits } = planLimitsHarness({
        nodes: { [FREE_ROADMAP]: 245 },
      });

      await expect(
        planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 5),
      ).resolves.toBeUndefined();
      await expect(
        planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 6),
      ).rejects.toBeInstanceOf(PlanLimitException);
    });

    it('judges a linked roadmap by its project, from the authz context', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: { 'project:p-pro': { workspace_id: 'ws-pro' } },
        nodes: { [FREE_ROADMAP]: 900 },
      });

      await planLimits.assertCanAdd(
        { roadmapId: FREE_ROADMAP, projectId: 'p-pro', ownerId: 'u-1' },
        1,
      );
      expect(repo.resolveSubject).toHaveBeenCalledWith('project', 'p-pro');
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('exempts a guest-owned standalone roadmap without counting', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: {
          'roadmap:rm-guest': { workspace_id: null, exempt: true },
        },
        nodes: { 'rm-guest': 1000 },
      });

      await expect(
        planLimits.assertCanAdd({ roadmapId: 'rm-guest' }, 25),
      ).resolves.toBeUndefined();
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('never checks a write that adds nothing', async () => {
      const { planLimits, repo } = planLimitsHarness();
      await planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 0);
      expect(repo.resolveSubject).not.toHaveBeenCalled();
    });

    it('counts a roadmap that does not exist yet from 0', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: { 'project:p-1': { workspace_id: 'ws-free' } },
      });

      await planLimits.assertCanAdd(
        { roadmapId: null, projectId: 'p-1', ownerId: null },
        3,
      );
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('fails open when the scope lookup breaks', async () => {
      const { planLimits, repo } = planLimitsHarness({
        nodes: { [FREE_ROADMAP]: 900 },
      });
      repo.resolveSubject.mockRejectedValue(
        new Error('relation "plan_limits" does not exist'),
      );

      await expect(
        planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 1),
      ).resolves.toBeUndefined();
    });

    it('does not memoize a failed-open lookup', async () => {
      const { planLimits, repo } = planLimitsHarness({
        nodes: { [FREE_ROADMAP]: 250 },
      });
      repo.resolveSubject.mockRejectedValueOnce(new Error('timeout'));

      await expect(
        planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 1),
      ).resolves.toBeUndefined();
      await expect(
        planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 1),
      ).rejects.toBeInstanceOf(PlanLimitException);
    });

    it('memoizes the scope across creates on the same roadmap', async () => {
      const { planLimits, repo } = planLimitsHarness({
        nodes: { [FREE_ROADMAP]: 10 },
      });

      await planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 1);
      await planLimits.assertCanAdd({ roadmapId: FREE_ROADMAP }, 1);
      expect(repo.resolveSubject).toHaveBeenCalledTimes(1);
    });
  });

  describe('assertFullStateWrite (grandfather rule)', () => {
    it.each([
      [249, 250, 'ok'],
      [250, 251, 'violation'],
      [300, 299, 'ok'],
      [300, 300, 'ok'],
      [300, 301, 'violation'],
    ])(
      'previous %i -> new %i on Free is %s',
      async (previous, next, result) => {
        const { planLimits } = planLimitsHarness();
        const write = planLimits.assertFullStateWrite(
          { id: FREE_ROADMAP, project_id: null, owner_id: 'u-1' },
          previous,
          next,
        );
        if (result === 'ok') {
          await expect(write).resolves.toBeUndefined();
        } else {
          const error = await rejection(write);
          expect(error).toBeInstanceOf(PlanLimitException);
          expect((error as PlanLimitException).payload).toMatchObject({
            context: 'full_state',
            used: previous,
            limit: 250,
          });
          expect((error as PlanLimitException).payload.message).toContain(
            `${next} nodes`,
          );
        }
      },
    );

    it('does no lookup at all for a write that does not grow the roadmap', async () => {
      const { planLimits, repo } = planLimitsHarness();
      await planLimits.assertFullStateWrite({ id: FREE_ROADMAP }, 400, 380);
      expect(repo.resolveSubject).not.toHaveBeenCalled();
      expect(repo.listLimits).not.toHaveBeenCalled();
    });

    it('reads the live count only when the limit is finite and passed', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: { [`roadmap:${PRO_ROADMAP}`]: { workspace_id: 'ws-pro' } },
        nodes: { [FREE_ROADMAP]: 260, [PRO_ROADMAP]: 900 },
      });

      await planLimits.assertFullStateWrite({ id: PRO_ROADMAP }, 'live', 1200);
      await planLimits.assertFullStateWrite({ id: FREE_ROADMAP }, 'live', 240);
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();

      // Restoring above both the limit and the live count is refused...
      await expect(
        planLimits.assertFullStateWrite({ id: FREE_ROADMAP }, 'live', 270),
      ).rejects.toBeInstanceOf(PlanLimitException);
      // ...while shrinking an over-limit roadmap is not.
      await expect(
        planLimits.assertFullStateWrite({ id: FREE_ROADMAP }, 'live', 255),
      ).resolves.toBeUndefined();
      expect(repo.countRoadmapNodes).toHaveBeenCalledWith([FREE_ROADMAP]);
    });

    it('exempts a guest-owned standalone roadmap', async () => {
      const { planLimits } = planLimitsHarness({
        subjects: { 'roadmap:rm-guest': { workspace_id: null, exempt: true } },
      });
      await expect(
        planLimits.assertFullStateWrite({ id: 'rm-guest' }, 0, 900),
      ).resolves.toBeUndefined();
    });

    it('judges a roadmap not created yet by its would-be owner', async () => {
      const { planLimits } = planLimitsHarness({
        owners: {
          'u-guest': { workspaceId: null, isGuest: true },
          'u-real': { workspaceId: null, isGuest: false },
          'u-pro': { workspaceId: 'ws-pro' },
        },
      });
      const newRoadmap = (ownerId: string) => ({
        roadmapId: null,
        projectId: null,
        ownerId,
      });

      // A guest with no workspace is exempt; a real user with none is Free.
      await expect(
        planLimits.assertFullStateWrite(newRoadmap('u-guest'), 0, 400),
      ).resolves.toBeUndefined();
      await expect(
        planLimits.assertFullStateWrite(newRoadmap('u-real'), 0, 251),
      ).rejects.toBeInstanceOf(PlanLimitException);
      await expect(
        planLimits.assertFullStateWrite(newRoadmap('u-pro'), 0, 400),
      ).resolves.toBeUndefined();
    });
  });

  describe('previewIssue', () => {
    it('is null unless the change violates the limit', async () => {
      const { planLimits } = planLimitsHarness();
      const roadmap = { id: FREE_ROADMAP, project_id: null, owner_id: 'u-1' };

      await expect(planLimits.previewIssue(roadmap, 10, 250)).resolves.toBe(
        null,
      );
      await expect(planLimits.previewIssue(roadmap, 300, 280)).resolves.toBe(
        null,
      );
    });

    it('returns a PLAN_LIMIT error issue with the readable message', async () => {
      const { planLimits } = planLimitsHarness();

      const issue = await planLimits.previewIssue(
        { id: FREE_ROADMAP, project_id: null, owner_id: 'u-1' },
        240,
        262,
      );

      expect(issue).toEqual({
        code: 'PLAN_LIMIT',
        severity: 'error',
        path: '/roadmap',
        node_ref: { type: 'roadmap', id: FREE_ROADMAP },
        message: expect.stringContaining('262 nodes'),
      });
      expect(issue?.message).toContain('Free plan allows 250 per roadmap');
      expect(issue?.message).toContain('Pro');
    });
  });

  describe('assertCanLink', () => {
    it('never counts a link within one workspace', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: {
          'roadmap:rm-solo': { workspace_id: 'ws-free' },
          'project:p-same': { workspace_id: 'ws-free' },
        },
        nodes: { 'rm-solo': 400 },
      });

      await expect(
        planLimits.assertCanLink(
          { id: 'rm-solo', project_id: null, owner_id: 'u-1' },
          'p-same',
        ),
      ).resolves.toBeUndefined();
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('refuses a 300-node roadmap crossing into a Free workspace', async () => {
      const { planLimits } = planLimitsHarness({
        subjects: {
          'roadmap:rm-big': { workspace_id: 'ws-pro' },
          'project:p-free': { workspace_id: 'ws-free' },
        },
        nodes: { 'rm-big': 300 },
      });

      const error = await rejection(
        planLimits.assertCanLink(
          { id: 'rm-big', project_id: null, owner_id: 'u-1' },
          'p-free',
        ),
      );
      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        context: 'link',
        workspace_id: 'ws-free',
        limit: 250,
      });
      expect((error as PlanLimitException).payload.message).toContain(
        "destination workspace's Free plan",
      );
    });

    it('lets the same roadmap into a Pro workspace without counting', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: {
          'roadmap:rm-big': { workspace_id: 'ws-free' },
          'project:p-pro': { workspace_id: 'ws-pro' },
        },
        nodes: { 'rm-big': 300 },
      });

      await planLimits.assertCanLink({ id: 'rm-big' }, 'p-pro');
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('lets a roadmap that fits cross into Free', async () => {
      const { planLimits } = planLimitsHarness({
        subjects: {
          'roadmap:rm-small': { workspace_id: 'ws-pro' },
          'project:p-free': { workspace_id: 'ws-free' },
        },
        nodes: { 'rm-small': 250 },
      });

      await expect(
        planLimits.assertCanLink({ id: 'rm-small' }, 'p-free'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertCanUnlink', () => {
    const linked = { id: 'rm-big', project_id: 'p-pro', owner_id: 'u-1' };

    it("refuses a 300-node roadmap moving to its owner's Free workspace", async () => {
      const { planLimits } = planLimitsHarness({
        subjects: { 'project:p-pro': { workspace_id: 'ws-pro' } },
        owners: { 'u-1': { workspaceId: 'ws-free' } },
        nodes: { 'rm-big': 300 },
      });

      const error = await rejection(planLimits.assertCanUnlink(linked));
      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        context: 'link',
        workspace_id: 'ws-free',
        limit: 250,
        used: 0,
      });
    });

    it('never counts an unlink that stays in one workspace', async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: { 'project:p-free': { workspace_id: 'ws-free' } },
        owners: { 'u-1': { workspaceId: 'ws-free' } },
        nodes: { 'rm-big': 400 },
      });

      await expect(
        planLimits.assertCanUnlink({ ...linked, project_id: 'p-free' }),
      ).resolves.toBeUndefined();
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it("lets the roadmap go to an owner's Pro workspace without counting", async () => {
      const { planLimits, repo } = planLimitsHarness({
        subjects: { 'project:p-free': { workspace_id: 'ws-free' } },
        owners: { 'u-1': { workspaceId: 'ws-pro' } },
        nodes: { 'rm-big': 300 },
      });

      await planLimits.assertCanUnlink({ ...linked, project_id: 'p-free' });
      expect(repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('lets a roadmap that fits move to Free, and exempts a guest owner', async () => {
      const fits = planLimitsHarness({
        subjects: { 'project:p-pro': { workspace_id: 'ws-pro' } },
        owners: { 'u-1': { workspaceId: 'ws-free' } },
        nodes: { 'rm-big': 250 },
      });
      await expect(
        fits.planLimits.assertCanUnlink(linked),
      ).resolves.toBeUndefined();

      const guest = planLimitsHarness({
        subjects: { 'project:p-pro': { workspace_id: 'ws-pro' } },
        owners: { 'u-1': { workspaceId: null, isGuest: true } },
        nodes: { 'rm-big': 300 },
      });
      await expect(
        guest.planLimits.assertCanUnlink(linked),
      ).resolves.toBeUndefined();
      expect(guest.repo.countRoadmapNodes).not.toHaveBeenCalled();
    });

    it('does nothing for a roadmap that is not linked', async () => {
      const { planLimits, repo, db } = planLimitsHarness({
        nodes: { 'rm-big': 300 },
      });

      await planLimits.assertCanUnlink({ ...linked, project_id: null });
      expect(repo.resolveSubject).not.toHaveBeenCalled();
      expect(db.rpc).not.toHaveBeenCalled();
    });
  });

  describe('retentionCutoff', () => {
    it('is 7 days back on Free and null on Business', async () => {
      const { planLimits } = planLimitsHarness({
        subjects: {
          'roadmap:rm-business': { workspace_id: 'ws-business' },
        },
      });

      const before = Date.now();
      const free = await planLimits.retentionCutoff({ id: FREE_ROADMAP });
      const business = await planLimits.retentionCutoff({ id: 'rm-business' });

      expect(business).toBeNull();
      expect(free).not.toBeNull();
      const ageDays = (before - Date.parse(free as string)) / 86_400_000;
      expect(ageDays).toBeGreaterThan(6.99);
      expect(ageDays).toBeLessThan(7.01);
    });

    it('is null for a guest-owned roadmap', async () => {
      const { planLimits } = planLimitsHarness({
        subjects: { 'roadmap:rm-guest': { workspace_id: null, exempt: true } },
      });
      await expect(
        planLimits.retentionCutoff({
          roadmapId: 'rm-guest',
          projectId: null,
          ownerId: 'g-1',
        }),
      ).resolves.toBeNull();
    });
  });
});
