import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';

/** `flag` mirrors the raw env value; undefined = unset = the default. */
function build(flag?: string) {
  const audit = { log: jest.fn() };
  const config = {
    get: (k: string) =>
      k === 'ROADMAP_ACTIVITY_LOG_ENABLED' ? flag : undefined,
  };
  const service = new RoadmapActivityService(audit as never, config as never);
  return { service, audit };
}

const ctx = {
  roadmapId: 'rm-1',
  projectId: 'proj-1',
  ownerId: 'user-1',
  permissions: null,
};

describe('RoadmapActivityService', () => {
  describe('gating', () => {
    // Recording is ON by default; the env var is only a kill switch.
    it.each([undefined, '', 'true', '1', 'anything'])(
      'records by default when the flag is %p',
      (flag) => {
        const { service, audit } = build(flag as string | undefined);
        service.record(ctx, 'user-1', {
          action: ACTIVITY_ACTIONS.EPIC_CREATED,
          entityType: 'epic',
        });
        expect(audit.log).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['false', 'FALSE', ' false ', '0'])(
      'the %p kill switch stops recording',
      (flag) => {
        const { service, audit } = build(flag);
        service.record(ctx, 'user-1', {
          action: ACTIVITY_ACTIONS.EPIC_CREATED,
          entityType: 'epic',
        });
        expect(audit.log).not.toHaveBeenCalled();
      },
    );

    it('records nothing for a personal roadmap (project_id is NOT NULL)', () => {
      const { service, audit } = build();
      service.record({ ...ctx, projectId: null }, 'user-1', {
        action: ACTIVITY_ACTIONS.EPIC_CREATED,
        entityType: 'epic',
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('tolerates a missing context instead of throwing', () => {
      const { service, audit } = build();
      expect(() =>
        service.record(undefined, 'user-1', {
          action: ACTIVITY_ACTIONS.EPIC_CREATED,
          entityType: 'epic',
        }),
      ).not.toThrow();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('recording', () => {
    it('carries roadmapId and the denormalized title', () => {
      const { service, audit } = build();
      service.record(ctx, 'user-9', {
        action: ACTIVITY_ACTIONS.TASK_DELETED,
        entityType: 'task',
        entityId: 't-1',
        title: 'Wire up Stripe webhook',
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          roadmapId: 'rm-1',
          actorId: 'user-9',
          action: 'task.deleted',
          entityType: 'task',
          entityId: 't-1',
          // The title must survive the entity's deletion — that is the point.
          metadata: expect.objectContaining({
            title: 'Wire up Stripe webhook',
          }),
        }),
      );
    });

    it('emits one row per event when given an array', () => {
      const { service, audit } = build();
      service.record(ctx, 'u', [
        { action: ACTIVITY_ACTIONS.EPIC_CREATED, entityType: 'epic' },
        { action: ACTIVITY_ACTIONS.FEATURE_CREATED, entityType: 'feature' },
      ]);
      expect(audit.log).toHaveBeenCalledTimes(2);
    });
  });

  describe('taskUpdateAction precedence', () => {
    const cases: Array<[string, any, string]> = [
      [
        'assignment wins over everything',
        {
          assigneesChanged: true,
          assigneesAdded: 1,
          statusChanged: true,
          featureChanged: true,
        },
        'task.assigned',
      ],
      [
        'removing the last assignee is unassigned',
        {
          assigneesChanged: true,
          assigneesAdded: 0,
          statusChanged: false,
          featureChanged: false,
        },
        'task.unassigned',
      ],
      [
        'status beats move',
        {
          assigneesChanged: false,
          assigneesAdded: 0,
          statusChanged: true,
          featureChanged: true,
        },
        'task.status_changed',
      ],
      [
        'move beats generic update',
        {
          assigneesChanged: false,
          assigneesAdded: 0,
          statusChanged: false,
          featureChanged: true,
        },
        'task.moved',
      ],
      [
        'plain edit falls through',
        {
          assigneesChanged: false,
          assigneesAdded: 0,
          statusChanged: false,
          featureChanged: false,
        },
        'task.updated',
      ],
    ];

    it.each(cases)('%s', (_name, params, expected) => {
      const { service } = build();
      expect(service.taskUpdateAction(params)).toBe(expected);
    });

    it('collapses a multi-field PATCH into exactly ONE row', () => {
      const { service, audit } = build();
      const action = service.taskUpdateAction({
        assigneesChanged: false,
        assigneesAdded: 0,
        statusChanged: true,
        featureChanged: false,
      });
      service.record(ctx, 'u', {
        action,
        entityType: 'task',
        entityId: 't-1',
        title: 'T',
        metadata: {
          changes: [
            { field: 'title', from: 'a', to: 'b' },
            { field: 'status', from: 'todo', to: 'done' },
          ],
        },
      });
      // One gesture, one feed line — with the full diff still attached.
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log.mock.calls[0][0].metadata.changes).toHaveLength(2);
    });
  });

  describe('diff', () => {
    it('reports only changed fields', () => {
      const { service } = build();
      const changes = service.diff(
        { title: 'a', status: 'todo', priority: 'low' },
        { title: 'b', status: 'todo', priority: 'high' },
        ['title', 'status', 'priority'],
      );
      expect(changes).toEqual([
        { field: 'title', from: 'a', to: 'b' },
        { field: 'priority', from: 'low', to: 'high' },
      ]);
    });

    it('redacts long free text to lengths, never content', () => {
      const { service } = build();
      const long = 'x'.repeat(400);
      const changes = service.diff(
        { description: 'short' },
        { description: long },
        ['description'],
      );
      expect(changes).toEqual([
        { field: 'description', from_len: 5, to_len: 400 },
      ]);
      // The confidential prose must not be anywhere in the row.
      expect(JSON.stringify(changes)).not.toContain('xxxx');
    });

    it('treats null and undefined as unchanged', () => {
      const { service } = build();
      expect(
        service.diff({ due_date: null }, { due_date: undefined }, ['due_date']),
      ).toEqual([]);
    });

    it('compares objects and arrays structurally', () => {
      const { service } = build();
      expect(service.diff({ tags: ['a'] }, { tags: ['a'] }, ['tags'])).toEqual(
        [],
      );
      expect(
        service.diff({ tags: ['a'] }, { tags: ['b'] }, ['tags']),
      ).toHaveLength(1);
    });
  });

  describe('reorderMetadata', () => {
    it('is ONE row with a count, not one row per item', () => {
      const { service, audit } = build();
      const moved = Array.from({ length: 50 }, (_, i) => ({
        id: `t-${i}`,
        title: `Task ${i}`,
        position: i,
      }));

      service.record(ctx, 'u', {
        action: ACTIVITY_ACTIONS.TASK_REORDERED,
        entityType: 'task',
        metadata: service.reorderMetadata({
          scopeType: 'feature',
          scopeId: 'f-1',
          itemCount: moved.length,
          moved,
        }),
      });

      expect(audit.log).toHaveBeenCalledTimes(1);
      const meta = audit.log.mock.calls[0][0].metadata;
      expect(meta.item_count).toBe(50);
      // Detail is sampled, not exhaustive.
      expect(meta.moved).toHaveLength(10);
    });
  });

  describe('metadata bounds', () => {
    it('truncates an oversized blob and flags it', () => {
      const { service, audit } = build();
      service.record(ctx, 'u', {
        action: ACTIVITY_ACTIONS.TASK_UPDATED,
        entityType: 'task',
        metadata: {
          changes: Array.from({ length: 500 }, (_, i) => ({
            field: `f${i}`,
            from: 'y'.repeat(50),
            to: 'z'.repeat(50),
          })),
        },
      });

      const meta = audit.log.mock.calls[0][0].metadata;
      expect(meta.truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(meta))).toBeLessThanOrEqual(4096);
    });

    it('leaves a normal blob untouched', () => {
      const { service, audit } = build();
      service.record(ctx, 'u', {
        action: ACTIVITY_ACTIONS.TASK_UPDATED,
        entityType: 'task',
        title: 'T',
        metadata: { changes: [{ field: 'title', from: 'a', to: 'b' }] },
      });
      expect(audit.log.mock.calls[0][0].metadata.truncated).toBeUndefined();
    });
  });

  describe('commentMetadata', () => {
    it('stores a plain-text excerpt, not raw HTML', () => {
      const { service } = build();
      const meta = service.commentMetadata(
        'c-1',
        '<p>Hello <strong>there</strong>&nbsp;team</p>',
      );
      expect(meta).toEqual({ comment_id: 'c-1', excerpt: 'Hello there team' });
    });

    it('caps the excerpt', () => {
      const { service } = build();
      const meta = service.commentMetadata('c-1', 'w '.repeat(400));
      expect((meta.excerpt as string).length).toBeLessThanOrEqual(140);
      expect(meta.excerpt).toMatch(/\.\.\.$/);
    });

    it('handles an empty body', () => {
      const { service } = build();
      expect(service.commentMetadata(null, null).excerpt).toBe('');
    });
  });
});
