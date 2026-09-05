import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateRoadmapAiMessageDto,
  MESSAGE_METADATA_TOO_LARGE_CODE,
  type AiSessionScope,
} from '../dto/roadmap-ai-sessions.dto';
import { RoadmapAiSessionsService } from './roadmap-ai-sessions.service';

type MockFn = jest.Mock;

const roadmapScope: AiSessionScope = {
  kind: 'roadmap',
  roadmapId: 'roadmap-1',
};
const workspaceScope: AiSessionScope = {
  kind: 'workspace',
  workspaceId: 'ws-1',
};

// Minimal fluent builder that the Supabase js client returns. Each method
// returns `this` and the terminal resolver is controlled by the test via
// `__resolve` / `__error` state so individual tests can stage outcomes.
class QueryBuilder {
  __resolveData: unknown = null;
  __resolveError: unknown = null;
  select = jest.fn().mockReturnThis();
  insert = jest.fn().mockReturnThis();
  update = jest.fn().mockReturnThis();
  delete = jest.fn().mockReturnThis();
  eq = jest.fn().mockReturnThis();
  lt = jest.fn().mockReturnThis();
  gt = jest.fn().mockReturnThis();
  order = jest.fn().mockReturnThis();
  limit = jest.fn().mockReturnThis();
  is = jest.fn().mockReturnThis();
  maybeSingle = jest.fn().mockImplementation(async () => ({
    data: this.__resolveData,
    error: this.__resolveError,
  }));
  single = jest.fn().mockImplementation(async () => ({
    data: this.__resolveData,
    error: this.__resolveError,
  }));
  // When no terminal is called, awaiting the builder itself acts as `.then`.
  then(
    onFulfilled: (result: { data: unknown; error: unknown }) => unknown,
    onRejected?: (err: unknown) => unknown,
  ) {
    return Promise.resolve({
      data: this.__resolveData,
      error: this.__resolveError,
    }).then(onFulfilled, onRejected);
  }
}

const eqPairs = (builder: QueryBuilder): [string, unknown][] =>
  (builder.eq as MockFn).mock.calls.map(([col, val]) => [col, val]);

const hasEq = (builder: QueryBuilder, col: string, val: unknown) =>
  eqPairs(builder).some(([c, v]) => c === col && v === val);

const buildService = (
  builder: QueryBuilder,
  options: {
    roadmapFindByIdResult?: unknown;
    workspaceIsMember?: boolean;
  } = {},
) => {
  const dbFrom = jest.fn().mockReturnValue(builder);
  const db = { from: dbFrom } as unknown as Parameters<
    typeof Reflect.construct
  >[1];

  const roadmapsRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(
        options.roadmapFindByIdResult === undefined
          ? { id: 'roadmap-1' }
          : options.roadmapFindByIdResult,
      ),
  };

  const titleGenerator = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  const workspaces = {
    isMember: jest.fn().mockResolvedValue(options.workspaceIsMember ?? true),
  };

  const service = new RoadmapAiSessionsService(
    db as never,
    roadmapsRepo as never,
    titleGenerator as never,
    workspaces as never,
  );
  return { service, dbFrom, roadmapsRepo, titleGenerator, workspaces };
};

describe('RoadmapAiSessionsService', () => {
  it('returns 404 when another user tries to read a session that exists but belongs to someone else', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = null; // maybeSingle resolves null — classic scoped-404
    const { service } = buildService(builder);

    await expect(
      service.getById(roadmapScope, 'session-1', 'other-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list ignores archived rows by default', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = [];
    const { service } = buildService(builder);

    await service.list(roadmapScope, 'user-1', {});

    // Expect `.eq('is_archived', false)` to have been set on the chain.
    expect(hasEq(builder, 'is_archived', false)).toBe(true);
  });

  it('triggers title generation after the first assistant turn when title is null', async () => {
    // Stage: getById returns a session with message_count === 1 and null title
    // (the trigger ran after the user turn). append returns the assistant
    // row. After the insert, seed messages are fetched.
    const existingSession = {
      id: 'session-1',
      roadmap_id: 'roadmap-1',
      workspace_id: null,
      scope: 'roadmap',
      user_id: 'user-1',
      title: null,
      message_count: 1,
      created_at: '',
      updated_at: '',
      last_message_at: null,
      mode: 'chat',
      is_archived: false,
      archived_at: null,
      is_pinned: false,
      pinned_at: null,
      metadata: {},
    };

    const insertedMessage = {
      id: 'msg-2',
      session_id: 'session-1',
      seq: 2,
      role: 'assistant',
      content: 'here you go',
      intent_type: null,
      response_mode: null,
      parse_mode: null,
      artifacts: null,
      activity_timeline: null,
      commit_lifecycle: null,
      tokens: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };

    const queryResults = [
      existingSession, // getById.maybeSingle
      insertedMessage, // insert.select.single
      [
        // loadSeedMessages terminal
        { role: 'user', content: 'hello', seq: 1 },
        { role: 'assistant', content: 'here you go', seq: 2 },
      ],
    ];

    const builder = new QueryBuilder();
    const getDataFor = () => queryResults.shift();
    builder.maybeSingle = jest
      .fn()
      .mockImplementation(async () => ({ data: getDataFor(), error: null }));
    builder.single = jest
      .fn()
      .mockImplementation(async () => ({ data: getDataFor(), error: null }));
    builder.then = ((onFulfilled, onRejected) =>
      Promise.resolve({ data: getDataFor(), error: null }).then(
        onFulfilled,
        onRejected,
      )) as QueryBuilder['then'];

    const { service, titleGenerator } = buildService(builder);

    await service.appendMessage(roadmapScope, 'session-1', 'user-1', {
      role: 'assistant',
      content: 'here you go',
    });

    expect(titleGenerator.enqueue).toHaveBeenCalledWith('session-1');
  });

  describe('roadmap scope', () => {
    it('404s (Roadmap not found) before touching the table when the roadmap is not viewable', async () => {
      const builder = new QueryBuilder();
      const { service, dbFrom, workspaces } = buildService(builder, {
        roadmapFindByIdResult: null,
      });

      await expect(
        service.list(roadmapScope, 'outsider', {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ message: 'Roadmap not found' }),
      });
      expect(dbFrom).not.toHaveBeenCalled();
      expect(workspaces.isMember).not.toHaveBeenCalled();
    });

    it('create inserts scope=roadmap with workspace_id null', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = { id: 'session-1' };
      const { service, roadmapsRepo } = buildService(builder);

      await service.create(roadmapScope, 'user-1', { title: 'Sprint 12' });

      expect(roadmapsRepo.findById).toHaveBeenCalledWith('roadmap-1', 'user-1');
      const payload = (builder.insert as MockFn).mock.calls[0][0];
      expect(payload).toEqual({
        scope: 'roadmap',
        roadmap_id: 'roadmap-1',
        workspace_id: null,
        user_id: 'user-1',
        title: 'Sprint 12',
        mode: 'chat',
        last_message_at: expect.any(String),
      });
    });

    it('list / getById pin the roadmap id AND the scope discriminator', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = [];
      const { service } = buildService(builder);

      await service.list(roadmapScope, 'user-1', {});
      expect(hasEq(builder, 'roadmap_id', 'roadmap-1')).toBe(true);
      expect(hasEq(builder, 'scope', 'roadmap')).toBe(true);
      expect(eqPairs(builder).some(([c]) => c === 'workspace_id')).toBe(false);

      const one = new QueryBuilder();
      one.__resolveData = { id: 'session-1', metadata: {} };
      const { service: service2 } = buildService(one);
      await service2.getById(roadmapScope, 'session-1', 'user-1');
      expect(hasEq(one, 'id', 'session-1')).toBe(true);
      expect(hasEq(one, 'roadmap_id', 'roadmap-1')).toBe(true);
      expect(hasEq(one, 'scope', 'roadmap')).toBe(true);
      expect(hasEq(one, 'user_id', 'user-1')).toBe(true);
      expect(eqPairs(one).some(([c]) => c === 'workspace_id')).toBe(false);
    });
  });

  describe('workspace scope', () => {
    it('list gates on workspace membership and filters by workspace_id + scope', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = [];
      const { service, workspaces, roadmapsRepo } = buildService(builder);

      await service.list(workspaceScope, 'user-1', { archived: true });

      expect(workspaces.isMember).toHaveBeenCalledWith('ws-1', 'user-1');
      expect(roadmapsRepo.findById).not.toHaveBeenCalled();
      expect(hasEq(builder, 'workspace_id', 'ws-1')).toBe(true);
      expect(hasEq(builder, 'scope', 'workspace')).toBe(true);
      expect(hasEq(builder, 'user_id', 'user-1')).toBe(true);
      expect(hasEq(builder, 'is_archived', true)).toBe(true);
      expect(eqPairs(builder).some(([c]) => c === 'roadmap_id')).toBe(false);
    });

    it('create inserts scope=workspace with roadmap_id null', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = { id: 'session-2' };
      const { service } = buildService(builder);

      const row = await service.create(workspaceScope, 'user-1', {
        mode: 'plan_proposal',
      });

      expect(row).toEqual({ id: 'session-2' });
      const payload = (builder.insert as MockFn).mock.calls[0][0];
      expect(payload).toEqual({
        scope: 'workspace',
        roadmap_id: null,
        workspace_id: 'ws-1',
        user_id: 'user-1',
        title: null,
        mode: 'plan_proposal',
        last_message_at: expect.any(String),
      });
    });

    it('404s (Workspace not found) for a non-member before touching the table', async () => {
      const builder = new QueryBuilder();
      const { service, dbFrom } = buildService(builder, {
        workspaceIsMember: false,
      });

      for (const attempt of [
        () => service.list(workspaceScope, 'outsider', {}),
        () => service.create(workspaceScope, 'outsider', {}),
        () => service.getById(workspaceScope, 'session-1', 'outsider'),
        () => service.delete(workspaceScope, 'session-1', 'outsider'),
        () => service.listMessages(workspaceScope, 'session-1', 'outsider', {}),
      ]) {
        await expect(attempt()).rejects.toMatchObject({
          response: expect.objectContaining({
            message: 'Workspace not found',
          }),
        });
      }
      expect(dbFrom).not.toHaveBeenCalled();
    });

    it('a roadmap thread is not reachable through the workspace route (cross-route 404)', async () => {
      // The row exists and belongs to the caller, but the workspace-route
      // filter (`workspace_id = ws-1 AND scope = workspace`) excludes it, so
      // the DB returns no row. Assert the filter is what the query carries.
      const builder = new QueryBuilder();
      builder.__resolveData = null;
      const { service } = buildService(builder);

      await expect(
        service.getById(workspaceScope, 'roadmap-thread', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(hasEq(builder, 'id', 'roadmap-thread')).toBe(true);
      expect(hasEq(builder, 'workspace_id', 'ws-1')).toBe(true);
      expect(hasEq(builder, 'scope', 'workspace')).toBe(true);
      expect(eqPairs(builder).some(([c]) => c === 'roadmap_id')).toBe(false);
    });

    it('and vice versa: a workspace thread is not reachable through the roadmap route', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = null;
      const { service } = buildService(builder);

      await expect(
        service.update(roadmapScope, 'workspace-thread', 'user-1', {
          title: 'renamed',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(hasEq(builder, 'roadmap_id', 'roadmap-1')).toBe(true);
      expect(hasEq(builder, 'scope', 'roadmap')).toBe(true);
      // Ownership check failed, so no update was issued.
      expect(builder.update).not.toHaveBeenCalled();
    });

    it('delete on a workspace thread goes through the workspace-scoped lookup', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = { id: 'session-2', metadata: {} };
      const { service, workspaces } = buildService(builder);

      await service.delete(workspaceScope, 'session-2', 'user-1');

      expect(workspaces.isMember).toHaveBeenCalledWith('ws-1', 'user-1');
      expect(hasEq(builder, 'workspace_id', 'ws-1')).toBe(true);
      expect(hasEq(builder, 'scope', 'workspace')).toBe(true);
      expect(builder.delete).toHaveBeenCalled();
      const deleteFilters = eqPairs(builder).slice(-2);
      expect(deleteFilters).toEqual([
        ['id', 'session-2'],
        ['user_id', 'user-1'],
      ]);
    });
  });

  describe('updateAgentState', () => {
    it('rejects snapshots over the 64KB cap', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = { id: 'session-1', metadata: {} };
      const { service } = buildService(builder);

      await expect(
        service.updateAgentState(roadmapScope, 'session-1', 'user-1', {
          blob: 'x'.repeat(70_000),
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AGENT_STATE_TOO_LARGE' }),
      });
    });

    it('merges agent_state into existing metadata instead of replacing it', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = {
        id: 'session-1',
        metadata: { some_other_key: 'kept' },
      };
      const { service } = buildService(builder);

      await service.updateAgentState(roadmapScope, 'session-1', 'user-1', {
        pending_plan: { summary: 's' },
      });

      const updatePayload = (builder.update as MockFn).mock.calls.at(-1)?.[0];
      expect(updatePayload.metadata.some_other_key).toBe('kept');
      expect(updatePayload.metadata.agent_state.pending_plan.summary).toBe('s');
    });

    it('404s when the session belongs to someone else', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = null;
      const { service } = buildService(builder);

      await expect(
        service.updateAgentState(roadmapScope, 'session-1', 'intruder', {
          a: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('persists agent_state on a workspace session through the workspace lookup', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = {
        id: 'session-2',
        scope: 'workspace',
        workspace_id: 'ws-1',
        roadmap_id: null,
        metadata: { conversation_summary: 'kept' },
      };
      const { service, workspaces, roadmapsRepo } = buildService(builder);

      await service.updateAgentState(workspaceScope, 'session-2', 'user-1', {
        loaded_roadmaps: ['r1', 'r2'],
      });

      expect(workspaces.isMember).toHaveBeenCalledWith('ws-1', 'user-1');
      expect(roadmapsRepo.findById).not.toHaveBeenCalled();
      expect(hasEq(builder, 'workspace_id', 'ws-1')).toBe(true);
      expect(hasEq(builder, 'scope', 'workspace')).toBe(true);
      const updatePayload = (builder.update as MockFn).mock.calls.at(-1)?.[0];
      expect(updatePayload.metadata).toEqual({
        conversation_summary: 'kept',
        agent_state: { loaded_roadmaps: ['r1', 'r2'] },
      });
    });
  });
});

describe('CreateRoadmapAiMessageDto metadata guard', () => {
  const buildDto = (metadata: unknown) =>
    plainToInstance(CreateRoadmapAiMessageDto, {
      role: 'user',
      content: 'hello',
      metadata,
    });

  it('accepts metadata under the 64KB ceiling and no metadata at all', async () => {
    expect(
      await validate(buildDto({ refs: [{ kind: 'epic', id: 'e1' }] })),
    ).toHaveLength(0);
    expect(await validate(buildDto(undefined))).toHaveLength(0);
  });

  it('rejects metadata over 64KB serialized with the MESSAGE_METADATA_TOO_LARGE code', async () => {
    const errors = await validate(buildDto({ blob: 'x'.repeat(70_000) }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('metadata');
    const messages = Object.values(errors[0].constraints ?? {});
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(MESSAGE_METADATA_TOO_LARGE_CODE);
  });
});
