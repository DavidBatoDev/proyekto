import { AiContextKnowledgeService } from './ai-context-knowledge.service';

function buildService(accessible: string[]) {
  const repo = {
    filterProjectIdsByWorkspace: jest.fn().mockResolvedValue([]),
  };
  const roadmapsRepo = {
    getAccessibleProjectIds: jest.fn().mockResolvedValue(accessible),
  };
  const knowledgeSearch = {
    searchAcrossProjects: jest
      .fn()
      .mockResolvedValue([{ id: 'chunk-1', project_id: 'p-1', score: 0.5 }]),
  };
  const service = new AiContextKnowledgeService(
    repo as never,
    roadmapsRepo as never,
    knowledgeSearch as never,
  );
  return { service, repo, roadmapsRepo, knowledgeSearch };
}

describe('AiContextKnowledgeService', () => {
  it('drops inaccessible ids in one bulk read and forwards the accessible subset', async () => {
    const { service, knowledgeSearch, roadmapsRepo } = buildService([
      'p-1',
      'p-2',
    ]);

    const response = await service.search(
      { id: 'user-1' },
      {
        q: 'payments',
        project_ids: ['p-1', 'p-3', 'p-1'],
        sources: ['chat_message'],
        limit: 5,
      },
    );

    expect(roadmapsRepo.getAccessibleProjectIds).toHaveBeenCalledTimes(1);
    expect(knowledgeSearch.searchAcrossProjects).toHaveBeenCalledWith({
      projectIds: ['p-1'],
      userId: 'user-1',
      isGuest: false,
      query: 'payments',
      sources: ['chat_message'],
      limit: 5,
    });
    expect(response).toEqual({
      project_ids: ['p-1'],
      query: 'payments',
      results: [{ id: 'chunk-1', project_id: 'p-1', score: 0.5 }],
    });
  });

  it('returns a stable empty result without touching search when nothing is accessible', async () => {
    const { service, knowledgeSearch } = buildService(['p-1']);

    await expect(
      service.search({ id: 'user-1' }, { q: 'secrets', project_ids: ['p-9'] }),
    ).resolves.toEqual({ project_ids: [], query: 'secrets', results: [] });
    expect(knowledgeSearch.searchAcrossProjects).not.toHaveBeenCalled();

    const none = buildService([]);
    await expect(
      none.service.search({ id: 'user-1' }, { q: 'anything' }),
    ).resolves.toEqual({ project_ids: [], query: 'anything', results: [] });
    expect(none.knowledgeSearch.searchAcrossProjects).not.toHaveBeenCalled();
  });

  it('defaults to every accessible project, narrows by workspace, and forwards the guest flag', async () => {
    const { service, repo, knowledgeSearch } = buildService(['p-1', 'p-2']);
    repo.filterProjectIdsByWorkspace.mockResolvedValue(['p-2']);

    const response = await service.search(
      { id: 'guest-1', is_guest: true },
      { q: 'roadmap', workspace_id: 'ws-1' },
    );

    expect(repo.filterProjectIdsByWorkspace).toHaveBeenCalledWith(
      ['p-1', 'p-2'],
      'ws-1',
    );
    expect(knowledgeSearch.searchAcrossProjects).toHaveBeenCalledWith({
      projectIds: ['p-2'],
      userId: 'guest-1',
      isGuest: true,
      query: 'roadmap',
      sources: undefined,
      limit: undefined,
    });
    expect(response.project_ids).toEqual(['p-2']);
  });
});
