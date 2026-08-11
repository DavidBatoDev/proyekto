import { SupabaseChatRepository } from './chat.repository.supabase';

function query(response: { data: unknown; error: unknown }) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'limit']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(response).then(resolve);
  return builder;
}

function repository(data: unknown) {
  const supabase = {
    from: jest.fn(() => query({ data, error: null })),
  };
  return {
    repository: new SupabaseChatRepository(supabase as any),
    supabase,
  };
}

describe('SupabaseChatRepository project_access personas', () => {
  it.each([
    ['consultant', 'consultant'],
    ['client', 'client'],
    ['personal_workspace', 'client'],
    ['legacy', 'client'],
    ['invited', 'freelancer'],
    ['team:studio-1', 'freelancer'],
  ])('maps %s origin to %s', async (origin, expected) => {
    const { repository: repo } = repository([{ role: 'owner', origin }]);
    await expect(repo.resolveProjectRole('project-1', 'user-1')).resolves.toBe(
      expected,
    );
  });

  it('prefers a non-team origin when multiple rows are returned', async () => {
    const { repository: repo } = repository([
      { role: 'editor', origin: 'team:studio-1' },
      { role: 'owner', origin: 'legacy' },
    ]);
    await expect(repo.resolveProjectRole('project-1', 'user-1')).resolves.toBe(
      'client',
    );
  });

  it('does not fall back to projects when no access row exists', async () => {
    const { repository: repo, supabase } = repository([]);
    await expect(repo.isProjectMember('project-1', 'user-1')).resolves.toBe(
      false,
    );
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('project_access');
  });
});
