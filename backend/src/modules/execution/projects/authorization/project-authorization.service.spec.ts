import { ForbiddenException } from '@nestjs/common';
import {
  ProjectAuthorizationService,
  PROJECT_ROLES,
} from './project-authorization.service';

/**
 * Builds a thenable Supabase query stub that returns `response` when awaited
 * after any chain of `.select`, `.insert`, `.upsert`, `.update`, `.delete`,
 * `.eq`, `.maybeSingle`, `.single`. Each method returns the same stub, and
 * the stub resolves to `response` when used with `await`.
 */
function thenable(response: { data?: any; error?: any; count?: number }) {
  const stub: any = {};
  const methods = [
    'select',
    'insert',
    'upsert',
    'update',
    'delete',
    'eq',
    'order',
    'limit',
    'maybeSingle',
    'single',
  ];
  for (const m of methods) {
    stub[m] = jest.fn(() => stub);
  }
  stub.then = (onFulfilled: (v: any) => any) =>
    Promise.resolve(response).then(onFulfilled);
  return stub;
}

/**
 * Build a service whose `from(table)` returns the next queued thenable in
 * order. Use to script multi-call code paths like `revoke` (lookup → count
 * → delete).
 */
function buildService(...queued: ReturnType<typeof thenable>[]) {
  let i = 0;
  const supabase: any = {
    from: () => {
      const next = queued[i++];
      if (!next) {
        throw new Error(`Unexpected supabase.from() call #${i}`);
      }
      return next;
    },
  };
  const audit: any = { log: jest.fn(), list: jest.fn() };
  return {
    service: new ProjectAuthorizationService(supabase, audit),
    queued,
    audit,
  };
}

describe('ProjectAuthorizationService', () => {
  describe('roleSatisfies (role hierarchy)', () => {
    const { service } = buildService();
    it('an owner satisfies every required role', () => {
      for (const required of PROJECT_ROLES) {
        expect(service.roleSatisfies('owner', required)).toBe(true);
      }
    });
    it('a viewer only satisfies viewer', () => {
      expect(service.roleSatisfies('viewer', 'viewer')).toBe(true);
      expect(service.roleSatisfies('viewer', 'commenter')).toBe(false);
      expect(service.roleSatisfies('viewer', 'editor')).toBe(false);
      expect(service.roleSatisfies('viewer', 'admin')).toBe(false);
      expect(service.roleSatisfies('viewer', 'owner')).toBe(false);
    });
    it('owner > admin > editor > commenter > viewer', () => {
      expect(service.roleSatisfies('owner', 'admin')).toBe(true);
      expect(service.roleSatisfies('admin', 'editor')).toBe(true);
      expect(service.roleSatisfies('editor', 'commenter')).toBe(true);
      expect(service.roleSatisfies('commenter', 'viewer')).toBe(true);
      expect(service.roleSatisfies('admin', 'owner')).toBe(false);
      expect(service.roleSatisfies('editor', 'admin')).toBe(false);
    });
  });

  describe('getUserProjectRole', () => {
    it('returns the role from project_shares', async () => {
      const { service } = buildService(
        thenable({ data: [{ role: 'editor' }], error: null }),
      );
      const role = await service.getUserProjectRole('u1', 'p1');
      expect(role).toBe('editor');
    });

    it('returns null when no grant exists', async () => {
      const { service } = buildService(thenable({ data: [], error: null }));
      const role = await service.getUserProjectRole('u1', 'p1');
      expect(role).toBeNull();
    });

    it('throws on supabase error', async () => {
      const { service } = buildService(
        thenable({ data: null, error: { message: 'db down' } }),
      );
      await expect(service.getUserProjectRole('u1', 'p1')).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('assertRole', () => {
    it('passes when the user has exactly the required role', async () => {
      const { service } = buildService(
        thenable({ data: [{ role: 'editor' }], error: null }),
      );
      await expect(service.assertRole('u1', 'p1', 'editor')).resolves.toBe(
        'editor',
      );
    });

    it('passes when the user has a stronger role', async () => {
      const { service } = buildService(
        thenable({ data: [{ role: 'owner' }], error: null }),
      );
      await expect(service.assertRole('u1', 'p1', 'editor')).resolves.toBe(
        'owner',
      );
    });

    it('throws ForbiddenException when the role is too weak', async () => {
      const { service } = buildService(
        thenable({ data: [{ role: 'viewer' }], error: null }),
      );
      await expect(service.assertRole('u1', 'p1', 'editor')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when there is no grant at all', async () => {
      const { service } = buildService(thenable({ data: [], error: null }));
      await expect(service.assertRole('u1', 'p1', 'viewer')).rejects.toThrow(
        /not a member of this project/,
      );
    });
  });

  describe('grant', () => {
    it('inserts a new row when the user has no prior grant', async () => {
      const newRow = {
        id: 's1',
        project_id: 'p1',
        user_id: 'u1',
        role: 'admin',
        origin: 'direct',
        capabilities: {},
        granted_by: null,
        granted_at: '2026-05-03T00:00:00Z',
        has_direct_grant: true,
      };
      const { service, queued } = buildService(
        // lookup: no existing row
        thenable({ data: null, error: null }),
        // insert returns the new row
        thenable({ data: newRow, error: null }),
      );
      const share = await service.grant({
        projectId: 'p1',
        userId: 'u1',
        role: 'admin',
        origin: 'direct',
        grantedBy: null,
      });
      expect(share.role).toBe('admin');
      expect(queued[1].insert).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'p1',
          user_id: 'u1',
          role: 'admin',
          origin: 'direct',
          has_direct_grant: true,
        }),
      );
    });

    it('does not demote: max(existing, new) wins on conflict', async () => {
      const existing = {
        id: 's1',
        role: 'owner',
        origin: 'direct',
        capabilities: { 'roadmap.edit': true },
      };
      const updated = {
        id: 's1',
        project_id: 'p1',
        user_id: 'u1',
        role: 'owner',
        origin: 'direct',
        capabilities: { 'roadmap.edit': true },
        granted_by: null,
        granted_at: '2026-05-03T00:00:00Z',
        has_direct_grant: true,
      };
      const { service, queued } = buildService(
        thenable({ data: existing, error: null }),
        thenable({ data: updated, error: null }),
      );
      const share = await service.grant({
        projectId: 'p1',
        userId: 'u1',
        role: 'editor',
        origin: 'invited',
        grantedBy: null,
      });
      expect(share.role).toBe('owner');
      expect(queued[1].update).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'owner',
          has_direct_grant: true,
        }),
      );
      expect(queued[1].update).toHaveBeenCalledWith(
        expect.not.objectContaining({ origin: expect.anything() }),
      );
    });

    // This used to be "promotes an existing row to consultant origin": a
    // re-grant carrying origin 'consultant' overwrote whatever provenance the
    // row already had, which is what made that designation stick. Origin is
    // provenance — how somebody first joined does not change because they were
    // re-granted later — so the re-grant now leaves it alone whatever it says.
    it('never rewrites the stored origin on a re-grant, whatever comes in', async () => {
      const existing = {
        id: 's1',
        role: 'editor',
        origin: 'invited',
        capabilities: {},
      };
      const updated = {
        ...existing,
        project_id: 'p1',
        user_id: 'u1',
        role: 'owner',
        has_direct_grant: true,
      };
      const { service, queued } = buildService(
        thenable({ data: existing, error: null }),
        thenable({ data: updated, error: null }),
      );

      await service.grant({
        projectId: 'p1',
        userId: 'u1',
        role: 'owner',
        origin: 'direct',
        grantedBy: 'u1',
      });

      expect(queued[1].update).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'owner', has_direct_grant: true }),
      );
      expect(queued[1].update).toHaveBeenCalledWith(
        expect.not.objectContaining({ origin: expect.anything() }),
      );
    });
  });

  /**
   * The last-owner check is the only protection now.
   *
   * There used to be a second one refusing to remove "the consultant", found by
   * reading `project_access.origin`, with an `allowConsultantRemoval` escape hatch
   * for the reassignment flow. Both are gone: an owner is an owner, and the rung
   * protects them all equally. Note each case is one `from()` call shorter than it
   * was, because the consultant lookup no longer happens.
   */
  describe('revoke (last-owner protection)', () => {
    it('removes a non-owner share without checking owner count', async () => {
      const { service } = buildService(
        thenable({ data: { role: 'editor' }, error: null }),
        thenable({ error: null }),
        thenable({ error: null }),
      );
      await expect(service.revoke('p1', 'u1')).resolves.toBeUndefined();
    });

    it('refuses to remove the last owner', async () => {
      const { service } = buildService(
        thenable({ data: { role: 'owner' }, error: null }),
        thenable({ count: 1, error: null }),
      );
      await expect(service.revoke('p1', 'u1')).rejects.toThrow(/last owner/);
    });

    it('removes an owner when other owners exist', async () => {
      const { service } = buildService(
        thenable({ data: { role: 'owner' }, error: null }),
        thenable({ count: 2, error: null }),
        thenable({ error: null }),
        thenable({ error: null }),
      );
      await expect(service.revoke('p1', 'u1')).resolves.toBeUndefined();
    });

    // The guarantee that replaced the persona guard: whoever the owner is, the
    // only question asked is how many owners remain.
    it('never looks up who the consultant is', async () => {
      const { service, queued } = buildService(
        thenable({ data: { role: 'owner' }, error: null }),
        thenable({ count: 2, error: null }),
        thenable({ error: null }),
        thenable({ error: null }),
      );

      await service.revoke('p1', 'u1');

      for (const query of queued) {
        expect(query.eq).not.toHaveBeenCalledWith('origin', 'consultant');
      }
    });

    it('is a no-op when the share row does not exist', async () => {
      const { service } = buildService(thenable({ data: null, error: null }));
      await expect(service.revoke('p1', 'u1')).resolves.toBeUndefined();
    });
  });

  describe('assertActionOutranks (peer-rank guard)', () => {
    it('throws when caller targets self', async () => {
      const { service } = buildService();
      await expect(
        service.assertActionOutranks(
          'u1',
          'u1',
          'p1',
          'members.edit_permissions',
        ),
      ).rejects.toThrow(/cannot target yourself/i);
    });

    it('allows when caller is project owner', async () => {
      const { service } = buildService(
        // getUserProjectRole(caller) → owner
        thenable({ data: [{ role: 'owner' }], error: null }),
      );
      await expect(
        service.assertActionOutranks(
          'caller',
          'target',
          'p1',
          'members.edit_permissions',
        ),
      ).resolves.toBeUndefined();
    });

    it('allows when target lacks the gating capability', async () => {
      const { service } = buildService(
        // getUserProjectRole(caller) → admin (non-owner)
        thenable({ data: [{ role: 'admin' }], error: null }),
        // resolvePermissions(target) → viewer with no overrides
        thenable({
          data: [{ role: 'viewer', origin: null, capabilities: {} }],
          error: null,
        }),
      );
      await expect(
        service.assertActionOutranks(
          'caller',
          'target',
          'p1',
          'members.edit_permissions',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws when target also satisfies the gating capability', async () => {
      const { service } = buildService(
        // getUserProjectRole(caller) → admin
        thenable({ data: [{ role: 'admin' }], error: null }),
        // resolvePermissions(target) → admin (admins have edit_permissions)
        thenable({
          data: [{ role: 'admin', origin: null, capabilities: {} }],
          error: null,
        }),
      );
      await expect(
        service.assertActionOutranks(
          'caller',
          'target',
          'p1',
          'members.edit_permissions',
        ),
      ).rejects.toThrow(/equal authority/i);
    });
  });

  describe('listUsersWithPermission', () => {
    const rows = (
      ...entries: Array<{
        user_id: string | null;
        role: string;
        origin?: string | null;
        capabilities?: Record<string, unknown> | null;
      }>
    ) =>
      thenable({
        data: entries.map((e) => ({
          user_id: e.user_id,
          role: e.role,
          origin: e.origin ?? null,
          capabilities: e.capabilities ?? {},
        })),
        error: null,
      });

    it('returns only the users who hold the permission', async () => {
      const { service } = buildService(
        rows(
          { user_id: 'admin-1', role: 'admin' },
          { user_id: 'viewer-1', role: 'viewer' },
        ),
      );

      const holders = await service.listUsersWithPermission(
        'p1',
        'change_requests.decide',
      );

      expect(holders).toEqual(['admin-1']);
    });

    // A user with several rows holds a permission if ANY row grants it. Testing
    // rows individually would miss whoever gets it only from their stronger row —
    // a weak team-derived grant alongside a direct admin grant is the common shape.
    it('unions a users rows rather than judging each one alone', async () => {
      const { service } = buildService(
        rows(
          { user_id: 'member-1', role: 'viewer', origin: 'team:abc' },
          { user_id: 'member-1', role: 'admin', origin: 'invited' },
        ),
      );

      const holders = await service.listUsersWithPermission(
        'p1',
        'change_requests.decide',
      );

      expect(holders).toEqual(['member-1']);
    });

    // The same union, but where the grant comes from a per-member capability
    // rather than the rung — the mechanism that replaced the origin deltas.
    it('unions a capability grant on a weaker row', async () => {
      const { service } = buildService(
        rows(
          { user_id: 'member-1', role: 'viewer', origin: 'team:abc' },
          {
            user_id: 'member-1',
            role: 'viewer',
            origin: 'invited',
            capabilities: { 'change_requests.decide': true },
          },
        ),
      );

      await expect(
        service.listUsersWithPermission('p1', 'change_requests.decide'),
      ).resolves.toEqual(['member-1']);
    });

    it('reports each holder once, however many rows they have', async () => {
      const { service } = buildService(
        rows(
          { user_id: 'admin-1', role: 'admin' },
          { user_id: 'admin-1', role: 'editor' },
          { user_id: 'owner-1', role: 'owner' },
        ),
      );

      const holders = await service.listUsersWithPermission(
        'p1',
        'change_requests.decide',
      );

      expect(holders.sort()).toEqual(['admin-1', 'owner-1']);
    });

    it('ignores rows with no user_id', async () => {
      const { service } = buildService(
        rows(
          { user_id: null, role: 'owner' },
          { user_id: 'admin-1', role: 'admin' },
        ),
      );

      await expect(
        service.listUsersWithPermission('p1', 'change_requests.decide'),
      ).resolves.toEqual(['admin-1']);
    });

    it('returns empty for a project with no access rows', async () => {
      const { service } = buildService(thenable({ data: [], error: null }));

      await expect(
        service.listUsersWithPermission('p1', 'change_requests.decide'),
      ).resolves.toEqual([]);
    });

    it('throws when the query fails, rather than reporting nobody', async () => {
      const { service } = buildService(
        thenable({ data: null, error: { message: 'connection reset' } }),
      );

      await expect(
        service.listUsersWithPermission('p1', 'change_requests.decide'),
      ).rejects.toThrow('connection reset');
    });
  });
});
