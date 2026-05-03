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
        thenable({ data: { role: 'editor' }, error: null }),
      );
      const role = await service.getUserProjectRole('u1', 'p1');
      expect(role).toBe('editor');
    });

    it('returns null when no grant exists', async () => {
      const { service } = buildService(
        thenable({ data: null, error: null }),
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
        thenable({ data: { role: 'editor' }, error: null }),
      );
      await expect(service.assertRole('u1', 'p1', 'editor')).resolves.toBe(
        'editor',
      );
    });

    it('passes when the user has a stronger role', async () => {
      const { service } = buildService(
        thenable({ data: { role: 'owner' }, error: null }),
      );
      await expect(service.assertRole('u1', 'p1', 'editor')).resolves.toBe(
        'owner',
      );
    });

    it('throws ForbiddenException when the role is too weak', async () => {
      const { service } = buildService(
        thenable({ data: { role: 'viewer' }, error: null }),
      );
      await expect(service.assertRole('u1', 'p1', 'editor')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when there is no grant at all', async () => {
      const { service } = buildService(
        thenable({ data: null, error: null }),
      );
      await expect(
        service.assertRole('u1', 'p1', 'viewer'),
      ).rejects.toThrow(/No access to this project/);
    });
  });

  describe('grant', () => {
    it('upserts the share row and returns the new row', async () => {
      const newRow = {
        id: 's1',
        project_id: 'p1',
        user_id: 'u1',
        role: 'admin',
        origin: 'client',
        capabilities: {},
        granted_by: null,
        granted_at: '2026-05-03T00:00:00Z',
      };
      const { service, queued } = buildService(
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
      // upsert was called with the right payload + onConflict
      expect(queued[0].upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'p1',
          user_id: 'u1',
          role: 'admin',
          origin: 'client',
        }),
        { onConflict: 'project_id,user_id' },
      );
    });
  });

  describe('revoke (last-owner protection)', () => {
    it('removes a non-owner share without checking owner count', async () => {
      const { service } = buildService(
        // lookup: editor role
        thenable({ data: { role: 'editor' }, error: null }),
        // delete returns no error
        thenable({ error: null }),
      );
      await expect(service.revoke('p1', 'u1')).resolves.toBeUndefined();
    });

    it('refuses to remove the last owner', async () => {
      const { service } = buildService(
        // lookup: owner role
        thenable({ data: { role: 'owner' }, error: null }),
        // count owners → 1
        thenable({ count: 1, error: null }),
      );
      await expect(service.revoke('p1', 'u1')).rejects.toThrow(/last owner/);
    });

    it('removes an owner when other owners exist', async () => {
      const { service } = buildService(
        // lookup: owner role
        thenable({ data: { role: 'owner' }, error: null }),
        // count owners → 2
        thenable({ count: 2, error: null }),
        // delete returns no error
        thenable({ error: null }),
      );
      await expect(service.revoke('p1', 'u1')).resolves.toBeUndefined();
    });

    it('is a no-op when the share row does not exist', async () => {
      const { service, queued } = buildService(
        // lookup: nothing
        thenable({ data: null, error: null }),
      );
      await expect(service.revoke('p1', 'u1')).resolves.toBeUndefined();
      expect(queued[0].delete).not.toHaveBeenCalled();
    });
  });
});
