import { AuditService } from './audit.service';
import {
  activityStorage,
  createActivityBuffer,
  setActivityOrigin,
} from '../../../common/activity/activity-context';

/** Captures what was handed to .insert(), and whether .select() was chained. */
function buildSupabase(result: { error?: { message: string } } = {}) {
  const inserts: any[][] = [];
  let selectCalled = false;
  const supabase = {
    from: () => ({
      insert: (rows: any[]) => {
        inserts.push(Array.isArray(rows) ? rows : [rows]);
        const thenable: any = {
          select: () => {
            selectCalled = true;
            return thenable;
          },
          single: () => Promise.resolve({ data: null, ...result }),
          then: (res: any) => res({ data: null, ...result }),
        };
        return thenable;
      },
    }),
  };
  return {
    supabase,
    inserts,
    selectCalled: () => selectCalled,
  };
}

describe('AuditService', () => {
  const base = {
    projectId: 'proj-1',
    actorId: 'user-1',
    entityType: 'task',
    entityId: '11111111-1111-1111-1111-111111111111',
  };

  describe('request origin', () => {
    // Connector-driven writes are marked at the request level rather than by
    // emitting a second `mcp.*` row beside the service's own — see
    // ActivityOrigin. These assertions are what keep that contract honest.
    function logOne(entry: Record<string, unknown>, origin?: boolean) {
      const { supabase, inserts } = buildSupabase();
      const service = new AuditService(supabase as never);
      const buffer = createActivityBuffer();
      activityStorage.run(buffer, () => {
        if (origin) {
          setActivityOrigin({ via: 'mcp', scopes: ['delivery:write'] });
        }
        service.log({ ...base, action: 'risk.created', ...entry });
      });
      return { buffer, service, inserts };
    }

    it('merges the origin into metadata when one is set', () => {
      const { buffer } = logOne({ metadata: { kind: 'risk' } }, true);
      expect(buffer.entries[0].metadata).toEqual({
        origin: { via: 'mcp', scopes: ['delivery:write'] },
        kind: 'risk',
      });
    });

    it('leaves metadata untouched when no origin is set', () => {
      const { buffer } = logOne({ metadata: { kind: 'risk' } });
      expect(buffer.entries[0].metadata).toEqual({ kind: 'risk' });
    });

    it('lets a caller-set key win over the origin', () => {
      // Spread order matters: the service knows its own domain better than the
      // transport does.
      const { buffer } = logOne({ metadata: { origin: 'import' } }, true);
      expect(buffer.entries[0].metadata).toEqual({ origin: 'import' });
    });

    it('adds an origin even when the entry carried no metadata at all', () => {
      const { buffer } = logOne({}, true);
      expect(buffer.entries[0].metadata).toEqual({
        origin: { via: 'mcp', scopes: ['delivery:write'] },
      });
    });

    it('carries no row data — only who was driving', () => {
      // An internal risk's title here would re-leak exactly what
      // risks.view_internal protects, because is_sensitive is per-action.
      const { buffer } = logOne({ metadata: { kind: 'risk' } }, true);
      const origin = (buffer.entries[0].metadata as { origin: object }).origin;
      expect(Object.keys(origin).sort()).toEqual(['scopes', 'via']);
    });
  });

  describe('flush', () => {
    it('writes the whole buffer as ONE insert, with no RETURNING read', async () => {
      const { supabase, inserts, selectCalled } = buildSupabase();
      const outbox = { enqueue: jest.fn() };
      const service = new AuditService(
        supabase as never,
        undefined,
        outbox as never,
      );
      const buffer = createActivityBuffer();

      activityStorage.run(buffer, () => {
        for (let i = 0; i < 30; i++) {
          service.log({ ...base, action: 'task.reordered' });
        }
      });
      expect(buffer.entries).toHaveLength(30);

      await service.flush(buffer);

      // 30 events -> 1 round-trip. This is the whole point of the batch.
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toHaveLength(30);
      // No .select(): ids are minted client-side so RETURNING is unnecessary.
      expect(selectCalled()).toBe(false);
      // Buffer is drained so a second flush is a no-op.
      expect(buffer.entries).toHaveLength(0);
    });

    it('stamps created_at at buffer time, not insert time', async () => {
      const { supabase, inserts } = buildSupabase();
      const service = new AuditService(supabase as never);
      const buffer = createActivityBuffer();

      const before = Date.now();
      activityStorage.run(buffer, () => {
        service.log({ ...base, action: 'task.created' });
      });
      // Simulate a slow flush: the row lands well after the event occurred.
      await new Promise((r) => setTimeout(r, 30));
      await service.flush(buffer);
      const after = Date.now();

      const stamped = Date.parse(inserts[0][0].created_at);
      expect(stamped).toBeGreaterThanOrEqual(before);
      // The timestamp reflects when log() was called, not when insert ran.
      expect(stamped).toBeLessThan(after - 20);
    });

    it('mints a distinct client-side id per row', async () => {
      const { supabase, inserts } = buildSupabase();
      const service = new AuditService(supabase as never);
      const buffer = createActivityBuffer();

      activityStorage.run(buffer, () => {
        service.log({ ...base, action: 'task.created' });
        service.log({ ...base, action: 'task.updated' });
      });
      await service.flush(buffer);

      const ids = inserts[0].map((r) => r.id);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(2);
    });

    it('derives is_sensitive from the action and carries roadmap_id', async () => {
      const { supabase, inserts } = buildSupabase();
      const service = new AuditService(supabase as never);
      const buffer = createActivityBuffer();

      activityStorage.run(buffer, () => {
        service.log({ ...base, action: 'task.updated', roadmapId: 'rm-1' });
        service.log({ ...base, action: 'access.granted' });
      });
      await service.flush(buffer);

      const [ordinary, sensitive] = inserts[0];
      expect(ordinary.is_sensitive).toBe(false);
      expect(ordinary.roadmap_id).toBe('rm-1');
      expect(sensitive.is_sensitive).toBe(true);
      expect(sensitive.roadmap_id).toBeNull();
    });

    it('enqueues knowledge work only for indexable actions', async () => {
      const { supabase } = buildSupabase();
      const outbox = { enqueue: jest.fn() };
      const service = new AuditService(
        supabase as never,
        undefined,
        outbox as never,
      );
      const buffer = createActivityBuffer();

      activityStorage.run(buffer, () => {
        service.log({ ...base, action: 'epic.created' }); // indexable
        service.log({ ...base, action: 'task.updated' }); // churn
        service.log({ ...base, action: 'task.reordered' }); // churn
        service.log({ ...base, action: 'task_comment.created' }); // already indexed elsewhere
      });
      await service.flush(buffer);

      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
      expect(outbox.enqueue.mock.calls[0][0]).toMatchObject({
        sourceType: 'activity_log',
        projectId: 'proj-1',
      });
    });

    it('never throws when the insert fails', async () => {
      const { supabase } = buildSupabase({ error: { message: 'db down' } });
      const outbox = { enqueue: jest.fn() };
      const service = new AuditService(
        supabase as never,
        undefined,
        outbox as never,
      );
      const buffer = createActivityBuffer();

      activityStorage.run(buffer, () => {
        service.log({ ...base, action: 'epic.created' });
      });

      await expect(service.flush(buffer)).resolves.toBeUndefined();
      // A failed insert must not enqueue ingest work for rows that don't exist.
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('is bounded: a hanging insert cannot hold the response open', async () => {
      const hanging = {
        from: () => ({ insert: () => ({ then: () => {} }) }),
      };
      const config = { get: () => '30' }; // ACTIVITY_FLUSH_TIMEOUT_MS
      const service = new AuditService(hanging as never, config as never);
      const buffer = createActivityBuffer();

      activityStorage.run(buffer, () => {
        service.log({ ...base, action: 'epic.created' });
      });

      const started = Date.now();
      await service.flush(buffer);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('warns about overflow rather than truncating silently', async () => {
      const { supabase } = buildSupabase();
      const service = new AuditService(supabase as never);
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});
      const buffer = createActivityBuffer(2);

      activityStorage.run(buffer, () => {
        for (let i = 0; i < 5; i++) {
          service.log({ ...base, action: 'task.reordered' });
        }
      });
      await service.flush(buffer);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 3'));
    });

    it('does nothing on an empty buffer', async () => {
      const { supabase, inserts } = buildSupabase();
      const service = new AuditService(supabase as never);
      await service.flush(createActivityBuffer());
      expect(inserts).toHaveLength(0);
    });
  });

  describe('log outside a request', () => {
    it('falls back to a detached single insert', async () => {
      const { supabase, inserts } = buildSupabase();
      const service = new AuditService(supabase as never);

      // No activityStorage.run(...) — e.g. a cron route or module boot.
      service.log({ ...base, action: 'epic.created' });
      await new Promise((r) => setImmediate(r));

      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toHaveLength(1);
    });
  });
});
