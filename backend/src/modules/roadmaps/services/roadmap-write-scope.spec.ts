import { EpicsService } from './epics.service';
import { FeaturesService } from './features.service';
import { MilestonesService } from './milestones.service';
import { TasksService } from './tasks.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';

/**
 * Regression lock for the Phase 0 latency seam.
 *
 * Every roadmap write used to run the parent-chain walk twice: once inside the
 * permission assert, then again via `resolveRoadmapId` to address the realtime
 * room. The asserts now return the scope they resolved, so `resolveRoadmapId`
 * must not be reached on these paths at all. If someone reintroduces a call,
 * these tests fail rather than silently costing a round-trip per mutation.
 */
describe('roadmap write services reuse the resolved authz scope', () => {
  const userId = 'user-1';
  const roadmapId = 'rm-1';
  const projectId = 'proj-1';

  function ctx(overrides: Record<string, unknown> = {}) {
    return {
      roadmapId,
      projectId,
      ownerId: userId,
      permissions: { roadmap: { edit: true, assign: true } },
      ...overrides,
    };
  }

  function buildAuthz(overrides: Record<string, unknown> = {}) {
    return {
      // Any reach for these is the bug this suite guards against.
      resolveRoadmapId: jest.fn(),
      resolveProjectId: jest.fn(),
      assertRoadmapPermission: jest.fn().mockResolvedValue(ctx()),
      assertEpicPermission: jest.fn().mockResolvedValue(ctx()),
      assertFeaturePermission: jest.fn().mockResolvedValue(ctx()),
      assertMilestonePermission: jest.fn().mockResolvedValue(ctx()),
      assertTaskPermission: jest
        .fn()
        .mockResolvedValue(ctx({ featureId: 'feat-1' })),
      assertEpicCommentPermission: jest.fn().mockResolvedValue(ctx()),
      assertFeatureCommentPermission: jest.fn().mockResolvedValue(ctx()),
      assertTaskCommentPermission: jest
        .fn()
        .mockResolvedValue(ctx({ featureId: 'feat-1' })),
      ...overrides,
    };
  }

  const notifications = () => ({ createNotification: jest.fn() });

  /**
   * Build the REAL write-effects seam over a fake realtime publisher and a
   * real (but flag-disabled) recorder. That keeps these assertions about
   * realtime addressing while also proving the services drive the seam
   * correctly — a stubbed `effects` would hide a mis-wiring.
   */
  function effectsSeam() {
    const rt = { publishRoadmapChange: jest.fn() };
    const activity = new RoadmapActivityService(
      { log: jest.fn() } as never,
      { get: () => 'false' } as never, // ROADMAP_ACTIVITY_LOG_ENABLED off
    );
    return {
      rt,
      activity,
      effects: new RoadmapWriteEffects(rt as never, activity),
    };
  }

  describe('EpicsService', () => {
    function build(authz = buildAuthz()) {
      const repo = {
        findById: jest.fn().mockResolvedValue({ id: 'e-1' }),
        create: jest.fn().mockResolvedValue({ id: 'e-1' }),
        update: jest.fn().mockResolvedValue({ id: 'e-1' }),
        bulkReorder: jest.fn().mockResolvedValue([]),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      const featuresRepo = {
        findByEpic: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'f-1' }),
      };
      const tasksRepo = {
        findByFeature: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 't-1' }),
      };
      const { rt, effects, activity } = effectsSeam();
      const service = new EpicsService(
        repo as never,
        featuresRepo as never,
        tasksRepo as never,
        authz as never,
        effects,
        activity,
        notifications() as never,
        { inviteMentionedEmails: jest.fn() } as never,
      );
      return { service, repo, rt, authz };
    }

    it('update notifies from the assert scope without re-resolving', async () => {
      const { service, rt, authz } = build();
      await service.update('e-1', { title: 'x' } as never, userId);

      expect(authz.resolveRoadmapId).not.toHaveBeenCalled();
      expect(rt.publishRoadmapChange).toHaveBeenCalledWith(roadmapId, userId);
    });

    it('remove resolves the roadmap before the delete, not after', async () => {
      const { service, repo, rt, authz } = build();
      await service.remove('e-1', userId);

      expect(authz.resolveRoadmapId).not.toHaveBeenCalled();
      expect(authz.assertEpicPermission).toHaveBeenCalledTimes(1);
      expect(repo.remove).toHaveBeenCalledWith('e-1');
      expect(rt.publishRoadmapChange).toHaveBeenCalledWith(roadmapId, userId);
    });
  });

  describe('FeaturesService', () => {
    function build(authz = buildAuthz()) {
      const repo = {
        findById: jest.fn().mockResolvedValue({ id: 'f-1', epic_id: 'e-1' }),
        findByEpic: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'f-1' }),
        update: jest.fn().mockResolvedValue({ id: 'f-1' }),
        bulkReorder: jest.fn().mockResolvedValue([]),
        linkMilestone: jest.fn().mockResolvedValue({}),
        unlinkMilestone: jest.fn().mockResolvedValue({}),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      const tasksRepo = {
        findByFeature: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 't-1' }),
      };
      const { rt, effects, activity } = effectsSeam();
      const service = new FeaturesService(
        repo as never,
        tasksRepo as never,
        authz as never,
        effects,
        activity,
        notifications() as never,
        { inviteMentionedEmails: jest.fn() } as never,
      );
      return { service, rt, authz };
    }

    it.each([
      [
        'create',
        (s: FeaturesService) => s.create({ epic_id: 'e-1' } as never, userId),
      ],
      ['update', (s: FeaturesService) => s.update('f-1', {} as never, userId)],
      [
        'bulkReorder',
        (s: FeaturesService) => s.bulkReorder('e-1', {} as never, userId),
      ],
      [
        'linkMilestone',
        (s: FeaturesService) =>
          s.linkMilestone({ feature_id: 'f-1' } as never, userId),
      ],
      [
        'unlinkMilestone',
        (s: FeaturesService) =>
          s.unlinkMilestone({ feature_id: 'f-1' } as never, userId),
      ],
      ['remove', (s: FeaturesService) => s.remove('f-1', userId)],
    ])('%s never calls resolveRoadmapId', async (_name, run) => {
      const { service, rt, authz } = build();
      await run(service);

      expect(authz.resolveRoadmapId).not.toHaveBeenCalled();
      expect(rt.publishRoadmapChange).toHaveBeenCalledWith(roadmapId, userId);
    });
  });

  describe('MilestonesService', () => {
    function build(authz = buildAuthz()) {
      const repo = {
        findById: jest.fn().mockResolvedValue({ id: 'm-1' }),
        create: jest.fn().mockResolvedValue({ id: 'm-1' }),
        update: jest.fn().mockResolvedValue({ id: 'm-1' }),
        reorder: jest.fn().mockResolvedValue({ id: 'm-1' }),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      const { rt, effects, activity } = effectsSeam();
      const service = new MilestonesService(
        repo as never,
        authz as never,
        effects,
        activity,
      );
      return { service, rt, authz };
    }

    it.each([
      [
        'update',
        (s: MilestonesService) => s.update('m-1', {} as never, userId),
      ],
      [
        'reorder',
        (s: MilestonesService) => s.reorder('m-1', {} as never, userId),
      ],
      ['remove', (s: MilestonesService) => s.remove('m-1', userId)],
    ])('%s never calls resolveRoadmapId', async (_name, run) => {
      const { service, rt, authz } = build();
      await run(service);

      expect(authz.resolveRoadmapId).not.toHaveBeenCalled();
      expect(rt.publishRoadmapChange).toHaveBeenCalledWith(roadmapId, userId);
    });
  });

  describe('TasksService', () => {
    function build(authz = buildAuthz()) {
      const task = {
        id: 't-1',
        feature_id: 'feat-1',
        title: 'T',
        assignees: [],
      };
      const repo = {
        findById: jest.fn().mockResolvedValue(task),
        create: jest.fn().mockResolvedValue(task),
        update: jest.fn().mockResolvedValue(task),
        bulkReorder: jest.fn().mockResolvedValue([]),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      const { rt, effects, activity } = effectsSeam();
      const service = new TasksService(
        repo as never,
        authz as never,
        {} as never,
        notifications() as never,
        effects,
        activity,
      );
      return { service, rt, authz };
    }

    it.each([
      [
        'create',
        (s: TasksService) =>
          s.create({ feature_id: 'feat-1' } as never, userId),
      ],
      [
        'update',
        (s: TasksService) => s.update('t-1', { title: 'x' } as never, userId),
      ],
      [
        'bulkReorder',
        (s: TasksService) => s.bulkReorder('feat-1', {} as never, userId),
      ],
      ['remove', (s: TasksService) => s.remove('t-1', userId)],
    ])('%s never calls resolveRoadmapId', async (_name, run) => {
      const { service, rt, authz } = build();
      await run(service);

      expect(authz.resolveRoadmapId).not.toHaveBeenCalled();
      expect(rt.publishRoadmapChange).toHaveBeenCalledWith(roadmapId, userId);
    });

    it('walks authz ONCE for an assignee update, checking assign in memory', async () => {
      const { service, authz } = build();
      await service.update('t-1', { assignee_ids: ['u-2'] } as never, userId);

      // Previously this walked the whole task -> feature -> roadmap -> project
      // chain a second time just to test roadmap.assign.
      expect(authz.assertTaskPermission).toHaveBeenCalledTimes(1);
      expect(authz.assertTaskPermission).toHaveBeenCalledWith(
        't-1',
        userId,
        'roadmap.edit',
      );
    });

    it('still denies an assignee update when roadmap.assign is withheld', async () => {
      const authz = buildAuthz({
        assertTaskPermission: jest.fn().mockResolvedValue(
          ctx({
            featureId: 'feat-1',
            permissions: { roadmap: { edit: true, assign: false } },
          }),
        ),
      });
      const { service } = build(authz);

      await expect(
        service.update('t-1', { assignee_ids: ['u-2'] } as never, userId),
      ).rejects.toBeInstanceOf(MissingPermissionException);
    });

    it('allows assignment on a personal roadmap (owner check already passed)', async () => {
      const authz = buildAuthz({
        assertTaskPermission: jest
          .fn()
          .mockResolvedValue(
            ctx({ featureId: 'feat-1', projectId: null, permissions: null }),
          ),
      });
      const { service } = build(authz);

      await expect(
        service.update('t-1', { assignee_ids: ['u-2'] } as never, userId),
      ).resolves.toBeDefined();
    });
  });
});
