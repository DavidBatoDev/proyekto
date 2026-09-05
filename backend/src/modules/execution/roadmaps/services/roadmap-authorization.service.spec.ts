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

  describe('filterViewableRoadmapIds', () => {
    type BulkRow = {
      id: string;
      name: string;
      project_id: string | null;
      owner_id: string | null;
    };

    /**
     * Bulk-read stub: `.in()` terminates both chains (roadmaps: select -> in;
     * project_access: select -> eq -> in) and answers from the fixtures,
     * recording every call so chunking and scoping can be asserted.
     */
    function buildBulkDb(fixtures: {
      roadmaps: BulkRow[];
      projectAccess?: Array<{ project_id: string }> | 'error';
    }) {
      const inCalls: Array<{
        table: string;
        column: string;
        values: string[];
      }> = [];
      const eqCalls: Array<{ table: string; column: string; value: unknown }> =
        [];
      const db = {
        from(table: string) {
          const builder = {
            select: () => builder,
            eq: (column: string, value: unknown) => {
              eqCalls.push({ table, column, value });
              return builder;
            },
            in: (column: string, values: string[]) => {
              inCalls.push({ table, column, values });
              const wanted = new Set(values);
              if (table === 'roadmaps') {
                return Promise.resolve({
                  data: fixtures.roadmaps.filter((row) => wanted.has(row.id)),
                  error: null,
                });
              }
              if (fixtures.projectAccess === 'error') {
                return Promise.resolve({
                  data: null,
                  error: { message: 'probe failed' },
                });
              }
              return Promise.resolve({
                data: (fixtures.projectAccess ?? []).filter((row) =>
                  wanted.has(row.project_id),
                ),
                error: null,
              });
            },
          };
          return builder;
        },
      };
      const service = new RoadmapAuthorizationService(db as never, {} as never);
      return { service, inCalls, eqCalls };
    }

    it('admits a personal roadmap only for its owner', async () => {
      const { service, inCalls } = buildBulkDb({
        roadmaps: [
          { id: 'rm-mine', name: 'Mine', project_id: null, owner_id: userId },
          {
            id: 'rm-theirs',
            name: 'Theirs',
            project_id: null,
            owner_id: 'another-user',
          },
        ],
      });

      const result = await service.filterViewableRoadmapIds(userId, [
        'rm-mine',
        'rm-theirs',
      ]);

      expect([...result.entries()]).toEqual([
        ['rm-mine', { projectId: null, ownerId: userId, name: 'Mine' }],
      ]);
      // Nothing to probe: personal roadmaps have no project.
      expect(inCalls.filter((c) => c.table === 'project_access')).toHaveLength(
        0,
      );
    });

    it('admits a project roadmap through a project_access row', async () => {
      const { service, inCalls, eqCalls } = buildBulkDb({
        roadmaps: [
          {
            id: 'rm-shared',
            name: 'Shared',
            project_id: projectId,
            owner_id: 'another-user',
          },
          {
            id: 'rm-private',
            name: 'Private',
            project_id: 'proj-2',
            owner_id: 'another-user',
          },
        ],
        projectAccess: [{ project_id: projectId }],
      });

      const result = await service.filterViewableRoadmapIds(userId, [
        'rm-shared',
        'rm-private',
      ]);

      expect([...result.keys()]).toEqual(['rm-shared']);
      expect(result.get('rm-shared')).toEqual({
        projectId,
        ownerId: 'another-user',
        name: 'Shared',
      });
      // One meta read + one probe, and the probe is scoped to the caller.
      expect(inCalls.map((c) => [c.table, c.column])).toEqual([
        ['roadmaps', 'id'],
        ['project_access', 'project_id'],
      ]);
      expect(eqCalls).toEqual([
        { table: 'project_access', column: 'user_id', value: userId },
      ]);
    });

    it('fails closed to owner-only matches when the probe errors', async () => {
      const { service } = buildBulkDb({
        roadmaps: [
          {
            id: 'rm-mine',
            name: 'Mine',
            project_id: projectId,
            owner_id: userId,
          },
          {
            id: 'rm-shared',
            name: 'Shared',
            project_id: projectId,
            owner_id: 'another-user',
          },
        ],
        projectAccess: 'error',
      });

      const result = await service.filterViewableRoadmapIds(userId, [
        'rm-mine',
        'rm-shared',
      ]);

      expect([...result.keys()]).toEqual(['rm-mine']);
    });

    it('chunks both .in() filters at 50 ids', async () => {
      const ids = Array.from({ length: 120 }, (_, i) => `rm-${i}`);
      const { service, inCalls } = buildBulkDb({
        roadmaps: ids.map((id, i) => ({
          id,
          name: id,
          project_id: `proj-${i}`,
          owner_id: 'another-user',
        })),
        projectAccess: ids.map((_, i) => ({ project_id: `proj-${i}` })),
      });

      const result = await service.filterViewableRoadmapIds(userId, ids);

      expect(result.size).toBe(120);
      const sizes = (table: string) =>
        inCalls.filter((c) => c.table === table).map((c) => c.values.length);
      expect(sizes('roadmaps')).toEqual([50, 50, 20]);
      expect(sizes('project_access')).toEqual([50, 50, 20]);
    });

    it('dedupes the input and skips the database for an empty set', async () => {
      const { service, inCalls } = buildBulkDb({
        roadmaps: [
          { id: 'rm-mine', name: 'Mine', project_id: null, owner_id: userId },
        ],
      });

      await expect(
        service.filterViewableRoadmapIds(userId, []),
      ).resolves.toEqual(new Map());
      expect(inCalls).toHaveLength(0);

      const result = await service.filterViewableRoadmapIds(userId, [
        'rm-mine',
        'rm-mine',
        'rm-mine',
      ]);

      expect(result.size).toBe(1);
      expect(inCalls).toEqual([
        { table: 'roadmaps', column: 'id', values: ['rm-mine'] },
      ]);
    });
  });
});
