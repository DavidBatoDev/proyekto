import { ProjectAccessSyncService } from './access-sync.service';

/**
 * Single-row tests. project_access has at most one row per
 * (project, user) — the service is a thin pass-through.
 */
function thenable(response: { data?: any; error?: any }) {
  const stub: any = {};
  const methods = ['select', 'update', 'eq', 'maybeSingle'];
  for (const m of methods) stub[m] = jest.fn(() => stub);
  stub.then = (onFulfilled: (v: any) => any) =>
    Promise.resolve(response).then(onFulfilled);
  return stub;
}

function buildService(...queued: ReturnType<typeof thenable>[]) {
  let i = 0;
  const supabase: any = {
    from: () => {
      const next = queued[i++];
      if (!next) throw new Error(`Unexpected supabase.from() call #${i}`);
      return next;
    },
  };
  return { service: new ProjectAccessSyncService(supabase), queued };
}

describe('ProjectAccessSyncService', () => {
  describe('syncUser', () => {
    it('returns null when the user has no row', async () => {
      const { service } = buildService(
        thenable({ data: null, error: null }),
      );
      expect(await service.syncUser('p1', 'u1')).toBeNull();
    });

    it("returns the row's role", async () => {
      const { service } = buildService(
        thenable({ data: { role: 'editor' }, error: null }),
      );
      expect(await service.syncUser('p1', 'u1')).toBe('editor');
    });
  });

  describe('setUserRole', () => {
    it('updates the row and returns the new role', async () => {
      const { service, queued } = buildService(
        thenable({ data: { role: 'admin' }, error: null }),
      );
      expect(await service.setUserRole('p1', 'u1', 'admin')).toBe('admin');
      expect(queued[0].update).toHaveBeenCalledWith({ role: 'admin' });
    });

    it('returns null when no row exists to update', async () => {
      const { service } = buildService(
        thenable({ data: null, error: null }),
      );
      expect(await service.setUserRole('p1', 'ghost', 'admin')).toBeNull();
    });
  });

  describe('setUserCapabilities', () => {
    it('writes the capabilities map to the single row', async () => {
      const { service, queued } = buildService(
        thenable({ error: null }),
      );
      await service.setUserCapabilities('p1', 'u1', {
        'roadmap.edit': true,
      });
      expect(queued[0].update).toHaveBeenCalledWith({
        capabilities: { 'roadmap.edit': true },
      });
    });
  });

  describe('setUserCapabilitiesByMemberId', () => {
    it('resolves the user_id then writes capabilities', async () => {
      const { service } = buildService(
        // lookup user_id from member id
        thenable({ data: { user_id: 'u1' }, error: null }),
        // capabilities update
        thenable({ error: null }),
      );
      const out = await service.setUserCapabilitiesByMemberId(
        'p1',
        'm1',
        { 'roadmap.edit': true },
      );
      expect(out).toBe('u1');
    });

    it('returns null when the member id is unknown', async () => {
      const { service } = buildService(
        thenable({ data: null, error: null }),
      );
      const out = await service.setUserCapabilitiesByMemberId(
        'p1',
        'unknown',
        {},
      );
      expect(out).toBeNull();
    });
  });
});
