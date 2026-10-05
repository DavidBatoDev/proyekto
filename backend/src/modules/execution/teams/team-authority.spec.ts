import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isTeamManager, teamManagerIds } from './team-authority';

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };

interface World {
  teams: Row[];
  team_members: Row[];
  profiles: Row[];
}

const TEAM = 'team-1';
const OWNER = 'u-owner';
const CO_OWNER = 'u-co-owner';
const ADMIN = 'u-admin';
const MEMBER = 'u-member';
const VIEWER = 'u-viewer';
const GONE_ADMIN = 'u-gone-admin';
const STRANGER = 'u-stranger';

/** One team with every kind of standing, including a deleted admin. */
function world(): World {
  return {
    teams: [{ id: TEAM, owner_id: OWNER }],
    team_members: [
      // The owner usually also has an 'owner' member row: counted once.
      { team_id: TEAM, user_id: OWNER, role: 'owner' },
      { team_id: TEAM, user_id: CO_OWNER, role: 'owner' },
      { team_id: TEAM, user_id: ADMIN, role: 'admin' },
      { team_id: TEAM, user_id: MEMBER, role: 'member' },
      { team_id: TEAM, user_id: VIEWER, role: 'viewer' },
      { team_id: TEAM, user_id: GONE_ADMIN, role: 'admin' },
      { team_id: 'team-2', user_id: STRANGER, role: 'admin' },
    ],
    profiles: [
      ...[OWNER, CO_OWNER, ADMIN, MEMBER, VIEWER, STRANGER].map(
        (id): Row => ({ id, deleted_at: null }),
      ),
      { id: GONE_ADMIN, deleted_at: '2026-09-30T00:00:00Z' },
    ],
  };
}

/** The SQL body of can_manage_team (M1 A11), over the in-memory world. */
function canManageTeam(w: World, teamId: string, userId: string): boolean {
  return (
    w.teams.some((t) => t.id === teamId && t.owner_id === userId) ||
    w.team_members.some(
      (m) =>
        m.team_id === teamId &&
        m.user_id === userId &&
        (m.role === 'owner' || m.role === 'admin'),
    )
  );
}

/**
 * A minimal PostgREST stand-in: eq/in/is filters and order over in-memory rows,
 * resolved by awaiting the chain or by maybeSingle(). `failOn` makes one table
 * answer with an error instead.
 */
function fakeSupabase(
  w: World,
  o: {
    rpcResult?: { data: unknown; error: DbError | null };
    failOn?: { table: keyof World; error: DbError };
  } = {},
) {
  const rpc = jest.fn((name: string, args: Row) => {
    if (o.rpcResult) return Promise.resolve(o.rpcResult);
    if (name !== 'can_manage_team') {
      return Promise.resolve({
        data: null,
        error: { code: '42883', message: 'no such function' },
      });
    }
    return Promise.resolve({
      data: canManageTeam(
        w,
        args.p_team_id as string,
        args.p_user_id as string,
      ),
      error: null,
    });
  });

  const from = jest.fn((table: keyof World) => {
    const filters: ((row: Row) => boolean)[] = [];
    let orderBy: string | null = null;
    const result = () => {
      if (o.failOn?.table === table) {
        return { data: null, error: o.failOn.error };
      }
      let rows = w[table].filter((row) => filters.every((f) => f(row)));
      if (orderBy) {
        const key = orderBy;
        rows = [...rows].sort((a, b) =>
          String(a[key]).localeCompare(String(b[key])),
        );
      }
      return { data: rows, error: null };
    };
    const chain = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        filters.push((row) => row[col] === value);
        return chain;
      },
      in: (col: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[col]));
        return chain;
      },
      is: (col: string, value: unknown) => {
        filters.push((row) => (row[col] ?? null) === value);
        return chain;
      },
      order: (col: string) => {
        orderBy = col;
        return chain;
      },
      maybeSingle: () => {
        const { data, error } = result();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      then: (
        resolve: (value: ReturnType<typeof result>) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  });

  return { sb: { rpc, from } as unknown as SupabaseClient, rpc, from };
}

// Failures are logged at error level; keep the test output quiet.
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('isTeamManager', () => {
  it.each([
    ['the team owner (teams.owner_id)', OWNER, true],
    ["a member with role 'owner'", CO_OWNER, true],
    ["a member with role 'admin'", ADMIN, true],
    ["a member with role 'member'", MEMBER, false],
    ["a member with role 'viewer'", VIEWER, false],
    ['an admin of another team', STRANGER, false],
  ])('%s → %s', async (_label, userId, expected) => {
    const { sb, rpc } = fakeSupabase(world());

    await expect(isTeamManager(sb, TEAM, userId)).resolves.toBe(expected);
    expect(rpc).toHaveBeenCalledWith('can_manage_team', {
      p_team_id: TEAM,
      p_user_id: userId,
    });
  });

  it('answers false for a null verdict', async () => {
    const { sb } = fakeSupabase(world(), {
      rpcResult: { data: null, error: null },
    });

    await expect(isTeamManager(sb, TEAM, OWNER)).resolves.toBe(false);
  });

  it('answers false for a missing id without asking the database', async () => {
    const { sb, rpc } = fakeSupabase(world());

    await expect(isTeamManager(sb, '', OWNER)).resolves.toBe(false);
    await expect(isTeamManager(sb, TEAM, '')).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats a non-UUID team id as not managed, so the caller 404s', async () => {
    const { sb } = fakeSupabase(world(), {
      rpcResult: {
        data: null,
        error: {
          code: '22P02',
          message: 'invalid input syntax for type uuid: "not-a-uuid"',
        },
      },
    });

    await expect(isTeamManager(sb, 'not-a-uuid', OWNER)).resolves.toBe(false);
  });

  it('raises a 500 without the Postgres text on any other failure', async () => {
    const { sb } = fakeSupabase(world(), {
      rpcResult: {
        data: null,
        error: { code: '57014', message: 'canceling statement due to timeout' },
      },
    });

    const error = await isTeamManager(sb, TEAM, OWNER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as Error).message).not.toMatch(/canceling statement/);
  });
});

describe('teamManagerIds', () => {
  it('lists the owner first, then owner and admin members, each once', async () => {
    const { sb } = fakeSupabase(world());

    await expect(teamManagerIds(sb, TEAM)).resolves.toEqual([
      OWNER,
      ADMIN,
      CO_OWNER,
    ]);
  });

  it('leaves out deleted accounts', async () => {
    const { sb } = fakeSupabase(world());

    await expect(teamManagerIds(sb, TEAM)).resolves.not.toContain(GONE_ADMIN);
  });

  it('leaves out a deleted owner too', async () => {
    const w = world();
    w.profiles = w.profiles.map((p) =>
      p.id === OWNER ? { ...p, deleted_at: '2026-09-30T00:00:00Z' } : p,
    );
    const { sb } = fakeSupabase(w);

    await expect(teamManagerIds(sb, TEAM)).resolves.toEqual([ADMIN, CO_OWNER]);
  });

  it('agrees with isTeamManager for every live account', async () => {
    const w = world();
    const { sb } = fakeSupabase(w);
    const managers = await teamManagerIds(sb, TEAM);

    for (const p of w.profiles.filter((row) => row.deleted_at === null)) {
      const id = p.id as string;
      await expect(isTeamManager(sb, TEAM, id)).resolves.toBe(
        managers.includes(id),
      );
    }
  });

  it('has no managers for a team that does not exist', async () => {
    const { sb, from } = fakeSupabase(world());

    await expect(teamManagerIds(sb, 'team-missing')).resolves.toEqual([]);
    // Nobody to look up, so the profiles read is skipped.
    expect(from).not.toHaveBeenCalledWith('profiles');
  });

  it('answers [] for a missing or non-UUID team id', async () => {
    const { sb, from } = fakeSupabase(world(), {
      failOn: {
        table: 'teams',
        error: { code: '22P02', message: 'invalid input syntax for type uuid' },
      },
    });

    await expect(teamManagerIds(sb, '')).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
    await expect(teamManagerIds(sb, 'not-a-uuid')).resolves.toEqual([]);
  });

  it.each(['teams', 'team_members', 'profiles'] as const)(
    'raises a 500 when the %s read fails',
    async (table) => {
      const { sb } = fakeSupabase(world(), {
        failOn: { table, error: { code: '08006', message: 'connection lost' } },
      });

      await expect(teamManagerIds(sb, TEAM)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    },
  );
});
