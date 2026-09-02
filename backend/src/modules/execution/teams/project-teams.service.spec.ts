import { ProjectTeamsService } from './project-teams.service';

/**
 * Pins the access-row lifecycle around team curation — the mechanics
 * behind a real incident: a project owner attached their own team, then
 * detached it, and the project_team_members DELETE trigger deleted their
 * project_access row because nothing had kept `has_direct_grant` true.
 *
 * The DB trigger now refuses to delete owner rows (see migration
 * 20260901154357), but the application half must hold up its end:
 *   - curating a user who already holds access must not touch their row
 *     (early return — role, flag, origin all stay intact);
 *   - a curation-only member gets a row with has_direct_grant=false so
 *     the trigger CAN reclaim it on detach;
 *   - move_direct_grant demotes an invited member to team-sustained,
 *     but never an owner.
 */
describe('ProjectTeamsService curation', () => {
  const PROJECT = 'project-1';
  const TEAM = 'team-1';
  const CALLER = 'caller-1';

  type Write = { table: string; op: string; payload: Record<string, unknown> };

  /**
   * Chain-shape-agnostic Supabase stub, same approach as the sibling
   * teams specs: builders return themselves, terminals resolve, and
   * every insert/update/upsert is recorded for assertion.
   */
  function build(opts: {
    existingAccess?: {
      id: string;
      role: string;
      origin: string;
      has_direct_grant: boolean;
    } | null;
    /** project_team_members rows for the team being detached. */
    curated?: string[];
    /** project_team_members rows sustained by OTHER attached teams. */
    otherCurated?: string[];
    /** project_access rows for the curated users. */
    access?: Array<{
      user_id: string;
      role: string;
      has_direct_grant: boolean;
    }>;
  }) {
    const writes: Write[] = [];

    const chain = (table: string): Record<string, unknown> => {
      const c: Record<string, unknown> = {};
      let usedNeq = false;
      for (const m of ['select', 'eq', 'in', 'order']) {
        c[m] = () => c;
      }
      c.neq = () => {
        usedNeq = true;
        return c;
      };
      c.delete = () => {
        writes.push({ table, op: 'delete', payload: {} });
        return c;
      };
      c.insert = (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', payload });
        return c;
      };
      c.update = (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'update', payload });
        return c;
      };
      c.upsert = (payload: Record<string, unknown>) => {
        writes.push({ table, op: 'upsert', payload });
        return c;
      };
      c.maybeSingle = () => {
        if (table === 'project_access') {
          return Promise.resolve({
            data: opts.existingAccess ?? null,
            error: null,
          });
        }
        if (table === 'project_teams') {
          // addCuratedMember's attachment existence check.
          return Promise.resolve({ data: { team_id: TEAM }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      c.single = () => {
        if (table === 'project_teams') {
          return Promise.resolve({
            data: {
              project_id: PROJECT,
              team_id: TEAM,
              is_primary: false,
              attached_by: CALLER,
              attached_at: '2026-09-01T00:00:00Z',
            },
            error: null,
          });
        }
        if (table === 'project_team_members') {
          return Promise.resolve({
            data: {
              project_id: PROJECT,
              team_id: TEAM,
              user_id: 'anyone',
              added_by: CALLER,
              added_at: '2026-09-01T00:00:00Z',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      };
      c.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'project_team_members') {
          const ids = usedNeq
            ? (opts.otherCurated ?? [])
            : (opts.curated ?? []);
          return Promise.resolve({
            data: ids.map((user_id) => ({ user_id })),
            error: null,
          }).then(resolve);
        }
        if (table === 'project_access') {
          return Promise.resolve({
            data: opts.access ?? [],
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      };
      return c;
    };

    const projectAuth = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
      assertActionOutranks: jest.fn().mockResolvedValue(undefined),
      grant: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ProjectTeamsService(
      { from: (table: string) => chain(table) } as never,
      projectAuth as never,
    );

    return { service, writes, projectAuth };
  }

  const accessWrites = (writes: Write[]) =>
    writes.filter((w) => w.table === 'project_access');
  const markerWrites = (writes: Write[]) =>
    writes.filter((w) => w.table === 'project_team_members');

  it('curating a brand-new member inserts a team-sustained access row (has_direct_grant=false)', async () => {
    const { service, writes } = build({ existingAccess: null });

    await service.attach(PROJECT, CALLER, {
      team_id: TEAM,
      members: [{ user_id: 'user-new' }],
    } as never);

    expect(markerWrites(writes)).toHaveLength(1);
    const [row] = accessWrites(writes);
    expect(row.op).toBe('insert');
    expect(row.payload).toEqual(
      expect.objectContaining({
        user_id: 'user-new',
        role: 'editor',
        origin: `team:${TEAM}`,
        has_direct_grant: false,
      }),
    );
  });

  it('curating the owner writes the structural marker but never touches their access row', async () => {
    const { service, writes } = build({
      existingAccess: {
        id: 'pa-owner',
        role: 'owner',
        origin: 'direct',
        has_direct_grant: true,
      },
    });

    await service.attach(PROJECT, CALLER, {
      team_id: TEAM,
      members: [{ user_id: 'owner-1' }],
    } as never);

    expect(markerWrites(writes)).toHaveLength(1);
    expect(accessWrites(writes)).toHaveLength(0);
  });

  it('move_direct_grant demotes an invited editor to a team-sustained grant', async () => {
    const { service, writes } = build({
      existingAccess: {
        id: 'pa-editor',
        role: 'editor',
        origin: 'invited',
        has_direct_grant: true,
      },
    });

    await service.addCuratedMember(PROJECT, TEAM, CALLER, {
      user_id: 'user-2',
      move_direct_grant: true,
    } as never);

    const [row] = accessWrites(writes);
    expect(row.op).toBe('update');
    expect(row.payload).toEqual({
      origin: `team:${TEAM}`,
      has_direct_grant: false,
    });
  });

  it('move_direct_grant never demotes an owner, even one with an invited origin', async () => {
    const { service, writes } = build({
      existingAccess: {
        id: 'pa-owner',
        role: 'owner',
        origin: 'invited',
        has_direct_grant: true,
      },
    });

    await service.addCuratedMember(PROJECT, TEAM, CALLER, {
      user_id: 'owner-1',
      move_direct_grant: true,
    } as never);

    expect(accessWrites(writes)).toHaveLength(0);
    expect(markerWrites(writes)).toHaveLength(1);
  });

  it('detach (default) deletes the attachment without granting anyone', async () => {
    const { service, writes, projectAuth } = build({
      curated: ['user-a', 'user-b'],
      access: [
        { user_id: 'user-a', role: 'editor', has_direct_grant: false },
        { user_id: 'user-b', role: 'editor', has_direct_grant: true },
      ],
    });

    await service.detach(PROJECT, TEAM, CALLER);

    expect(projectAuth.grant).not.toHaveBeenCalled();
    expect(writes).toEqual([
      { table: 'project_teams', op: 'delete', payload: {} },
    ]);
  });

  it('detach with retainMembers promotes only members the detach would remove', async () => {
    const { service, writes, projectAuth } = build({
      curated: ['user-lose', 'user-direct', 'user-other-team'],
      otherCurated: ['user-other-team'],
      access: [
        { user_id: 'user-lose', role: 'commenter', has_direct_grant: false },
        { user_id: 'user-direct', role: 'editor', has_direct_grant: true },
        {
          user_id: 'user-other-team',
          role: 'editor',
          has_direct_grant: false,
        },
      ],
    });

    await service.detach(PROJECT, TEAM, CALLER, { retainMembers: true });

    // Only the team-sustained member with no other source gets promoted,
    // with their existing role.
    expect(projectAuth.grant).toHaveBeenCalledTimes(1);
    expect(projectAuth.grant).toHaveBeenCalledWith({
      projectId: PROJECT,
      userId: 'user-lose',
      role: 'commenter',
      origin: 'invited',
      grantedBy: CALLER,
    });
    // Their origin is relabeled to a direct membership, and the
    // attachment is still deleted afterwards.
    expect(writes).toEqual([
      { table: 'project_access', op: 'update', payload: { origin: 'invited' } },
      { table: 'project_teams', op: 'delete', payload: {} },
    ]);
  });

  it('detach with retainMembers skips the grant pass when nobody would lose access', async () => {
    const { service, writes, projectAuth } = build({
      curated: ['user-direct'],
      access: [
        { user_id: 'user-direct', role: 'editor', has_direct_grant: true },
      ],
    });

    await service.detach(PROJECT, TEAM, CALLER, { retainMembers: true });

    expect(projectAuth.grant).not.toHaveBeenCalled();
    expect(writes).toEqual([
      { table: 'project_teams', op: 'delete', payload: {} },
    ]);
  });
});
