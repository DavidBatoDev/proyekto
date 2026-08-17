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

describe('SupabaseChatRepository project access', () => {
  // The origin→persona mapping suite that used to live here is gone along with
  // `roleFromOrigin` / `resolveProjectRole`. It asserted that a `consultant`
  // origin resolved to a consultant and everything else to a client or a
  // freelancer — a derivation the execution layer no longer makes. Project
  // membership is now the only question this repository asks of `project_access`.

  it('does not fall back to projects when no access row exists', async () => {
    const { repository: repo, supabase } = repository([]);
    await expect(repo.isProjectMember('project-1', 'user-1')).resolves.toBe(
      false,
    );
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('project_access');
  });
});
