import { AiContextController } from './ai-context.controller';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import type { RoadmapAiProjectMeetingsQueryDto } from '../roadmaps/dto/roadmap-ai-project-context.dto';
import type {
  AiContextChangesQueryDto,
  AiContextKnowledgeSearchQueryDto,
  AiContextOverviewQueryDto,
  AiContextResolveRefsDto,
  AiContextRoadmapsQueryDto,
  AiContextSearchQueryDto,
  AiContextTasksQueryDto,
} from './dto/ai-context.dto';

describe('AiContextController trace forwarding', () => {
  const user: AuthenticatedUser = { id: 'user-1' };
  const traceId = 'trace-123';
  const projectId = '11111111-1111-4111-8111-111111111111';
  const memberId = '22222222-2222-4222-8222-222222222222';

  const overviewQuery: AiContextOverviewQueryDto = { workspace_id: 'ws-1' };
  const roadmapsQuery: AiContextRoadmapsQueryDto = { limit: 10 };
  const searchQuery: AiContextSearchQueryDto = { q: 'platform', limit: 5 };
  const tasksQuery: AiContextTasksQueryDto = {
    assigned_to_me: true,
    status: 'open',
  };
  const knowledgeQuery: AiContextKnowledgeSearchQueryDto = {
    q: 'payments',
    limit: 5,
  };
  const refsDto: AiContextResolveRefsDto = {
    refs: [{ kind: 'task', id: memberId }],
  };
  const meetingsQuery: RoadmapAiProjectMeetingsQueryDto = {
    window: 'upcoming',
    limit: 5,
  };
  const changesQuery: AiContextChangesQueryDto = { run_id: projectId };

  const aiContextService = {
    getActor: jest.fn(),
    getOverview: jest.fn(),
    listRoadmaps: jest.fn(),
    search: jest.fn(),
    listTasks: jest.fn(),
    listChanges: jest.fn(),
  };
  const refsService = { resolve: jest.fn() };
  const knowledgeService = { search: jest.fn() };
  const projectService = {
    getContext: jest.fn(),
    getBrief: jest.fn(),
    getResources: jest.fn(),
    getMeetings: jest.fn(),
    listMembers: jest.fn(),
    getMemberDetails: jest.fn(),
  };

  let controller: AiContextController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiContextController(
      aiContextService as never,
      refsService as never,
      knowledgeService as never,
      projectService as never,
    );
  });

  it('forwards user id and trace id for the user-scoped reads', () => {
    void controller.getActor(user, traceId);
    expect(aiContextService.getActor).toHaveBeenCalledWith(user.id, traceId);

    void controller.getOverview(overviewQuery, user, traceId);
    expect(aiContextService.getOverview).toHaveBeenCalledWith(
      user,
      overviewQuery,
      traceId,
    );

    void controller.listRoadmaps(roadmapsQuery, user, traceId);
    expect(aiContextService.listRoadmaps).toHaveBeenCalledWith(
      user.id,
      roadmapsQuery,
      traceId,
    );

    void controller.search(searchQuery, user, traceId);
    expect(aiContextService.search).toHaveBeenCalledWith(
      user.id,
      searchQuery,
      traceId,
    );

    void controller.listTasks(tasksQuery, user, traceId);
    expect(aiContextService.listTasks).toHaveBeenCalledWith(
      user.id,
      tasksQuery,
      traceId,
    );

    void controller.listChanges(changesQuery, user, traceId);
    expect(aiContextService.listChanges).toHaveBeenCalledWith(
      user.id,
      changesQuery,
      traceId,
    );
  });

  it('forwards the whole user (guest flag) to knowledge search and the body to resolve-refs untouched', async () => {
    const guest: AuthenticatedUser = { id: 'guest-1', is_guest: true };
    void controller.searchKnowledge(knowledgeQuery, guest, traceId);
    expect(knowledgeService.search).toHaveBeenCalledWith(
      guest,
      knowledgeQuery,
      traceId,
    );

    const resolved = {
      refs: [{ kind: 'task', id: memberId, accessible: true }],
    };
    refsService.resolve.mockResolvedValue(resolved);
    await expect(controller.resolveRefs(refsDto, user, traceId)).resolves.toBe(
      resolved,
    );
    expect(refsService.resolve).toHaveBeenCalledWith(user.id, refsDto, traceId);
  });

  it('passes projectId first for every project-keyed handler', () => {
    void controller.getProjectContext(projectId, user, traceId);
    expect(projectService.getContext).toHaveBeenCalledWith(
      projectId,
      user.id,
      traceId,
    );

    void controller.getProjectBrief(projectId, user, traceId);
    expect(projectService.getBrief).toHaveBeenCalledWith(
      projectId,
      user.id,
      traceId,
    );

    void controller.getProjectResources(projectId, user, traceId);
    expect(projectService.getResources).toHaveBeenCalledWith(
      projectId,
      user.id,
      traceId,
    );

    void controller.getProjectMeetings(projectId, meetingsQuery, user, traceId);
    expect(projectService.getMeetings).toHaveBeenCalledWith(
      projectId,
      user.id,
      meetingsQuery,
      traceId,
    );

    void controller.listProjectMembers(projectId, user, traceId);
    expect(projectService.listMembers).toHaveBeenCalledWith(
      projectId,
      user.id,
      traceId,
    );

    void controller.getProjectMemberDetails(projectId, memberId, user, traceId);
    expect(projectService.getMemberDetails).toHaveBeenCalledWith(
      projectId,
      memberId,
      user.id,
      traceId,
    );
  });
});
