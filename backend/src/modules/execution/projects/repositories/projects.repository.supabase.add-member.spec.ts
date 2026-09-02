import { SupabaseProjectsRepository } from './projects.repository.supabase';

/**
 * Pins that a direct member add carries has_direct_grant=true. The
 * column defaults to false, and a false flag makes the row eligible for
 * garbage collection by the project_team_members DELETE trigger — the
 * exact mechanism that once deleted a project owner's access when their
 * team was detached. Direct adds must be self-sustaining.
 */
describe('SupabaseProjectsRepository.addMember', () => {
  it('inserts the access row with has_direct_grant=true', async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> =
      [];

    const chain = (table: string): Record<string, unknown> => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) {
        c[m] = () => c;
      }
      c.insert = (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return c;
      };
      c.single = () => {
        if (table === 'projects') {
          return Promise.resolve({
            data: { id: 'project-1', owner_id: 'owner-1' },
            error: null,
          });
        }
        if (table === 'profiles') {
          return Promise.resolve({ data: { id: 'user-2' }, error: null });
        }
        if (table === 'project_access') {
          return Promise.resolve({ data: { id: 'pa-1' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      return c;
    };

    const repo = new SupabaseProjectsRepository({
      from: (table: string) => chain(table),
    } as never);

    await repo.addMember('project-1', { email: 'user2@example.com' } as never);

    const access = inserts.find((i) => i.table === 'project_access');
    expect(access).toBeDefined();
    expect(access?.payload).toEqual(
      expect.objectContaining({
        project_id: 'project-1',
        user_id: 'user-2',
        role: 'editor',
        origin: 'invited',
        has_direct_grant: true,
      }),
    );
  });
});
