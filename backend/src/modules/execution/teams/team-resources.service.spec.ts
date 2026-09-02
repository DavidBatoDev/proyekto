import { ForbiddenException } from '@nestjs/common';
import { TeamResourcesService } from './team-resources.service';

/**
 * Two things are worth pinning here, and they are both places where team
 * resources deliberately differ from the project resources they were ported
 * from.
 *
 * The first is the permission split: project resources let ANY project member
 * write, team resources do not. That is a decision, not an accident, and a
 * future contributor porting more of the project code across could quietly
 * undo it.
 *
 * The second is the folder_id payload semantics — absent means "leave it
 * alone", explicit null means "move to uncategorized". It is expressed with
 * hasOwnProperty rather than a truthiness check, which is exactly the kind of
 * subtlety a refactor flattens.
 */
describe('TeamResourcesService', () => {
  const TEAM = 'team-1';
  const USER = 'user-1';

  const LINK = {
    id: 'link-1',
    team_id: TEAM,
    folder_id: 'folder-a',
    title: 'Figma',
    url: 'https://figma.com',
    description: null,
    position: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };

  /**
   * Chain-shape-agnostic Supabase stub, same approach as the sibling teams
   * specs: builders return themselves, only terminals resolve. `updates`
   * records every patch written so a test can assert what moved.
   */
  function build(opts: { canWrite?: boolean } = {}) {
    const canWrite = opts.canWrite ?? true;
    const updates: Array<Record<string, unknown>> = [];

    const chain = (table: string): Record<string, unknown> => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'delete']) {
        c[m] = () => c;
      }
      c.insert = () => c;
      c.update = (payload: Record<string, unknown>) => {
        updates.push(payload);
        return c;
      };
      c.maybeSingle = () => {
        if (table === 'team_resource_links') {
          return Promise.resolve({ data: { ...LINK }, error: null });
        }
        if (table === 'team_resource_folders') {
          return Promise.resolve({
            data: { id: 'folder-b', team_id: TEAM, position: 3 },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      };
      c.single = () => Promise.resolve({ data: { ...LINK }, error: null });
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return c;
    };

    const teams = {
      fetchTeamOrThrow: jest.fn().mockResolvedValue({
        id: TEAM,
        owner_id: 'someone-else',
      }),
      assertCanRead: jest.fn().mockResolvedValue('member'),
      assertCanManageTeam: jest.fn(() =>
        canWrite
          ? Promise.resolve('admin')
          : Promise.reject(
              new ForbiddenException(
                'Only the team owner or team admins can manage team resources',
              ),
            ),
      ),
    };

    const service = new TeamResourcesService(
      { from: (table: string) => chain(table) } as any,
      teams as any,
    );

    return { service, teams, updates };
  }

  describe('permissions — the divergence from project resources', () => {
    it('lets any member read', async () => {
      const { service, teams } = build();
      await service.listResources(TEAM, USER);
      expect(teams.assertCanRead).toHaveBeenCalled();
      expect(teams.assertCanManageTeam).not.toHaveBeenCalled();
    });

    it.each([
      [
        'createFolder',
        (s: TeamResourcesService) =>
          s.createFolder(TEAM, USER, { name: 'Docs' } as any),
      ],
      [
        'updateFolder',
        (s: TeamResourcesService) =>
          s.updateFolder(TEAM, USER, 'folder-a', { name: 'Docs' } as any),
      ],
      [
        'deleteFolder',
        (s: TeamResourcesService) => s.deleteFolder(TEAM, USER, 'folder-a'),
      ],
      [
        'reorderFolders',
        (s: TeamResourcesService) =>
          s.reorderFolders(TEAM, USER, { items: [] } as any),
      ],
      [
        'createLink',
        (s: TeamResourcesService) =>
          s.createLink(TEAM, USER, {
            title: 'x',
            url: 'https://e.com',
          } as any),
      ],
      [
        'updateLink',
        (s: TeamResourcesService) =>
          s.updateLink(TEAM, USER, 'link-1', { title: 'x' } as any),
      ],
      [
        'deleteLink',
        (s: TeamResourcesService) => s.deleteLink(TEAM, USER, 'link-1'),
      ],
      [
        'reorderLinks',
        (s: TeamResourcesService) =>
          s.reorderLinks(TEAM, USER, { items: [] } as any),
      ],
    ])('refuses %s for a plain member', async (_name, call) => {
      const { service, updates } = build({ canWrite: false });
      await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
      expect(updates).toHaveLength(0);
    });
  });

  describe('updateLink folder_id semantics', () => {
    it('leaves the link where it is when folder_id is absent', async () => {
      const { service, updates } = build();
      await service.updateLink(TEAM, USER, 'link-1', { title: 'Renamed' });
      expect(updates[0]).not.toHaveProperty('folder_id');
      // No move means no repositioning.
      expect(updates[0]).not.toHaveProperty('position');
    });

    it('moves the link to uncategorized when folder_id is explicitly null', async () => {
      const { service, updates } = build();
      await service.updateLink(TEAM, USER, 'link-1', { folder_id: null });
      expect(updates[0]).toMatchObject({ folder_id: null });
      // A move must also claim a fresh position in the destination, or it
      // collides with whatever already sits at the old index.
      expect(updates[0]).toHaveProperty('position');
    });

    it('does not reposition when folder_id names the folder the link is already in', async () => {
      const { service, updates } = build();
      await service.updateLink(TEAM, USER, 'link-1', {
        folder_id: 'folder-a',
      });
      expect(updates[0]).toMatchObject({ folder_id: 'folder-a' });
      expect(updates[0]).not.toHaveProperty('position');
    });
  });

  describe('text normalization', () => {
    it('rejects a whitespace-only folder name before it reaches the database', async () => {
      const { service } = build();
      await expect(
        service.createFolder(TEAM, USER, { name: '   ' } as any),
      ).rejects.toThrow(/Folder name is required/);
    });

    it('rejects a whitespace-only link title', async () => {
      const { service } = build();
      await expect(
        service.createLink(TEAM, USER, {
          title: '  ',
          url: 'https://e.com',
        } as any),
      ).rejects.toThrow(/Link title is required/);
    });
  });
});
