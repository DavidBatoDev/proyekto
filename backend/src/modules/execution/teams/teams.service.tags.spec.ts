import { TeamsService } from './teams.service';

/**
 * Tags are descriptive labels, so what these tests pin is mostly about what the
 * service must NOT do: never gate them on a capability, never write
 * `is_personal` from the ordinary create path (the welcome deck calls it, and
 * claiming the personal-team slot would break the vetting-time provisioning
 * invariant), and never send a `tags` patch the caller did not ask for.
 */
describe('TeamsService — tags', () => {
  const OWNER = 'user-1';
  const TEAM = {
    id: 'team-1',
    owner_id: OWNER,
    name: 'Analytical Engines Ltd',
    tags: [],
  };

  /**
   * Chain-shape-agnostic stub, same rationale as the sibling invite-email spec:
   * every builder method returns itself and only the terminals resolve, so
   * adding a filter to an unrelated query cannot break these tests.
   */
  function build() {
    const captured: { insert?: any; update?: any; deletedIds: string[] } = {
      deletedIds: [],
    };

    const chain = (terminal: any, table: string) => {
      const c: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'ilike', 'order', 'limit']) {
        c[method] = () => c;
      }
      c.insert = (payload: unknown) => {
        if (table === 'teams') captured.insert = payload;
        return c;
      };
      c.update = (payload: unknown) => {
        if (table === 'teams') captured.update = payload;
        return c;
      };
      c.delete = () => {
        const d: Record<string, unknown> = {};
        d.eq = (_col: string, value: string) => {
          captured.deletedIds.push(value);
          return Promise.resolve({ error: null });
        };
        return d;
      };
      c.maybeSingle = () =>
        Promise.resolve(terminal.maybeSingle ?? { data: null, error: null });
      c.single = () =>
        Promise.resolve(terminal.single ?? { data: null, error: null });
      // team_members inserts are awaited directly, without a terminal.
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve);
      return c;
    };

    const supabase = {
      from: (table: string) =>
        chain(
          table === 'teams'
            ? {
                maybeSingle: { data: TEAM },
                single: { data: TEAM, error: null },
              }
            : { maybeSingle: { data: null } },
          table,
        ),
    };

    const service = new TeamsService(
      supabase as any,
      { createNotification: jest.fn() } as any,
      { send: jest.fn() } as any,
      { get: jest.fn() } as any,
    );

    return { service, captured };
  }

  describe('createTeam', () => {
    it('normalizes tags before insert', async () => {
      const { service, captured } = build();
      await service.createTeam(OWNER, {
        name: 'Engines',
        tags: ['  Design ', 'design', 'growth\tteam'],
      } as any);
      expect(captured.insert.tags).toEqual(['Design', 'growth team']);
    });

    it('defaults to an empty tag list when none are given', async () => {
      const { service, captured } = build();
      await service.createTeam(OWNER, { name: 'Engines' } as any);
      expect(captured.insert.tags).toEqual([]);
    });

    it('never writes is_personal, so the vetting-time personal team is unaffected', async () => {
      const { service, captured } = build();
      await service.createTeam(OWNER, { name: 'Engines' } as any);
      expect(captured.insert).not.toHaveProperty('is_personal');
    });
  });

  describe('updateTeam', () => {
    it('omits tags from the patch when the field is absent', async () => {
      const { service, captured } = build();
      await service.updateTeam('team-1', OWNER, { name: 'Renamed' } as any);
      expect(captured.update).not.toHaveProperty('tags');
    });

    it('sends an empty array when tags are explicitly cleared', async () => {
      const { service, captured } = build();
      await service.updateTeam('team-1', OWNER, { tags: [] } as any);
      expect(captured.update.tags).toEqual([]);
    });

    it('does not require consultant capability for a tags-only patch', async () => {
      const { service } = build();
      const assertConsultant = jest.spyOn(
        service as any,
        'assertOwnerIsConsultant',
      );
      await service.updateTeam('team-1', OWNER, { tags: ['design'] } as any);
      expect(assertConsultant).not.toHaveBeenCalled();
    });
  });
});
