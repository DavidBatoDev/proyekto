import { RoadmapAiController } from './roadmap-ai.controller';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import type {
  RoadmapAiCommitDto,
  RoadmapAiContextChildrenQueryDto,
  RoadmapAiContextFeaturesQueryDto,
  RoadmapAiContextPreviewSelectorQueryDto,
  RoadmapAiContextResolutionChildrenQueryDto,
  RoadmapAiContextSearchQueryDto,
  RoadmapAiContextTasksAssignedQueryDto,
  RoadmapAiContextTasksFilterQueryDto,
  RoadmapAiPreviewDto,
} from '../dto/roadmap-ai.dto';
import type { RoadmapAiProjectMeetingsQueryDto } from '../dto/roadmap-ai-project-context.dto';

describe('RoadmapAiController trace forwarding', () => {
  const roadmapId = 'roadmap-1';
  const user: AuthenticatedUser = { id: 'user-1' };
  const traceId = 'trace-123';
  const previewDto: RoadmapAiPreviewDto = { operations: [] };
  const searchQuery: RoadmapAiContextSearchQueryDto = {
    query: 'platform foundation',
  };
  const summaryQuery: RoadmapAiContextPreviewSelectorQueryDto = {};
  const childrenQuery: RoadmapAiContextChildrenQueryDto = { limit: 10 };
  const resolutionChildrenQuery: RoadmapAiContextResolutionChildrenQueryDto = {
    choice: 1,
    limit: 10,
  };
  const featuresQuery: RoadmapAiContextFeaturesQueryDto = {
    epic_id: 'epic-1',
    limit: 10,
  };
  const tasksQuery: RoadmapAiContextTasksAssignedQueryDto = {
    status: 'open',
    limit: 10,
  };
  const filteredTasksQuery: RoadmapAiContextTasksFilterQueryDto = {
    status: 'done',
    include_completed: 'false',
  };
  const projectMeetingsQuery: RoadmapAiProjectMeetingsQueryDto = {
    window: 'upcoming',
    limit: 5,
  };

  const roadmapAiService = {
    preview: jest.fn(),
    getPreview: jest.fn(),
    getContextSummary: jest.fn(),
    getContextActor: jest.fn(),
    searchContextNodes: jest.fn(),
    getContextNodeDetails: jest.fn(),
    getContextNodeChildren: jest.fn(),
    getContextChildrenFromResolution: jest.fn(),
    getContextFeatures: jest.fn(),
    getContextTasksAssignedToMe: jest.fn(),
    getContextTasksFiltered: jest.fn(),
    commit: jest.fn(),
    discard: jest.fn(),
    rollback: jest.fn(),
  };
  const projectContextService = {
    getProjectContext: jest.fn(),
    getProjectBrief: jest.fn(),
    getProjectResources: jest.fn(),
    getProjectMeetings: jest.fn(),
    getMemberDetails: jest.fn(),
  };
  const knowledgeService = {
    searchKnowledge: jest.fn(),
  };

  let controller: RoadmapAiController;

  beforeEach(() => {
    jest.clearAllMocks();
    const memoriesService = {
      list: jest.fn(),
      create: jest.fn(),
      deactivate: jest.fn(),
      relevant: jest.fn(),
    };
    controller = new RoadmapAiController(
      roadmapAiService as never,
      memoriesService as never,
      projectContextService as never,
      knowledgeService as never,
    );
  });

  it('forwards trace id for preview/search and all context handlers', () => {
    void controller.preview(roadmapId, previewDto, user, traceId);
    expect(roadmapAiService.preview).toHaveBeenCalledWith(
      roadmapId,
      previewDto,
      user.id,
      traceId,
    );

    void controller.getPreview(roadmapId, 'preview-1', user, traceId);
    expect(roadmapAiService.getPreview).toHaveBeenCalledWith(
      roadmapId,
      'preview-1',
      user.id,
      traceId,
    );

    void controller.getContextSummary(roadmapId, summaryQuery, user, traceId);
    expect(roadmapAiService.getContextSummary).toHaveBeenCalledWith(
      roadmapId,
      summaryQuery,
      user.id,
      traceId,
    );

    void controller.getContextActor(roadmapId, user, traceId);
    expect(roadmapAiService.getContextActor).toHaveBeenCalledWith(
      roadmapId,
      user.id,
      traceId,
    );

    void controller.getProjectContext(roadmapId, user, traceId);
    expect(projectContextService.getProjectContext).toHaveBeenCalledWith(
      roadmapId,
      user.id,
      traceId,
    );

    void controller.getProjectBrief(roadmapId, user, traceId);
    expect(projectContextService.getProjectBrief).toHaveBeenCalledWith(
      roadmapId,
      user.id,
      traceId,
    );

    void controller.getProjectResources(roadmapId, user, traceId);
    expect(projectContextService.getProjectResources).toHaveBeenCalledWith(
      roadmapId,
      user.id,
      traceId,
    );

    void controller.getProjectMeetings(
      roadmapId,
      projectMeetingsQuery,
      user,
      traceId,
    );
    expect(projectContextService.getProjectMeetings).toHaveBeenCalledWith(
      roadmapId,
      user.id,
      projectMeetingsQuery,
      traceId,
    );

    void controller.getProjectMemberDetails(
      roadmapId,
      'member-1',
      user,
      traceId,
    );
    expect(projectContextService.getMemberDetails).toHaveBeenCalledWith(
      roadmapId,
      'member-1',
      user.id,
      traceId,
    );

    const knowledgeQuery = { query: 'payments', limit: 5 };
    void controller.searchKnowledge(
      roadmapId,
      knowledgeQuery as never,
      user,
      traceId,
    );
    expect(knowledgeService.searchKnowledge).toHaveBeenCalledWith(
      roadmapId,
      user,
      knowledgeQuery,
      traceId,
    );

    void controller.searchContextNodes(roadmapId, searchQuery, user, traceId);
    expect(roadmapAiService.searchContextNodes).toHaveBeenCalledWith(
      roadmapId,
      searchQuery,
      user.id,
      traceId,
    );

    void controller.getContextNodeDetails(roadmapId, 'node-1', user, traceId);
    expect(roadmapAiService.getContextNodeDetails).toHaveBeenCalledWith(
      roadmapId,
      'node-1',
      user.id,
      traceId,
    );

    void controller.getContextNodeChildren(
      roadmapId,
      'node-1',
      childrenQuery,
      user,
      traceId,
    );
    expect(roadmapAiService.getContextNodeChildren).toHaveBeenCalledWith(
      roadmapId,
      'node-1',
      childrenQuery,
      user.id,
      traceId,
    );

    void controller.getContextResolutionChildren(
      roadmapId,
      'resolution-1',
      resolutionChildrenQuery,
      user,
      traceId,
    );
    expect(
      roadmapAiService.getContextChildrenFromResolution,
    ).toHaveBeenCalledWith(
      roadmapId,
      'resolution-1',
      resolutionChildrenQuery,
      user.id,
      traceId,
    );

    void controller.getContextFeatures(roadmapId, featuresQuery, user, traceId);
    expect(roadmapAiService.getContextFeatures).toHaveBeenCalledWith(
      roadmapId,
      featuresQuery,
      user.id,
      traceId,
    );

    void controller.getContextTasksAssignedToMe(
      roadmapId,
      tasksQuery,
      user,
      traceId,
    );
    expect(roadmapAiService.getContextTasksAssignedToMe).toHaveBeenCalledWith(
      roadmapId,
      tasksQuery,
      user.id,
      traceId,
    );

    void controller.getContextTasksFiltered(
      roadmapId,
      filteredTasksQuery,
      user,
      traceId,
    );
    expect(roadmapAiService.getContextTasksFiltered).toHaveBeenCalledWith(
      roadmapId,
      filteredTasksQuery,
      user.id,
      traceId,
    );
  });

  it('returns preview response with operation_results serialization fields', async () => {
    const previewResponse = {
      preview_id: '11111111-1111-1111-1111-111111111111',
      base_updated_at: '2026-04-11T00:00:00.000Z',
      revision_token: '2026-04-11T00:00:00.000Z',
      semantic_diff: { summary: {}, changes: [] },
      validation_issues: [],
      candidate_snapshot: {},
      operation_results: [
        {
          operation_index: 0,
          temp_id: 'tmp_epic_1',
          assigned_id: '22222222-2222-2222-2222-222222222222',
          node_type: 'epic',
        },
      ],
    };
    roadmapAiService.preview.mockResolvedValue(previewResponse);

    const result = await controller.preview(
      roadmapId,
      previewDto,
      user,
      traceId,
    );

    expect(result).toEqual(previewResponse);
    expect(result.operation_results).toEqual([
      expect.objectContaining({
        temp_id: 'tmp_epic_1',
        assigned_id: '22222222-2222-2222-2222-222222222222',
        node_type: 'epic',
      }),
    ]);
  });

  it('returns commit response with operation_results and timeline temp_id_mapping', async () => {
    const commitDto: RoadmapAiCommitDto = { operations: [] };
    const commitResponse = {
      change_id: '33333333-3333-3333-3333-333333333333',
      committed_at: '2026-04-11T00:01:00.000Z',
      revision_token: '2026-04-11T00:01:00.000Z',
      semantic_diff: { summary: {}, changes: [] },
      candidate_snapshot: {},
      roadmap: {},
      operation_results: [
        {
          operation_index: 1,
          temp_id: 'tmp_feature_1',
          assigned_id: '44444444-4444-4444-4444-444444444444',
          node_type: 'feature',
        },
      ],
      timeline: [
        {
          change_id: '33333333-3333-3333-3333-333333333333',
          committed_at: '2026-04-11T00:01:00.000Z',
          status: 'applied',
          operations_count: 2,
          semantic_diff: { summary: {}, changes: [] },
          temp_id_mapping: {
            tmp_feature_1: '44444444-4444-4444-4444-444444444444',
          },
        },
      ],
    };
    roadmapAiService.commit.mockResolvedValue(commitResponse);

    const result = await controller.commit(roadmapId, commitDto, user);

    expect(result).toEqual(commitResponse);
    expect(result.operation_results).toEqual([
      expect.objectContaining({
        temp_id: 'tmp_feature_1',
        assigned_id: '44444444-4444-4444-4444-444444444444',
        node_type: 'feature',
      }),
    ]);
    expect(result.timeline[0].temp_id_mapping).toEqual({
      tmp_feature_1: '44444444-4444-4444-4444-444444444444',
    });
  });
});
