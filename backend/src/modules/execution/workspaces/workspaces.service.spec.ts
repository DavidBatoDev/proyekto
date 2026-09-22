/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked<EntitlementsService>; passing its
 * members to expect() is an identity check on the mock, never a call, so
 * `this` scoping is irrelevant.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  allowAllEntitlements,
  buildSeedKeyRows,
  buildSeedLimitRows,
  type EntitlementsMock,
} from '../../shared/entitlements/__entitlements-test-kit-spec';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { PlanLimitException } from '../../shared/entitlements/plan-limit.exception';
import type {
  WorkspacePlanStateRow,
  WorkspaceUsageCountsRow,
} from '../../shared/entitlements/repositories/entitlements.repository.interface';
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
      'lte',
    ]) {
      c[method] = () => c;
    }
    c.or = (filter: string) => {
      if (handlers.captured) {
        const bucket = (handlers.captured.ors ??= {}) as Record<
          string,
          string[]
        >;
        (bucket[table] ??= []).push(filter);
      }
      return c;
    };
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

/**
 * A stand-in for SeatSyncService. Returned so a test can assert whether a
 * membership change pushed a new seat quantity to Stripe — the two hooks are
 * easy to drop in a refactor and impossible to notice missing, because the only
 * symptom is an invoice that is quietly wrong.
 */
function buildSeatSync() {
  return { syncSeatsBounded: jest.fn().mockResolvedValue(undefined) };
}

function buildService(
  supabase: unknown,
  seatSync: { syncSeatsBounded: jest.Mock } = buildSeatSync(),
  entitlements: EntitlementsService = allowAllEntitlements(),
  mailer: { send: jest.Mock } = {
    send: jest.fn().mockResolvedValue({ sent: true }),
  },
) {
  return new WorkspacesService(
    supabase as never,
    { createNotification: jest.fn() } as never,
    mailer as never,
    { get: jest.fn() } as never,
    seatSync as never,
    entitlements,
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

describe('WorkspacesService — seat sync hooks', () => {
  /**
   * Seats are COUNT(workspace_members), so exactly the paths that add or remove
   * a membership row must push a new quantity to Stripe. These four tests exist
   * because a dropped hook has no visible symptom: the product keeps working
   * and only the invoice is quietly wrong.
   *
   * Note there is a fifth path these cannot cover — provision_default_workspace()
   * inserts an owner row inside Postgres — which is why the reconcile cron is
   * required rather than merely prudent.
   */
  function buildWithMembers(owners: string[], viewerRole: string) {
    let membershipCall = 0;
    const seatSync = {
      syncSeatsBounded: jest.fn().mockResolvedValue(undefined),
    };
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspaces') return { maybeSingle: { data: WORKSPACE } };
        if (table === 'workspace_members') {
          return {
            maybeSingle: {
              data: { role: membershipCall++ === 0 ? viewerRole : 'member' },
              error: null,
            },
            single: {
              data: {
                workspace_id: 'ws-1',
                user_id: 'user-target',
                role: 'admin',
              },
              error: null,
            },
            list: { data: owners.map((id) => ({ user_id: id })), error: null },
          };
        }
        return {};
      },
    });
    return { service: buildService(supabase, seatSync), seatSync };
  }

  it('syncs seats when a member is removed', async () => {
    const { service, seatSync } = buildWithMembers([OWNER, 'other'], 'owner');
    await service.removeMember('ws-1', 'user-target', OWNER);
    expect(seatSync.syncSeatsBounded).toHaveBeenCalledWith(
      'ws-1',
      'member_removed',
    );
  });

  it('does not sync seats on a role change — every role is one seat', async () => {
    const { service, seatSync } = buildWithMembers([OWNER, 'other'], 'owner');
    await service.updateMember('ws-1', 'user-target', OWNER, {
      role: 'admin',
    });
    expect(seatSync.syncSeatsBounded).not.toHaveBeenCalled();
  });

  it('syncs seats when an invite is accepted', async () => {
    const seatSync = {
      syncSeatsBounded: jest.fn().mockResolvedValue(undefined),
    };
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspace_invites') {
          return {
            maybeSingle: {
              data: {
                id: 'inv-1',
                workspace_id: 'ws-1',
                invitee_id: OWNER,
                status: 'pending',
                role: 'member',
              },
            },
            single: { data: { id: 'inv-1', status: 'accepted' } },
          };
        }
        return {};
      },
    });
    await buildService(supabase, seatSync).respondInvite('inv-1', OWNER, {
      status: 'accepted',
    });
    expect(seatSync.syncSeatsBounded).toHaveBeenCalledWith(
      'ws-1',
      'member_joined',
    );
  });

  it('never lets an invite carry the owner role into the workspace', async () => {
    // Owner never arrives by invitation. A row saying otherwise can only come
    // from a direct write that predates the grant hardening, so it joins as a
    // plain member rather than taking the workspace over.
    const captured: Record<string, unknown> = {};
    const supabase = buildSupabase({
      captured,
      onTable: (table) => {
        if (table === 'workspace_invites') {
          return {
            maybeSingle: {
              data: {
                id: 'inv-1',
                workspace_id: 'ws-1',
                invitee_id: OWNER,
                status: 'pending',
                role: 'owner',
              },
            },
            single: { data: { id: 'inv-1', status: 'accepted' } },
          };
        }
        return {};
      },
    });
    await buildService(supabase).respondInvite('inv-1', OWNER, {
      status: 'accepted',
    });
    const inserts = (captured.inserts as Record<string, unknown[]>)
      .workspace_members;
    expect(inserts).toEqual([expect.objectContaining({ role: 'member' })]);
  });

  it('does not sync seats when an invite is declined', async () => {
    const seatSync = {
      syncSeatsBounded: jest.fn().mockResolvedValue(undefined),
    };
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspace_invites') {
          return {
            maybeSingle: {
              data: {
                id: 'inv-1',
                workspace_id: 'ws-1',
                invitee_id: OWNER,
                status: 'pending',
                role: 'member',
              },
            },
            single: { data: { id: 'inv-1', status: 'declined' } },
          };
        }
        return {};
      },
    });
    await buildService(supabase, seatSync).respondInvite('inv-1', OWNER, {
      status: 'declined',
    });
    expect(seatSync.syncSeatsBounded).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Plan limits
// ---------------------------------------------------------------------------

/**
 * A real EntitlementsService over a fake repository, so these tests exercise
 * the actual limit arithmetic (members + pending invites, rank vs limit, the
 * comp-beats-subscription rule) rather than a mock's say-so. The limits table
 * is the seeded one: Free allows 10 members, Pro unlimited.
 */
function buildRealEntitlements(
  input: {
    plan?: Partial<WorkspacePlanStateRow>;
    usage?: Partial<Omit<WorkspaceUsageCountsRow, 'workspace_id'>>;
  } = {},
) {
  const repo = {
    listLimitKeys: jest.fn(() => Promise.resolve(buildSeedKeyRows())),
    listLimits: jest.fn(() => Promise.resolve(buildSeedLimitRows())),
    getPlanStates: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.map(
          (id): WorkspacePlanStateRow => ({
            workspace_id: id,
            workspace_name: 'Acme',
            workspace_slug: 'acme',
            subscription_plan: 'free',
            subscription_status: null,
            has_provider_subscription: false,
            is_discounted_free: false,
            discounted_plan: null,
            discounted_at: null,
            discounted_until: null,
            comp_active: false,
            effective_plan: 'free',
            plan_source: 'default',
            ...input.plan,
          }),
        ),
      ),
    ),
    getUsageCounts: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          workspace_id: id,
          members: 0,
          pending_invites: 0,
          projects: 0,
          teams: 0,
          ...input.usage,
        })),
      ),
    ),
    getLargestRoadmaps: jest.fn(() => Promise.resolve([])),
    resolveSubject: jest.fn(() => Promise.resolve(null)),
    countRoadmapNodes: jest.fn(() => Promise.resolve(new Map())),
    listMemberWorkspaceIds: jest.fn(() => Promise.resolve([])),
  };
  const cache = {
    rememberJson: jest.fn(
      (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
    ),
    del: jest.fn(() => Promise.resolve()),
  };
  const purge = { purgePaths: jest.fn(() => Promise.resolve()) };
  const service = new EntitlementsService(
    repo as never,
    cache as never,
    purge as never,
  );
  return { service, repo };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('WorkspacesService — member limit on invites', () => {
  /**
   * The caller is an owner; the invitee has no profile yet (so the only
   * workspace_members lookup is the caller's role). `existingInvite` is the
   * pending row the refresh path finds.
   */
  function buildInviteHarness(
    entitlements: EntitlementsService,
    existingInvite: { id: string } | null = null,
  ) {
    const captured: Record<string, unknown> = {};
    const mailer = { send: jest.fn().mockResolvedValue({ sent: true }) };
    const supabase = buildSupabase({
      captured,
      onTable: (table) => {
        if (table === 'workspaces') {
          return { maybeSingle: { data: WORKSPACE, error: null } };
        }
        if (table === 'workspace_members') {
          return { maybeSingle: { data: { role: 'owner' }, error: null } };
        }
        if (table === 'workspace_invites') {
          return {
            maybeSingle: { data: existingInvite, error: null },
            single: {
              data: { id: existingInvite?.id ?? 'inv-new', status: 'pending' },
              error: null,
            },
          };
        }
        return {};
      },
    });
    const service = buildService(
      supabase,
      buildSeatSync(),
      entitlements,
      mailer,
    );
    return { service, captured, mailer };
  }

  const invite = { email: 'new.person@example.com' };

  it('refuses a new invite when members plus pending invites already fill the plan, writing nothing and sending nothing', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 7, pending_invites: 3 },
    });
    const { service, captured, mailer } = buildInviteHarness(entitlements);

    const error = await rejection(service.inviteByEmail('ws-1', OWNER, invite));

    expect(error).toBeInstanceOf(PlanLimitException);
    expect((error as PlanLimitException).payload).toMatchObject({
      code: 'plan_limit',
      limit_key: 'members',
      limit: 10,
      used: 10,
      plan: 'free',
      upgrade_plan: 'pro',
      context: 'invite',
    });
    expect(
      (captured.inserts as Record<string, unknown[]> | undefined)
        ?.workspace_invites,
    ).toBeUndefined();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('allows the invite that brings members plus pending invites exactly to the limit', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 6, pending_invites: 3 },
    });
    const { service, captured, mailer } = buildInviteHarness(entitlements);

    await expect(
      service.inviteByEmail('ws-1', OWNER, invite),
    ).resolves.toMatchObject({ id: 'inv-new' });
    expect(
      (captured.inserts as Record<string, unknown[]>).workspace_invites,
    ).toHaveLength(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  /** A refresh adds nobody, so even a full workspace may re-send an invite. */
  it('never checks the limit when refreshing an invite that is already pending', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 10, pending_invites: 5 },
    });
    const assertSpy = jest.spyOn(entitlements, 'assertWithinLimit');
    const { service, captured, mailer } = buildInviteHarness(entitlements, {
      id: 'inv-old',
    });

    await expect(
      service.inviteByEmail('ws-1', OWNER, invite),
    ).resolves.toMatchObject({ id: 'inv-old' });
    expect(assertSpy).not.toHaveBeenCalled();
    expect(
      (captured.updates as Record<string, unknown[]>).workspace_invites,
    ).toHaveLength(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('checks permission before the plan, so a plain member learns nothing about it', async () => {
    const entitlements = allowAllEntitlements();
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspaces') {
          return { maybeSingle: { data: WORKSPACE, error: null } };
        }
        if (table === 'workspace_members') {
          return { maybeSingle: { data: { role: 'member' }, error: null } };
        }
        return {};
      },
    });
    const service = buildService(supabase, buildSeatSync(), entitlements);

    await expect(
      service.inviteByEmail('ws-1', MEMBER, invite),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(entitlements.assertWithinLimit).not.toHaveBeenCalled();
  });

  /**
   * The effective plan decides, not the subscription: a workspace comped to
   * Pro while its subscription says Free has no member limit.
   */
  it('treats a comped workspace as its complimentary plan: the 11th invite goes through', async () => {
    const { service: entitlements } = buildRealEntitlements({
      plan: {
        subscription_plan: 'free',
        is_discounted_free: true,
        discounted_plan: 'pro',
        comp_active: true,
        effective_plan: 'pro',
        plan_source: 'complimentary',
      },
      usage: { members: 10, pending_invites: 0 },
    });
    const { service, captured } = buildInviteHarness(entitlements);

    await expect(
      service.inviteByEmail('ws-1', OWNER, invite),
    ).resolves.toMatchObject({ id: 'inv-new' });
    expect(
      (captured.inserts as Record<string, unknown[]>).workspace_invites,
    ).toHaveLength(1);
  });
});

describe('WorkspacesService — member limit on accept', () => {
  const PENDING_INVITE = {
    id: 'inv-1',
    workspace_id: 'ws-1',
    invitee_id: MEMBER,
    status: 'pending',
    role: 'member',
  };

  /**
   * `alreadyMember` is what findMembership reports for the invitee.
   * `insert` is the workspace_members insert result; `rank` is what the
   * post-insert head count returns.
   */
  function buildAcceptHarness(
    entitlements: EntitlementsService,
    options: {
      alreadyMember?: boolean;
      insert?: { data: unknown; error: unknown };
      rank?: number;
    } = {},
  ) {
    const captured: Record<string, unknown> = {};
    const seatSync = buildSeatSync();
    const supabase = buildSupabase({
      captured,
      onTable: (table) => {
        if (table === 'workspace_invites') {
          return {
            maybeSingle: { data: PENDING_INVITE, error: null },
            single: { data: { id: 'inv-1', status: 'accepted' }, error: null },
          };
        }
        if (table === 'workspace_members') {
          return {
            maybeSingle: {
              data: options.alreadyMember ? { role: 'member' } : null,
              error: null,
            },
            single: options.insert ?? {
              data: {
                id: 'wm-new',
                joined_at: '2026-09-22T10:00:00.123456+00:00',
              },
              error: null,
            },
            list: { data: null, count: options.rank ?? 1, error: null },
          };
        }
        return {};
      },
    });
    return {
      service: buildService(supabase, seatSync, entitlements),
      captured,
      seatSync,
    };
  }

  it('refuses at the limit before inserting, and leaves the invite pending', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 10, pending_invites: 4 },
    });
    const { service, captured, seatSync } = buildAcceptHarness(entitlements);

    const error = await rejection(
      service.respondInvite('inv-1', MEMBER, { status: 'accepted' }),
    );

    expect(error).toBeInstanceOf(PlanLimitException);
    expect((error as PlanLimitException).payload).toMatchObject({
      limit_key: 'members',
      context: 'accept',
      limit: 10,
    });
    expect((error as PlanLimitException).message).toMatch(
      /Ask a workspace owner to upgrade/,
    );
    expect(
      (captured.inserts as Record<string, unknown[]> | undefined)
        ?.workspace_members,
    ).toBeUndefined();
    // No status write at all: the invite is still pending.
    expect(
      (captured.updates as Record<string, unknown[]> | undefined)
        ?.workspace_invites,
    ).toBeUndefined();
    expect(seatSync.syncSeatsBounded).not.toHaveBeenCalled();
  });

  /**
   * Pending invites are not counted at accept time: the accepting invite is
   * itself one of them. 9 members + 4 pending still leaves this seat.
   */
  it('counts only real members at accept time', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 9, pending_invites: 4 },
    });
    const { service, seatSync } = buildAcceptHarness(entitlements, {
      rank: 10,
    });

    await expect(
      service.respondInvite('inv-1', MEMBER, { status: 'accepted' }),
    ).resolves.toMatchObject({ status: 'accepted' });
    expect(seatSync.syncSeatsBounded).toHaveBeenCalledWith(
      'ws-1',
      'member_joined',
    );
  });

  it('never checks a decline, even at the limit', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 10 },
    });
    const assertSpy = jest.spyOn(entitlements, 'assertWithinLimit');
    const getLimitSpy = jest.spyOn(entitlements, 'getLimit');
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspace_invites'
          ? {
              maybeSingle: { data: PENDING_INVITE, error: null },
              single: { data: { id: 'inv-1', status: 'declined' } },
            }
          : {},
    });
    const service = buildService(supabase, buildSeatSync(), entitlements);

    await expect(
      service.respondInvite('inv-1', MEMBER, { status: 'declined' }),
    ).resolves.toMatchObject({ status: 'declined' });
    expect(assertSpy).not.toHaveBeenCalled();
    expect(getLimitSpy).not.toHaveBeenCalled();
  });

  /** Already on the roster takes no new seat: the 23505 path is never checked. */
  it('never checks an invitee who is already a member', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 10 },
    });
    const assertSpy = jest.spyOn(entitlements, 'assertWithinLimit');
    const { service, captured, seatSync } = buildAcceptHarness(entitlements, {
      alreadyMember: true,
      insert: {
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      },
    });

    await expect(
      service.respondInvite('inv-1', MEMBER, { status: 'accepted' }),
    ).resolves.toMatchObject({ status: 'accepted' });
    expect(assertSpy).not.toHaveBeenCalled();
    expect(seatSync.syncSeatsBounded).not.toHaveBeenCalled();
    expect(
      (captured.updates as Record<string, unknown[]>).workspace_invites[0],
    ).toMatchObject({ status: 'accepted' });
  });

  /**
   * Two invitees took the last seat at once and both passed the pre-check.
   * This one ranks 11th by (joined_at, id), so its row is removed again, no
   * seat is billed, and its invite stays pending.
   */
  it('removes a racing join that ranks past the limit, without a seat sync', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 9 },
    });
    const { service, captured, seatSync } = buildAcceptHarness(entitlements, {
      rank: 11,
    });

    const error = await rejection(
      service.respondInvite('inv-1', MEMBER, { status: 'accepted' }),
    );

    expect(error).toBeInstanceOf(PlanLimitException);
    expect((error as PlanLimitException).payload).toMatchObject({
      limit_key: 'members',
      context: 'accept',
      used: 10,
    });
    expect(captured.deletes).toEqual(['workspace_members']);
    expect(seatSync.syncSeatsBounded).not.toHaveBeenCalled();
    expect(
      (captured.updates as Record<string, unknown[]> | undefined)
        ?.workspace_invites,
    ).toBeUndefined();
    // The tie-break keeps the database's own timestamp string, microseconds
    // included, and breaks equal timestamps on id.
    expect(
      (captured.ors as Record<string, string[]>).workspace_members,
    ).toEqual([
      'joined_at.lt."2026-09-22T10:00:00.123456+00:00",and(joined_at.eq."2026-09-22T10:00:00.123456+00:00",id.lte.wm-new)',
    ]);
  });

  it('keeps a racing join that ranks exactly at the limit', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 9 },
    });
    const { service, captured, seatSync } = buildAcceptHarness(entitlements, {
      rank: 10,
    });

    await expect(
      service.respondInvite('inv-1', MEMBER, { status: 'accepted' }),
    ).resolves.toMatchObject({ status: 'accepted' });
    expect(captured.deletes).toBeUndefined();
    expect(seatSync.syncSeatsBounded).toHaveBeenCalledWith(
      'ws-1',
      'member_joined',
    );
  });

  it('ranks nothing on an unlimited plan', async () => {
    const { service: entitlements } = buildRealEntitlements({
      plan: {
        subscription_plan: 'pro',
        subscription_status: 'active',
        effective_plan: 'pro',
        plan_source: 'subscription',
      },
      usage: { members: 40 },
    });
    const { service, captured, seatSync } = buildAcceptHarness(entitlements, {
      rank: 41,
    });

    await expect(
      service.respondInvite('inv-1', MEMBER, { status: 'accepted' }),
    ).resolves.toMatchObject({ status: 'accepted' });
    expect(captured.ors).toBeUndefined();
    expect(captured.deletes).toBeUndefined();
    expect(seatSync.syncSeatsBounded).toHaveBeenCalledTimes(1);
  });

  /** Fail open: a broken rank read never costs someone their join. */
  it('keeps the member when the rank cannot be read', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { service: entitlements } = buildRealEntitlements({
      usage: { members: 9 },
    });
    const captured: Record<string, unknown> = {};
    const seatSync = buildSeatSync();
    const supabase = buildSupabase({
      captured,
      onTable: (table) => {
        if (table === 'workspace_invites') {
          return {
            maybeSingle: { data: PENDING_INVITE, error: null },
            single: { data: { id: 'inv-1', status: 'accepted' } },
          };
        }
        if (table === 'workspace_members') {
          return {
            single: {
              data: { id: 'wm-new', joined_at: '2026-09-22T10:00:00+00:00' },
              error: null,
            },
            list: { data: null, count: null, error: { message: 'boom' } },
          };
        }
        return {};
      },
    });
    const service = buildService(supabase, seatSync, entitlements);

    await expect(
      service.respondInvite('inv-1', MEMBER, { status: 'accepted' }),
    ).resolves.toMatchObject({ status: 'accepted' });
    expect(captured.deletes).toBeUndefined();
    expect(seatSync.syncSeatsBounded).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});

describe('WorkspacesService — limit exemptions', () => {
  function expectUntouched(entitlements: EntitlementsMock) {
    for (const [name, fn] of Object.entries(entitlements)) {
      expect({ name, calls: (fn as jest.Mock).mock.calls.length }).toEqual({
        name,
        calls: 0,
      });
    }
  }

  /** A new workspace starts with exactly one member, so it is never checked. */
  it('createWorkspace never consults entitlements', async () => {
    const entitlements = allowAllEntitlements();
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspaces'
          ? { single: { data: WORKSPACE, error: null } }
          : {},
    });
    await buildService(supabase, buildSeatSync(), entitlements).createWorkspace(
      OWNER,
      { name: 'Acme' },
    );
    expectUntouched(entitlements);
  });

  it('provisionDefault never consults entitlements', async () => {
    const entitlements = allowAllEntitlements();
    const rpc = jest.fn().mockResolvedValue({
      data: [{ id: 'ws-new', name: 'Mine' }],
      error: null,
    });
    const supabase = buildSupabase({ rpc });
    await buildService(
      supabase,
      buildSeatSync(),
      entitlements,
    ).provisionDefault('user-1');
    expectUntouched(entitlements);
  });
});

describe('WorkspacesService.resolveWorkspaceForCreate', () => {
  it('checks the resource count against the resolved workspace', async () => {
    const entitlements = allowAllEntitlements();
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspace_members'
          ? { maybeSingle: { data: { role: 'member' }, error: null } }
          : {},
    });
    const service = buildService(supabase, buildSeatSync(), entitlements);

    await expect(
      service.resolveWorkspaceForCreate(MEMBER, 'projects', 'ws-1'),
    ).resolves.toBe('ws-1');
    expect(entitlements.assertWithinLimit).toHaveBeenCalledWith(
      'ws-1',
      'projects',
      { adding: 1, context: 'create' },
    );
  });

  it('propagates the plan refusal', async () => {
    const { service: entitlements } = buildRealEntitlements({
      usage: { teams: 2 },
    });
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspace_members'
          ? { maybeSingle: { data: { workspace_id: 'ws-1' }, error: null } }
          : {},
    });
    const service = buildService(supabase, buildSeatSync(), entitlements);

    const error = await rejection(
      service.resolveWorkspaceForCreate(OWNER, 'teams'),
    );
    expect(error).toBeInstanceOf(PlanLimitException);
    expect((error as PlanLimitException).payload).toMatchObject({
      limit_key: 'teams',
      limit: 2,
      used: 2,
      context: 'create',
    });
  });

  /** A guest owns nothing until they convert, so there is nothing to count. */
  it('skips the check for a guest, who resolves to no workspace', async () => {
    const entitlements = allowAllEntitlements();
    const supabase = buildSupabase({
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
    const service = buildService(supabase, buildSeatSync(), entitlements);

    await expect(
      service.resolveWorkspaceForCreate('guest-1', 'projects'),
    ).resolves.toBeNull();
    expect(entitlements.assertWithinLimit).not.toHaveBeenCalled();
  });

  /** Membership first: a stranger gets the 403, never a plan answer. */
  it('refuses a stranger before consulting the plan', async () => {
    const entitlements = allowAllEntitlements();
    const supabase = buildSupabase({
      onTable: () => ({ maybeSingle: { data: null, error: null } }),
    });
    const service = buildService(supabase, buildSeatSync(), entitlements);

    await expect(
      service.resolveWorkspaceForCreate(STRANGER, 'teams', 'ws-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(entitlements.assertWithinLimit).not.toHaveBeenCalled();
  });
});

describe('WorkspacesService — plan fields on the workspace payload', () => {
  const COMP_STATE = {
    workspace_id: 'ws-1',
    workspace_name: 'Acme',
    workspace_slug: 'acme',
    effective_plan: 'pro' as const,
    plan_source: 'complimentary' as const,
    subscription_plan: 'free' as const,
    subscription_status: null,
    has_provider_subscription: false,
    complimentary: {
      plan: 'pro' as const,
      since: '2026-09-01T00:00:00Z',
      until: null,
      active: true,
    },
  };
  const COMPED_WORKSPACE = {
    ...WORKSPACE,
    is_discounted_free: true,
    discounted_plan: 'pro',
    discounted_at: '2026-09-01T00:00:00Z',
    discounted_until: null,
  };

  function membershipsList(workspace: Record<string, unknown>) {
    return {
      list: {
        data: [
          {
            workspace_id: 'ws-1',
            role: 'member',
            joined_at: '2026-01-01',
            workspace,
          },
        ],
        error: null,
      },
    };
  }

  it('listMyWorkspaces adds the effective plan while plan stays the subscription plan', async () => {
    const entitlements = allowAllEntitlements();
    entitlements.getEffectivePlans.mockResolvedValue(
      new Map([['ws-1', COMP_STATE]]),
    );
    const supabase = buildSupabase({
      onTable: (table) =>
        table === 'workspace_members' ? membershipsList(COMPED_WORKSPACE) : {},
    });
    const [row] = await buildService(
      supabase,
      buildSeatSync(),
      entitlements,
    ).listMyWorkspaces(MEMBER);

    expect(row).toMatchObject({
      plan: 'free',
      effective_plan: 'pro',
      plan_source: 'complimentary',
      is_discounted_free: true,
      discounted_plan: 'pro',
    });
    expect(entitlements.getEffectivePlans).toHaveBeenCalledWith(['ws-1']);
  });

  /** Display only: a broken plan-state lookup degrades, never fails the list. */
  it('listMyWorkspaces falls back to the subscription plan when the plan state fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const entitlements = allowAllEntitlements();
    entitlements.getEffectivePlans.mockRejectedValue(
      new Error('relation "plan_limits" does not exist'),
    );
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspace_members') return membershipsList(WORKSPACE);
        if (table === 'workspace_subscriptions') {
          return {
            list: {
              data: [{ workspace_id: 'ws-1', plan: 'pro' }],
              error: null,
            },
          };
        }
        return {};
      },
    });
    const [row] = await buildService(
      supabase,
      buildSeatSync(),
      entitlements,
    ).listMyWorkspaces(MEMBER);

    expect(row).toMatchObject({
      plan: 'pro',
      effective_plan: 'pro',
      plan_source: 'subscription',
      is_discounted_free: false,
      discounted_plan: null,
    });
    jest.restoreAllMocks();
  });

  function buildGetHarness(role: string) {
    const entitlements = allowAllEntitlements();
    entitlements.getEffectivePlans.mockResolvedValue(
      new Map([['ws-1', COMP_STATE]]),
    );
    const supabase = buildSupabase({
      onTable: (table) => {
        if (table === 'workspaces') {
          return { maybeSingle: { data: COMPED_WORKSPACE, error: null } };
        }
        if (table === 'workspace_members') {
          return { maybeSingle: { data: { role }, error: null } };
        }
        if (table === 'workspace_subscriptions') {
          return {
            maybeSingle: {
              data: { workspace_id: 'ws-1', plan: 'free', status: 'active' },
              error: null,
            },
          };
        }
        return {};
      },
    });
    return buildService(supabase, buildSeatSync(), entitlements);
  }

  it('getWorkspace gives an owner the effective plan beside the subscription', async () => {
    const row = await buildGetHarness('owner').getWorkspace('ws-1', OWNER);
    expect(row).toMatchObject({
      plan: 'free',
      effective_plan: 'pro',
      plan_source: 'complimentary',
      is_discounted_free: true,
      discounted_plan: 'pro',
    });
    expect(row.subscription).toMatchObject({ plan: 'free' });
  });

  /** Members hit limits too, but the subscription block stays owner/admin-only. */
  it('getWorkspace gives a plain member the effective plan and still no subscription', async () => {
    const row = await buildGetHarness('member').getWorkspace('ws-1', MEMBER);
    expect(row).toMatchObject({
      effective_plan: 'pro',
      plan_source: 'complimentary',
    });
    expect(row.subscription).toBeUndefined();
    expect(row.plan).toBeUndefined();
  });
});
