import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';
import { FeatureDependenciesService } from './feature-dependencies.service';

describe('FeatureDependenciesService', () => {
  const userId = 'user-1';
  const roadmapId = 'rm-1';
  const predecessor = 'feat-a';
  const successor = 'feat-b';

  const writeCtx = {
    roadmapId,
    projectId: 'proj-1',
    ownerId: userId,
    permissions: null,
  };

  function build(
    overrides: {
      findFeatureIdsInRoadmap?: jest.Mock;
      findById?: jest.Mock;
      create?: jest.Mock;
      remove?: jest.Mock;
    } = {},
  ) {
    const repo = {
      listForRoadmap: jest.fn().mockResolvedValue([]),
      findFeatureIdsInRoadmap:
        overrides.findFeatureIdsInRoadmap ??
        jest.fn().mockResolvedValue([predecessor, successor]),
      findById:
        overrides.findById ??
        jest.fn().mockResolvedValue({
          id: 'dep-1',
          roadmap_id: roadmapId,
          blocking_feature_id: predecessor,
          blocked_feature_id: successor,
        }),
      create: overrides.create ?? jest.fn().mockResolvedValue({ id: 'dep-1' }),
      remove: overrides.remove ?? jest.fn().mockResolvedValue(undefined),
    };
    const roadmapAuthz = {
      assertCanViewRoadmap: jest.fn().mockResolvedValue(undefined),
      assertRoadmapPermission: jest.fn().mockResolvedValue(writeCtx),
    };
    const effects = { emit: jest.fn(), record: jest.fn(), touch: jest.fn() };
    const service = new FeatureDependenciesService(
      repo as never,
      roadmapAuthz as never,
      effects as never,
    );
    return { service, repo, roadmapAuthz, effects };
  }

  describe('list', () => {
    it('requires view access on the roadmap in the URL', async () => {
      const { service, roadmapAuthz, repo } = build();
      await service.list(roadmapId, userId);
      expect(roadmapAuthz.assertCanViewRoadmap).toHaveBeenCalledWith(
        roadmapId,
        userId,
      );
      expect(repo.listForRoadmap).toHaveBeenCalledWith(roadmapId);
    });
  });

  describe('create', () => {
    it('requires roadmap.edit and emits the added activity', async () => {
      const { service, roadmapAuthz, effects } = build();

      await service.create(
        roadmapId,
        { blocking_feature_id: predecessor, blocked_feature_id: successor },
        userId,
      );

      expect(roadmapAuthz.assertRoadmapPermission).toHaveBeenCalledWith(
        roadmapId,
        userId,
        'roadmap.edit',
      );
      expect(effects.emit).toHaveBeenCalledWith(
        writeCtx,
        userId,
        expect.objectContaining({
          action: ACTIVITY_ACTIONS.FEATURE_DEPENDENCY_ADDED,
          entityType: 'feature_dependency',
          entityId: 'dep-1',
        }),
      );
    });

    it('emits rather than records, so collaborators get the realtime refresh', async () => {
      const { service, effects } = build();
      await service.create(
        roadmapId,
        { blocking_feature_id: predecessor, blocked_feature_id: successor },
        userId,
      );
      expect(effects.emit).toHaveBeenCalled();
      expect(effects.record).not.toHaveBeenCalled();
    });

    it('400s a self link before touching the database', async () => {
      const { service, repo, roadmapAuthz } = build();

      await expect(
        service.create(
          roadmapId,
          { blocking_feature_id: predecessor, blocked_feature_id: predecessor },
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Rejected up front: no authz walk, no insert.
      expect(roadmapAuthz.assertRoadmapPermission).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('404s when an endpoint belongs to another roadmap', async () => {
      const { service, repo, effects } = build({
        // Only one of the two ids came back as belonging to this roadmap.
        findFeatureIdsInRoadmap: jest.fn().mockResolvedValue([predecessor]),
      });

      await expect(
        service.create(
          roadmapId,
          { blocking_feature_id: predecessor, blocked_feature_id: 'foreign' },
          userId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.create).not.toHaveBeenCalled();
      expect(effects.emit).not.toHaveBeenCalled();
    });

    it('defaults the type to FS in the emitted metadata', async () => {
      const { service, effects } = build();
      await service.create(
        roadmapId,
        { blocking_feature_id: predecessor, blocked_feature_id: successor },
        userId,
      );
      expect(effects.emit).toHaveBeenCalledWith(
        writeCtx,
        userId,
        expect.objectContaining({
          metadata: expect.objectContaining({ dependency_type: 'FS' }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('404s when the edge belongs to a different roadmap, before authorizing', async () => {
      const { service, roadmapAuthz, repo } = build({
        findById: jest.fn().mockResolvedValue({
          id: 'dep-1',
          roadmap_id: 'other-roadmap',
          blocking_feature_id: predecessor,
          blocked_feature_id: successor,
        }),
      });

      await expect(
        service.remove(roadmapId, 'dep-1', userId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(roadmapAuthz.assertRoadmapPermission).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('404s when the edge does not exist', async () => {
      const { service } = build({
        findById: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.remove(roadmapId, 'missing', userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removes and emits when the edge belongs to the roadmap', async () => {
      const { service, repo, effects } = build();
      await service.remove(roadmapId, 'dep-1', userId);

      expect(repo.remove).toHaveBeenCalledWith('dep-1');
      expect(effects.emit).toHaveBeenCalledWith(
        writeCtx,
        userId,
        expect.objectContaining({
          action: ACTIVITY_ACTIONS.FEATURE_DEPENDENCY_REMOVED,
          entityId: 'dep-1',
        }),
      );
    });
  });
});
