import { NotFoundException } from '@nestjs/common';
import { RoadmapAiKnowledgeService } from './roadmap-ai-knowledge.service';

const buildService = (roadmap: unknown) => {
  const roadmapsRepo = { findById: jest.fn().mockResolvedValue(roadmap) };
  const knowledgeSearch = {
    search: jest.fn().mockResolvedValue([{ id: 'chunk-1', score: 0.5 }]),
  };
  const service = new RoadmapAiKnowledgeService(
    roadmapsRepo as never,
    knowledgeSearch as never,
  );
  return { service, roadmapsRepo, knowledgeSearch };
};

describe('RoadmapAiKnowledgeService', () => {
  it('404s (read-level authz) when the roadmap is inaccessible', async () => {
    const { service, roadmapsRepo } = buildService(null);

    await expect(
      service.searchKnowledge('roadmap-1', { id: 'intruder' }, {
        query: 'secrets',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(roadmapsRepo.findById).toHaveBeenCalledWith('roadmap-1', 'intruder');
  });

  it('returns an empty result for projectless roadmaps without touching search', async () => {
    const { service, knowledgeSearch } = buildService({
      id: 'roadmap-1',
      project_id: null,
    });

    await expect(
      service.searchKnowledge('roadmap-1', { id: 'user-1' }, {
        query: 'payments',
      } as never),
    ).resolves.toEqual({ project_id: null, query: 'payments', results: [] });
    expect(knowledgeSearch.search).not.toHaveBeenCalled();
  });

  it('delegates with project scope and the caller guest flag', async () => {
    const { service, knowledgeSearch } = buildService({
      id: 'roadmap-1',
      project_id: 'project-1',
    });

    const response = await service.searchKnowledge(
      'roadmap-1',
      { id: 'guest-1', is_guest: true },
      { query: 'payments', sources: ['chat_message'], limit: 5 } as never,
    );

    expect(knowledgeSearch.search).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'guest-1',
      isGuest: true,
      query: 'payments',
      sources: ['chat_message'],
      limit: 5,
    });
    expect(response.project_id).toBe('project-1');
    expect(response.results).toHaveLength(1);
  });
});
