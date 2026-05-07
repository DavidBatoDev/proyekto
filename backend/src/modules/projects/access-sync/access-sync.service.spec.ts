import { ProjectAccessSyncService } from './access-sync.service';

/**
 * Tests for the yoke rule. project_access is the single source of
 * truth for role + capabilities; there are no team-side natural
 * sources to look up. Service code paths exercised here:
 *   - loadRows           → from('project_access').select().eq().eq()
 *   - writeAllRows       → from('project_access').update().in()
 *   - updateRowsRole     → from('project_access').update().in()
 *   - setUserCapabilitiesByMemberId
 *                        → from('project_access').select('user_id').eq().eq().maybeSingle()
 */

interface MockTableConfig {
  selectRows?: Array<unknown> | { error?: { message: string } };
  selectRow?: unknown | null;
  updateRecord?: jest.Mock;
}

function makeSupabase(
  tables: Record<string, MockTableConfig | (() => MockTableConfig)>,
) {
  const calls: Array<{
    table: string;
    op: 'select' | 'update' | 'insert' | 'delete';
    payload?: unknown;
  }> = [];

  return {
    calls,
    client: {
      from(table: string) {
        const cfg =
          typeof tables[table] === 'function'
            ? (tables[table] as () => MockTableConfig)()
            : (tables[table] as MockTableConfig | undefined);
        if (!cfg) throw new Error(`Unexpected table access: ${table}`);

        const builder: any = {};
        const passthrough = ['select', 'eq', 'in'];
        for (const m of passthrough) {
          builder[m] = jest.fn(() => builder);
        }
        builder.update = jest.fn((payload: unknown) => {
          calls.push({ table, op: 'update', payload });
          if (cfg.updateRecord) cfg.updateRecord(payload);
          return builder;
        });
        const inImpl = builder.in;
        builder.in = jest.fn((...args: unknown[]) => {
          inImpl(...args);
          return new Proxy(builder, {
            get(target, prop) {
              if (prop === 'then') {
                return (resolve: (v: unknown) => void) =>
                  resolve({ data: cfg.selectRows ?? [], error: null });
              }
              return (target as any)[prop];
            },
          });
        });
        builder.maybeSingle = jest.fn(async () => {
          calls.push({ table, op: 'select' });
          return { data: cfg.selectRow ?? null, error: null };
        });
        builder.then = (resolve: (v: unknown) => void) => {
          calls.push({ table, op: 'select' });
          if (Array.isArray(cfg.selectRows)) {
            return resolve({ data: cfg.selectRows, error: null });
          }
          return resolve({
            data: [],
            error: (cfg.selectRows as { error?: { message: string } })?.error,
          });
        };
        return builder;
      },
    },
  };
}

function buildService(supabase: any) {
  return new ProjectAccessSyncService(supabase);
}

describe('ProjectAccessSyncService', () => {
  describe('syncUser', () => {
    it('returns null when the user has no rows', async () => {
      const sb = makeSupabase({
        project_access: { selectRows: [] },
      });
      const svc = buildService(sb.client);
      const result = await svc.syncUser('p1', 'u1');
      expect(result).toBeNull();
    });

    it('keeps a single row in sync (idempotent no-op)', async () => {
      const update = jest.fn();
      const sb = makeSupabase({
        project_access: {
          selectRows: [
            {
              id: 'r1',
              project_id: 'p1',
              user_id: 'u1',
              role: 'editor',
              origin: 'invited',
              capabilities: {},
            },
          ],
          updateRecord: update,
        },
      });
      const svc = buildService(sb.client);
      const role = await svc.syncUser('p1', 'u1');
      expect(role).toBe('editor');
      expect(update).not.toHaveBeenCalled();
    });

    it('promotes the team-derived row to match a higher direct role', async () => {
      const update = jest.fn();
      const sb = makeSupabase({
        project_access: {
          selectRows: [
            {
              id: 'r-direct',
              project_id: 'p1',
              user_id: 'u1',
              role: 'owner',
              origin: 'consultant',
              capabilities: {},
            },
            {
              id: 'r-team',
              project_id: 'p1',
              user_id: 'u1',
              role: 'editor',
              origin: 'team:t-eng',
              capabilities: {},
            },
          ],
          updateRecord: update,
        },
      });
      const svc = buildService(sb.client);
      const role = await svc.syncUser('p1', 'u1');
      // max(owner, editor) → owner.
      expect(role).toBe('owner');
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'owner' }),
      );
    });

    it('keeps a manually-demoted role across siblings (max-of-rows)', async () => {
      // Permissions page set both rows to viewer. No external natural
      // source exists to bump them back up — they stay viewer.
      const update = jest.fn();
      const sb = makeSupabase({
        project_access: {
          selectRows: [
            {
              id: 'r-direct',
              project_id: 'p1',
              user_id: 'u1',
              role: 'viewer',
              origin: 'invited',
              capabilities: {},
            },
            {
              id: 'r-team',
              project_id: 'p1',
              user_id: 'u1',
              role: 'viewer',
              origin: 'team:t-eng',
              capabilities: {},
            },
          ],
          updateRecord: update,
        },
      });
      const svc = buildService(sb.client);
      const role = await svc.syncUser('p1', 'u1');
      expect(role).toBe('viewer');
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('setUserCapabilities', () => {
    it('writes the same capabilities map to every row of the user', async () => {
      const update = jest.fn();
      const sb = makeSupabase({
        project_access: {
          selectRows: [
            {
              id: 'r-direct',
              project_id: 'p1',
              user_id: 'u1',
              role: 'admin',
              origin: 'consultant',
              capabilities: {},
            },
            {
              id: 'r-team',
              project_id: 'p1',
              user_id: 'u1',
              role: 'admin',
              origin: 'team:t-eng',
              capabilities: {},
            },
          ],
          updateRecord: update,
        },
      });
      const svc = buildService(sb.client);
      await svc.setUserCapabilities('p1', 'u1', { 'roadmap.edit': true });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilities: { 'roadmap.edit': true },
        }),
      );
    });

    it('is a no-op when there are no rows for the user', async () => {
      const update = jest.fn();
      const sb = makeSupabase({
        project_access: {
          selectRows: [],
          updateRecord: update,
        },
      });
      const svc = buildService(sb.client);
      await svc.setUserCapabilities('p1', 'ghost', { 'roadmap.edit': true });
      expect(update).not.toHaveBeenCalled();
    });
  });
});
