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
  return { service: new ProjectAuthorizationService(supabase), queued };
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
      const { service } = buildService(
        thenable({ data: [], error: null }),
      );
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
      const { service } = buildService(
        thenable({ data: [], error: null }),
      );
      await expect(
        service.assertRole('u1', 'p1', 'viewer'),
      ).rejects.toThrow(/not a member of this project/);
    });
  });

  describe('grant', () => {
    it('inserts a new row when the user has no prior grant', async () => {
      const newRow = {
        id: 's1',
        project_id: 'p1',
        user_id: 'u1',
        role: 'admin',
        origin: 'client',
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
        origin: 'client',
        grantedBy: null,
      });
      expect(share.role).toBe('admin');
      expect(queued[1].insert).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'p1',
          user_id: 'u1',
          role: 'admin',
          origin: 'client',
          has_direct_grant: true,
        }),
      );
    });

    it('does not demote: max(existing, new) wins on conflict', async () => {
      const existing = {
        id: 's1',
        role: 'owner',
        origin: 'consultant',
        capabilities: { 'roadmap.edit': true },
      };
      const updated = {
        id: 's1',
        project_id: 'p1',
        user_id: 'u1',
        role: 'owner',
        origin: 'consultant',
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
    });
  });

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

    it('is a no-op when the share row does not exist', async () => {
      const { service } = buildService(
        thenable({ data: null, error: null }),
      );
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
});
