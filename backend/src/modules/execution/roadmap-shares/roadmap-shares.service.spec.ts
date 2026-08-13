import { NotFoundException } from '@nestjs/common';
import { RoadmapSharesService } from './roadmap-shares.service';

describe('RoadmapSharesService preview metadata', () => {
  const repo = {
    findPreviewMetadata: jest.fn(),
  };
  const service = new RoadmapSharesService(repo as any, {} as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('maps public repository metadata to the API shape', async () => {
    repo.findPreviewMetadata.mockResolvedValueOnce({
      roadmap_id: 'roadmap-1',
      project_id: 'project-1',
      roadmap_name: 'Website refresh',
      node_id: 'task-1',
      node_type: 'task',
      node_title: 'Fix onboarding',
    });

    await expect(
      service.getPreviewMetadata('roadmap-1', 'task-1'),
    ).resolves.toEqual({
      roadmapId: 'roadmap-1',
      projectId: 'project-1',
      roadmapName: 'Website refresh',
      nodeId: 'task-1',
      nodeType: 'task',
      title: 'Fix onboarding',
    });
  });

  it('returns not found when the node is not in the roadmap', async () => {
    repo.findPreviewMetadata.mockResolvedValueOnce(null);

    await expect(
      service.getPreviewMetadata('roadmap-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
