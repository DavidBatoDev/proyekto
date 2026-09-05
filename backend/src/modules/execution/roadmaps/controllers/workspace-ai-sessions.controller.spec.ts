import { WorkspaceAiSessionsController } from './workspace-ai-sessions.controller';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import type {
  CreateRoadmapAiMessageDto,
  CreateRoadmapAiSessionDto,
  ListRoadmapAiMessagesQueryDto,
  ListRoadmapAiSessionsQueryDto,
  UpdateRoadmapAiSessionAgentStateDto,
  UpdateRoadmapAiSessionDto,
} from '../dto/roadmap-ai-sessions.dto';

// Every handler must hand the service a WORKSPACE scope object — never a bare
// id — so the service's scope filter keeps roadmap threads unreachable through
// this route. The roadmap controller is the mirror image.
describe('WorkspaceAiSessionsController scope delegation', () => {
  const workspaceId = 'ws-1';
  const sessionId = 'session-1';
  const user: AuthenticatedUser = { id: 'user-1' };
  const scope = { kind: 'workspace', workspaceId } as const;

  const sessionsService = {
    list: jest.fn(),
    create: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    updateAgentState: jest.fn(),
    delete: jest.fn(),
    listMessages: jest.fn(),
    appendMessage: jest.fn(),
  };

  let controller: WorkspaceAiSessionsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WorkspaceAiSessionsController(sessionsService as never);
  });

  it('list / create pass the workspace scope first', () => {
    const listQuery: ListRoadmapAiSessionsQueryDto = { archived: false };
    void controller.list(workspaceId, listQuery, user);
    expect(sessionsService.list).toHaveBeenCalledWith(
      scope,
      user.id,
      listQuery,
    );

    const createDto: CreateRoadmapAiSessionDto = { title: 'Weekly plan' };
    void controller.create(workspaceId, createDto, user);
    expect(sessionsService.create).toHaveBeenCalledWith(
      scope,
      user.id,
      createDto,
    );
  });

  it('getOne / update / remove pass the workspace scope first', async () => {
    void controller.getOne(workspaceId, sessionId, user);
    expect(sessionsService.getById).toHaveBeenCalledWith(
      scope,
      sessionId,
      user.id,
    );

    const updateDto: UpdateRoadmapAiSessionDto = { is_pinned: true };
    void controller.update(workspaceId, sessionId, updateDto, user);
    expect(sessionsService.update).toHaveBeenCalledWith(
      scope,
      sessionId,
      user.id,
      updateDto,
    );

    await controller.remove(workspaceId, sessionId, user);
    expect(sessionsService.delete).toHaveBeenCalledWith(
      scope,
      sessionId,
      user.id,
    );
  });

  it('updateAgentState unwraps agent_state and passes the workspace scope', async () => {
    const dto: UpdateRoadmapAiSessionAgentStateDto = {
      agent_state: { pending_plan: null, recents: ['E1'] },
    };
    await controller.updateAgentState(workspaceId, sessionId, dto, user);
    expect(sessionsService.updateAgentState).toHaveBeenCalledWith(
      scope,
      sessionId,
      user.id,
      dto.agent_state,
    );
  });

  it('listMessages / appendMessage pass the workspace scope first', () => {
    const query: ListRoadmapAiMessagesQueryDto = { limit: 20, before_seq: 40 };
    void controller.listMessages(workspaceId, sessionId, query, user);
    expect(sessionsService.listMessages).toHaveBeenCalledWith(
      scope,
      sessionId,
      user.id,
      query,
    );

    const message: CreateRoadmapAiMessageDto = {
      role: 'user',
      content: 'What is overdue across my projects?',
      metadata: { refs: [{ kind: 'project', id: 'p1' }] },
    };
    void controller.appendMessage(workspaceId, sessionId, message, user);
    expect(sessionsService.appendMessage).toHaveBeenCalledWith(
      scope,
      sessionId,
      user.id,
      message,
    );
  });

  it('never passes a roadmap scope from this route', async () => {
    void controller.list(workspaceId, {}, user);
    void controller.create(workspaceId, {}, user);
    void controller.getOne(workspaceId, sessionId, user);
    void controller.update(workspaceId, sessionId, {}, user);
    await controller.updateAgentState(
      workspaceId,
      sessionId,
      { agent_state: {} },
      user,
    );
    await controller.remove(workspaceId, sessionId, user);
    void controller.listMessages(workspaceId, sessionId, {}, user);
    void controller.appendMessage(
      workspaceId,
      sessionId,
      { role: 'user', content: 'hi' },
      user,
    );

    const firstArgs = Object.values(sessionsService).flatMap((fn) =>
      fn.mock.calls.map((call: unknown[]) => call[0]),
    );
    expect(firstArgs).toHaveLength(8);
    for (const arg of firstArgs) {
      expect(arg).toEqual(scope);
      expect(arg).not.toHaveProperty('roadmapId');
    }
  });
});
