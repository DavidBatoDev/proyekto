import { NotFoundException } from '@nestjs/common';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';

/**
 * The assert* walkers resolve the parent chain on the way to a permission
 * verdict and now RETURN that scope instead of discarding it, so write services
 * can drive realtime + activity from it without re-querying. These tests lock
 * in both halves: the verdict (unchanged 404 / MissingPermission surfaces) and
 * the returned scope.
 */
describe('RoadmapAuthorizationService', () => {
  const userId = 'user-1';
  const roadmapId = 'rm-1';
  const projectId = 'proj-1';
  const featureId = 'feat-1';
  const permissions = { roadmap: { edit: true, assign: false } } as never;

  /**
   * Minimal PostgREST fluent-builder stub. `rows` maps a table name to the
   * single row `maybeSingle()` should resolve with (null = not found).
   */
  function buildDb(rows: Record<string, unknown>) {
    const calls: string[] = [];
    const db = {
      from(table: string) {
        calls.push(table);
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () =>
            Promise.resolve({ data: rows[table] ?? null, error: null }),
        };
        return builder;
      },
    };
    return { db, calls };
  }

  function build(
    rows: Record<string, unknown>,
    projectsService: Record<string, unknown> = {},
  ) {
    const { db, calls } = buildDb(rows);
    const projects = {
      assertProjectPermission: jest.fn().mockResolvedValue(permissions),
      assertProjectAnyPermission: jest.fn().mockResolvedValue(permissions),
      ...projectsService,
    };
    const service = new RoadmapAuthorizationService(
      db as never,
      projects as never,
    );
    return { service, projects, calls };
  }

  describe('assertRoadmapPermission', () => {
    it('returns the resolved scope for a project-linked roadmap', async () => {
      const { service, projects } = build({
        roadmaps: { project_id: projectId, owner_id: 'someone-else' },
      });

      const ctx = await service.assertRoadmapPermission(
        roadmapId,
        userId,
        'roadmap.edit',
      );

      expect(ctx).toEqual({
        roadmapId,
        projectId,
        ownerId: 'someone-else',
        permissions,
      });
      expect(projects.assertProjectPermission).toHaveBeenCalledWith(
        projectId,
        userId,
        'roadmap.edit',
      );
    });

    it('returns a null projectId for a personal roadmap owned by the caller', async () => {
      const { service, projects } = build({
        roadmaps: { project_id: null, owner_id: userId },
      });

      const ctx = await service.assertRoadmapPermission(
        roadmapId,
        userId,
        'roadmap.edit',
      );

      // Nothing is loggable to project_activity_log without a project.
      expect(ctx.projectId).toBeNull();
      expect(ctx.permissions).toBeNull();
      expect(ctx.roadmapId).toBe(roadmapId);
      expect(projects.assertProjectPermission).not.toHaveBeenCalled();
    });

    it('still throws MissingPermission on a personal roadmap the caller does not own', async () => {
      const { service } = build({
        roadmaps: { project_id: null, owner_id: 'another-user' },
      });

      await expect(
        service.assertRoadmapPermission(roadmapId, userId, 'roadmap.edit'),
      ).rejects.toBeInstanceOf(MissingPermissionException);
    });

    it('still throws NotFound for a missing roadmap', async () => {
      const { service } = build({ roadmaps: null });

      await expect(
        service.assertRoadmapPermission(roadmapId, userId, 'roadmap.edit'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertTaskPermission', () => {
    it('resolves both parents in ONE task query and returns featureId', async () => {
      const { service, calls } = build({
        roadmap_tasks: {
          feature_id: featureId,
          feature: { roadmap_id: roadmapId },
        },
        roadmaps: { project_id: projectId, owner_id: userId },
      });

      const ctx = await service.assertTaskPermission(
        'task-1',
        userId,
        'roadmap.edit',
      );

      expect(ctx.featureId).toBe(featureId);
      expect(ctx.roadmapId).toBe(roadmapId);
      expect(ctx.projectId).toBe(projectId);
      // The old walk read roadmap_features separately; the denormalized
      // roadmap_id on the embed removes that round-trip entirely.
      expect(calls).toEqual(['roadmap_tasks', 'roadmaps']);
      expect(calls).not.toContain('roadmap_features');
    });

    it('tolerates PostgREST returning the to-one embed as an array', async () => {
      const { service } = build({
        roadmap_tasks: {
          feature_id: featureId,
          feature: [{ roadmap_id: roadmapId }],
        },
        roadmaps: { project_id: projectId, owner_id: userId },
      });

      const ctx = await service.assertTaskPermission(
        'task-1',
        userId,
        'roadmap.edit',
      );

      expect(ctx.roadmapId).toBe(roadmapId);
    });

    it('throws NotFound("Task not found") when the task row is missing', async () => {
      const { service } = build({ roadmap_tasks: null });

      await expect(
        service.assertTaskPermission('task-1', userId, 'roadmap.edit'),
      ).rejects.toThrow('Task not found');
    });

    it('throws NotFound("Feature not found") when the parent has no roadmap', async () => {
      const { service } = build({
        roadmap_tasks: { feature_id: featureId, feature: { roadmap_id: null } },
      });

      await expect(
        service.assertTaskPermission('task-1', userId, 'roadmap.edit'),
      ).rejects.toThrow('Feature not found');
    });
  });

  describe('assertViewPermission', () => {
    it('reads roadmap meta once and returns the scope', async () => {
      const { service, calls } = build({
        roadmaps: { project_id: projectId, owner_id: userId },
      });

      const ctx = await service.assertViewPermission({ roadmapId }, userId);

      expect(ctx).toEqual({
        roadmapId,
        projectId,
        ownerId: userId,
        permissions: null,
      });
      // One meta read total — the view verdict and the returned scope share it.
      expect(calls.filter((t) => t === 'roadmaps')).toHaveLength(1);
    });

    it('404s rather than leaking a roadmap the caller cannot see', async () => {
      const { service } = build({
        roadmaps: { project_id: projectId, owner_id: 'another-user' },
        project_access: null,
      });

      await expect(
        service.assertViewPermission({ roadmapId }, userId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertRoadmapCommentPermission', () => {
    it('returns the scope alongside the OR-chain verdict', async () => {
      const { service, projects } = build({
        roadmaps: { project_id: projectId, owner_id: 'another-user' },
      });

      const ctx = await service.assertRoadmapCommentPermission(
        roadmapId,
        userId,
      );

      expect(ctx.projectId).toBe(projectId);
      expect(ctx.permissions).toBe(permissions);
      expect(projects.assertProjectAnyPermission).toHaveBeenCalledWith(
        projectId,
        userId,
        ['roadmap.comment', 'roadmap.edit'],
      );
    });
  });
});
