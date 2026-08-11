import { NotFoundException } from '@nestjs/common';
import { RoadmapAiSessionsService } from './roadmap-ai-sessions.service';

type MockFn = jest.Mock;

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

const buildService = (
  builder: QueryBuilder,
  options: { roadmapFindByIdResult?: unknown } = {},
) => {
  const dbFrom = jest.fn().mockReturnValue(builder);
  const db = { from: dbFrom } as unknown as Parameters<
    typeof Reflect.construct
  >[1];

  const roadmapsRepo = {
    findById: jest.fn().mockResolvedValue(
      options.roadmapFindByIdResult === undefined
        ? { id: 'roadmap-1' }
        : options.roadmapFindByIdResult,
    ),
  };

  const titleGenerator = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  const service = new RoadmapAiSessionsService(
    db as never,
    roadmapsRepo as never,
    titleGenerator as never,
  );
  return { service, dbFrom, roadmapsRepo, titleGenerator };
};

describe('RoadmapAiSessionsService', () => {
  it('returns 404 when another user tries to read a session that exists but belongs to someone else', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = null; // maybeSingle resolves null — classic scoped-404
    const { service } = buildService(builder);

    await expect(
      service.getById('roadmap-1', 'session-1', 'other-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list ignores archived rows by default', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = [];
    const { service } = buildService(builder);

    await service.list('roadmap-1', 'user-1', {});

    // Expect `.eq('is_archived', false)` to have been set on the chain.
    const calls = (builder.eq as MockFn).mock.calls;
    expect(
      calls.some(([col, val]) => col === 'is_archived' && val === false),
    ).toBe(true);
  });

  it('triggers title generation after the first assistant turn when title is null', async () => {
    // Stage: getById returns a session with message_count === 1 and null title
    // (the trigger ran after the user turn). append returns the assistant
    // row. After the insert, seed messages are fetched.
    const existingSession = {
      id: 'session-1',
      roadmap_id: 'roadmap-1',
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

    await service.appendMessage('roadmap-1', 'session-1', 'user-1', {
      role: 'assistant',
      content: 'here you go',
    });

    expect(titleGenerator.enqueue).toHaveBeenCalledWith('session-1');
  });

  describe('updateAgentState', () => {
    it('rejects snapshots over the 64KB cap', async () => {
      const builder = new QueryBuilder();
      builder.__resolveData = { id: 'session-1', metadata: {} };
      const { service } = buildService(builder);

      await expect(
        service.updateAgentState('roadmap-1', 'session-1', 'user-1', {
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

      await service.updateAgentState('roadmap-1', 'session-1', 'user-1', {
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
        service.updateAgentState('roadmap-1', 'session-1', 'intruder', {
          a: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
