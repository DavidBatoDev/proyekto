import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

/**
 * The workspace is the organization and billing boundary, so the behaviours
 * pinned here are the ones whose failure modes are structural rather than
 * cosmetic: a workspace nobody owns, a project filed under someone else's
 * organization, and a guest being handed a seat.
 */

const OWNER = 'user-owner';
const ADMIN = 'user-admin';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const WORKSPACE = {
  id: 'ws-1',
  name: 'Acme',
  slug: 'acme',
  previous_slugs: [],
  description: null,
  avatar_url: null,
  created_by: OWNER,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

/**
 * Chain-shape-agnostic stub, the same rationale as the teams specs: every
 * builder method returns itself and only the terminals resolve, so adding a
 * filter to an unrelated query cannot break these tests.
 */
function buildSupabase(handlers: {
  onTable?: (table: string) => Record<string, unknown> | undefined;
  rpc?: jest.Mock;
  captured?: Record<string, unknown>;
}) {
  const chain = (terminal: any, table: string) => {
    const c: Record<string, unknown> = {};
    for (const method of [
      'select',
      'eq',
      'ilike',
      'order',
      'limit',
      'in',
      'not',
    ]) {
      c[method] = () => c;
    }
    c.insert = (payload: Record<string, unknown>) => {
      if (handlers.captured) {
        const bucket = (handlers.captured.inserts ??= {}) as Record<
          string,
          unknown[]
        >;
        (bucket[table] ??= []).push(payload);
      }
      return c;
    };
    c.update = (payload: Record<string, unknown>) => {
      if (handlers.captured) {
        const bucket = (handlers.captured.updates ??= {}) as Record<
          string,
          unknown[]
        >;
        (bucket[table] ??= []).push(payload);
      }
      return c;
    };
    c.delete = () => {
      if (handlers.captured) {
        const bucket = (handlers.captured.deletes ??= []) as string[];
        bucket.push(table);
      }
      return c;
    };
    c.maybeSingle = () =>
      Promise.resolve(terminal.maybeSingle ?? { data: null, error: null });
    c.single = () =>
      Promise.resolve(terminal.single ?? { data: null, error: null });
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(terminal.list ?? { data: [], error: null }).then(resolve);
    return c;
  };

  return {
    from: (table: string) => chain(handlers.onTable?.(table) ?? {}, table),
    rpc: handlers.rpc ?? jest.fn(),
  };
}

function buildService(supabase: unknown) {
  return new WorkspacesService(
    supabase as never,
    { createNotification: jest.fn() } as never,
    { send: jest.fn().mockResolvedValue({ sent: true }) } as never,
    { get: jest.fn() } as never,
  );
}

describe('WorkspacesService.createWorkspace', () => {
  /**
   * A workspace whose owner row failed to insert is unreachable — it would not
   * even appear in its creator's own list. The welcome deck calls this on a
   * retryable step, so without the compensating delete every retry strands
   * another one.
   */
  it('deletes the workspace when the owner membership insert fails', async () => {
    const captured: Record<string, unknown> = {};
    const supabase = buildSupabase({
      captured,
      onTable: (table) => {
        if (table === 'workspaces') {
          return { single: { data: WORKSPACE, error: null } };
        }
        if (table === 'workspace_members') {
          return { then: true };
        }
        return {};
      },
    });
    // workspace_members insert reports an error; everything else succeeds.
    const originalFrom = supabase.from;
    supabase.from = (table: string) => {
      const c = originalFrom(table) as any;
      if (table === 'workspace_members') {
        c.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ error: { message: 'roster insert failed' } }).then(
            resolve,
          );
      }
      return c;
    };

    const service = buildService(supabase);

    await expect(
      service.createWorkspace(OWNER, { name: 'Acme' }),
    ).rejects.toThrow('roster insert failed');
    expect(captured.deletes).toContain('workspaces');
  });

  it('creates the workspace, an owner membership, and a free subscription', async () => {
    const captured: Record<string, unknown> = {};
    const supabase = buildSupabase({
      captured,
      onTable: (table) =>
        table === 'workspaces'
          ? { single: { data: WORKSPACE, error: null } }
          : {},
    });
    const service = buildService(supabase);

    const created = await service.createWorkspace(OWNER, { name: 'Acme' });

    const inserts = captured.inserts as Record<string, any[]>;
    expect(inserts.workspaces[0]).toMatchObject({
      name: 'Acme',
      created_by: OWNER,
    });
    expect(inserts.workspace_members[0]).toMatchObject({
      workspace_id: 'ws-1',
      user_id: OWNER,
      role: 'owner',
    });
    expect(inserts.workspace_subscriptions[0]).toMatchObject({
      workspace_id: 'ws-1',
    });
    expect(created.my_role).toBe('owner');
    expect(created.plan).toBe('free');
  });
});

describe('WorkspacesService.resolveWorkspaceForWrite', () => {
  /**
   * Membership is the seat pool, not an authorization ladder: any member may
   * create work in their own organization. A plain member being refused here
   * would make "create a project" an owner-only act.
   */
  it('accepts an explicit workspace for a member of any role', async () => {
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspace_members'
          ? { maybeSingle: { data: { role: 'member' }, error: null } }
          : {},
    });
    const service = buildService(supabase);

    await expect(
      service.resolveWorkspaceForWrite(MEMBER, 'ws-1'),
    ).resolves.toBe('ws-1');
  });

  it('refuses an explicit workspace the caller does not belong to', async () => {
    const supabase = buildSupabase({
      onTable: () => ({ maybeSingle: { data: null, error: null } }),
    });
    const service = buildService(supabase);

    await expect(
      service.resolveWorkspaceForWrite(STRANGER, 'ws-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('falls back to the earliest owned workspace when none is named', async () => {
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspace_members'
          ? {
              maybeSingle: {
                data: { workspace_id: 'ws-default' },
                error: null,
              },
            }
          : {},
    });
    const service = buildService(supabase);

    await expect(service.resolveWorkspaceForWrite(OWNER)).resolves.toBe(
      'ws-default',
    );
  });

  /**
   * A guest owns nothing until they convert, so their project is filed with a
   * null workspace rather than being pushed into someone else's organization.
   */
  it('returns null for a guest instead of provisioning one', async () => {
    const rpc = jest.fn();
    const supabase = buildSupabase({
      rpc,
      onTable: (table) => {
        if (table === 'workspace_members') {
          return { maybeSingle: { data: null, error: null } };
        }
        if (table === 'profiles') {
          return { maybeSingle: { data: { is_guest: true }, error: null } };
        }
        return {};
      },
    });
    const service = buildService(supabase);

    await expect(
      service.resolveWorkspaceForWrite('guest-1'),
    ).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  /** Self-heal for a real user who deleted their only workspace. */
  it('provisions a workspace for a non-guest who owns none', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ id: 'ws-new', name: 'Mine' }],
      error: null,
    });
    const supabase = buildSupabase({
      rpc,
      onTable: (table) => {
        if (table === 'workspace_members') {
          return { maybeSingle: { data: null, error: null } };
        }
        if (table === 'profiles') {
          return { maybeSingle: { data: { is_guest: false }, error: null } };
        }
        return {};
      },
    });
    const service = buildService(supabase);

    await expect(service.resolveWorkspaceForWrite('user-1')).resolves.toBe(
      'ws-new',
    );
    expect(rpc).toHaveBeenCalledWith('provision_default_workspace', {
      p_user_id: 'user-1',
    });
  });
});

describe('WorkspacesService — last-owner guard', () => {
  /**
   * A workspace with no owner is unadministrable: nobody could invite, rename,
   * or delete it, and it would still be billed. Blocking the exit is cheaper
   * than a recovery path.
   */
  function buildWithOwners(owners: string[], viewerRole: string) {
    let membershipCall = 0;
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspaces') return { maybeSingle: { data: WORKSPACE } };
        if (table === 'workspace_members') {
          return {
            // First lookup resolves the caller's role, second the target's.
            maybeSingle: {
              data: { role: membershipCall++ === 0 ? viewerRole : 'owner' },
              error: null,
            },
            list: { data: owners.map((id) => ({ user_id: id })), error: null },
          };
        }
        return {};
      },
    });
    return buildService(supabase);
  }

  it('refuses to remove the only owner', async () => {
    const service = buildWithOwners([OWNER], 'owner');
    await expect(service.removeMember('ws-1', OWNER, OWNER)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to demote the only owner', async () => {
    const service = buildWithOwners([OWNER], 'owner');
    await expect(
      service.updateMember('ws-1', OWNER, OWNER, { role: 'member' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows removing an owner when another remains', async () => {
    const service = buildWithOwners([OWNER, 'user-second-owner'], 'owner');
    await expect(
      service.removeMember('ws-1', OWNER, OWNER),
    ).resolves.toMatchObject({ user_id: OWNER });
  });
});

describe('WorkspacesService.updateMember — ownership transfer', () => {
  function build(callerRole: string, targetRole: string) {
    let membershipCall = 0;
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspaces') return { maybeSingle: { data: WORKSPACE } };
        if (table === 'workspace_members') {
          return {
            maybeSingle: {
              data: { role: membershipCall++ === 0 ? callerRole : targetRole },
              error: null,
            },
          };
        }
        return {};
      },
    });
    return buildService(supabase);
  }

  /**
   * Without this an admin could promote themselves to owner in one request,
   * which is a privilege escalation rather than an administrative act.
   */
  it('refuses an admin granting ownership', async () => {
    const service = build('admin', 'member');
    await expect(
      service.updateMember('ws-1', MEMBER, ADMIN, { role: 'owner' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses an admin changing an existing owner', async () => {
    const service = build('admin', 'owner');
    await expect(
      service.updateMember('ws-1', OWNER, ADMIN, { role: 'member' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('WorkspacesService - slug', () => {
  function buildWithRole(
    role: string,
    updateResult: {
      data?: unknown;
      error?: { code: string; message: string };
    } = {},
  ) {
    const captured: Record<string, unknown> = {};
    const supabase = buildSupabase({
      captured,
      onTable: (table) => {
        if (table === 'workspaces') {
          return {
            maybeSingle: { data: WORKSPACE, error: null },
            single: {
              data: updateResult.data ?? { ...WORKSPACE, slug: 'acme-corp' },
              error: updateResult.error ?? null,
            },
          };
        }
        if (table === 'workspace_members') {
          return { maybeSingle: { data: { role }, error: null } };
        }
        return {};
      },
    });
    return { service: buildService(supabase), captured };
  }

  /**
   * The handle is the organization's public address, so it sits with the
   * owner-only fields. An admin must be refused outright rather than have the
   * field silently dropped.
   */
  it('refuses a slug change from an admin', async () => {
    const { service, captured } = buildWithRole('admin');
    await expect(
      service.updateWorkspace('ws-1', ADMIN, { slug: 'acme-corp' }),
    ).rejects.toThrow(ForbiddenException);
    expect(captured.updates).toBeUndefined();
  });

  it('lets the owner change the slug and returns the read-back row', async () => {
    const { service, captured } = buildWithRole('owner');
    const updated = await service.updateWorkspace('ws-1', OWNER, {
      slug: 'acme-corp',
    });
    const updates = captured.updates as Record<string, any[]>;
    expect(updates.workspaces[0]).toMatchObject({ slug: 'acme-corp' });
    expect(updated.slug).toBe('acme-corp');
  });

  /**
   * The guard trigger's refusals arrive as unique_violation with a message
   * written for people; the API forwards it as a 409 rather than a 500.
   */
  it('maps a taken or reserved slug to 409 with the database message', async () => {
    const { service } = buildWithRole('owner', {
      error: { code: '23505', message: 'The URL "teams" is reserved' },
    });
    await expect(
      service.updateWorkspace('ws-1', OWNER, { slug: 'teams' }),
    ).rejects.toThrow(new ConflictException('The URL "teams" is reserved'));
  });

  it('shapes previous_slugs from the embedded history, newest first', async () => {
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspace_members') {
          return {
            list: {
              data: [
                {
                  workspace_id: 'ws-1',
                  role: 'owner',
                  joined_at: '2026-01-01',
                  workspace: {
                    ...WORKSPACE,
                    slug_history: [
                      { slug: 'acme-old', replaced_at: '2026-02-01T00:00:00Z' },
                      {
                        slug: 'acme-older',
                        replaced_at: '2026-01-15T00:00:00Z',
                      },
                    ],
                  },
                },
              ],
              error: null,
            },
            maybeSingle: { data: null, error: null },
          };
        }
        return {};
      },
    });
    const service = buildService(supabase);
    const [row] = await service.listMyWorkspaces(OWNER);
    expect(row.previous_slugs).toEqual(['acme-old', 'acme-older']);
    expect(
      (row as unknown as Record<string, unknown>).slug_history,
    ).toBeUndefined();
  });

  it('defaults previous_slugs to an empty list when no history is embedded', async () => {
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspaces'
          ? { single: { data: WORKSPACE, error: null } }
          : {},
    });
    const created = await buildService(supabase).createWorkspace(OWNER, {
      name: 'Acme',
    });
    expect(created.previous_slugs).toEqual([]);
    expect(created.slug).toBe('acme');
  });
});
