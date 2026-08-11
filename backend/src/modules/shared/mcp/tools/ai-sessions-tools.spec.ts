import { registerAiSessionTools } from './ai-sessions.tools';
import type { McpToolDeps } from './tool-helpers';

function captureServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const server = {
    registerTool: (
      name: string,
      _cfg: unknown,
      cb: (a: any) => Promise<any>,
    ) => {
      handlers[name] = cb;
    },
  };
  return { server: server as any, handlers };
}

function depsWith(scopes: string[], aiSessions: Record<string, unknown> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      aiSessions: {
        list: jest.fn(async () => []),
        listMessages: jest.fn(async () => []),
        ...aiSessions,
      },
      maxPageSize: 100,
    },
  } as unknown as McpToolDeps;
}

function isError(res: any): boolean {
  return res?.isError === true;
}
function errorCode(res: any): string {
  return JSON.parse(res.content[0].text).error;
}
/** The raw serialized tool output — asserting on the string, not the parsed
 * object, is what catches a leak nested somewhere unexpected. */
function raw(res: any): string {
  return res.content[0].text;
}

describe('MCP ai-sessions read tools', () => {
  it('denies both tools without ai-sessions:read', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read']);
    registerAiSessionTools(server, deps);

    const list = await handlers.roadmap_ai_sessions_list({
      roadmap_id: 'r1',
    });
    const messages = await handlers.roadmap_ai_session_messages({
      roadmap_id: 'r1',
      session_id: 's1',
    });

    expect(errorCode(list)).toBe('FORBIDDEN');
    expect(errorCode(messages)).toBe('FORBIDDEN');
    expect(deps.s.aiSessions.list).not.toHaveBeenCalled();
    expect(deps.s.aiSessions.listMessages).not.toHaveBeenCalled();
  });

  it('never leaks internal agent state from a session row', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['ai-sessions:read'], {
      list: jest.fn(async () => [
        {
          id: 's1',
          roadmap_id: 'r1',
          title: 'Plan Q3',
          mode: 'chat',
          is_archived: false,
          is_pinned: false,
          last_message_at: '2026-07-20T00:00:00Z',
          message_count: 4,
          created_at: '2026-07-19T00:00:00Z',
          updated_at: '2026-07-20T00:00:00Z',
          // Everything below must be withheld.
          user_id: 'user-1',
          archived_at: null,
          pinned_at: null,
          metadata: {
            agent_state: {
              pending_plan: 'SECRET-CANARY',
              change_history: [{ node: 'SNAPSHOT-CANARY' }],
            },
          },
        },
      ]),
    });
    registerAiSessionTools(server, deps);

    const res = await handlers.roadmap_ai_sessions_list({ roadmap_id: 'r1' });

    expect(isError(res)).toBeFalsy();
    const text = raw(res);
    expect(text).not.toContain('SECRET-CANARY');
    expect(text).not.toContain('SNAPSHOT-CANARY');
    expect(text).not.toContain('agent_state');
    expect(text).not.toContain('pending_plan');
    expect(text).not.toContain('user_id');

    const session = JSON.parse(text).sessions[0];
    expect(session).toEqual({
      id: 's1',
      roadmap_id: 'r1',
      title: 'Plan Q3',
      mode: 'chat',
      is_archived: false,
      is_pinned: false,
      last_message_at: '2026-07-20T00:00:00Z',
      message_count: 4,
      created_at: '2026-07-19T00:00:00Z',
      updated_at: '2026-07-20T00:00:00Z',
    });
  });

  it('never leaks unvalidated agent jsonb from a message row', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['ai-sessions:read'], {
      listMessages: jest.fn(async () => [
        {
          id: 'm1',
          seq: 7,
          role: 'assistant',
          content: 'Here is the plan',
          intent_type: 'edit',
          created_at: '2026-07-20T00:00:00Z',
          // Withheld: free-form, no backend validator shape.
          session_id: 's1',
          response_mode: 'stream',
          parse_mode: 'json',
          tokens: 812,
          artifacts: [{ secret: 'ARTIFACT-CANARY' }],
          activity_timeline: [{ tool: 'TRACE-CANARY' }],
          commit_lifecycle: { state: 'LIFECYCLE-CANARY' },
          metadata: { internal: 'META-CANARY' },
        },
      ]),
    });
    registerAiSessionTools(server, deps);

    const res = await handlers.roadmap_ai_session_messages({
      roadmap_id: 'r1',
      session_id: 's1',
    });

    const text = raw(res);
    for (const canary of [
      'ARTIFACT-CANARY',
      'TRACE-CANARY',
      'LIFECYCLE-CANARY',
      'META-CANARY',
      'activity_timeline',
      'commit_lifecycle',
      'tokens',
    ]) {
      expect(text).not.toContain(canary);
    }

    expect(JSON.parse(text).messages[0]).toEqual({
      id: 'm1',
      seq: 7,
      role: 'assistant',
      content: 'Here is the plan',
      intent_type: 'edit',
      created_at: '2026-07-20T00:00:00Z',
    });
  });

  it('clamps limits to the service DTO ceilings', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['ai-sessions:read']);
    registerAiSessionTools(server, deps);

    await handlers.roadmap_ai_sessions_list({
      roadmap_id: 'r1',
      limit: 5000,
    });
    await handlers.roadmap_ai_session_messages({
      roadmap_id: 'r1',
      session_id: 's1',
      limit: 5000,
    });

    expect(deps.s.aiSessions.list).toHaveBeenCalledWith(
      'r1',
      'user-1',
      expect.objectContaining({ limit: 100 }),
    );
    expect(deps.s.aiSessions.listMessages).toHaveBeenCalledWith(
      'r1',
      's1',
      'user-1',
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('offers a backward cursor only on a full backward page', async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      seq: i + 10,
      role: 'user',
      content: 'hi',
      created_at: '2026-07-20T00:00:00Z',
    }));
    const { server, handlers } = captureServer();
    const deps = depsWith(['ai-sessions:read'], {
      listMessages: jest.fn(async () => page),
    });
    registerAiSessionTools(server, deps);

    const full = await handlers.roadmap_ai_session_messages({
      roadmap_id: 'r1',
      session_id: 's1',
    });
    // Rows come back ascending, so the oldest is the next cursor.
    expect(JSON.parse(raw(full)).next_before_seq).toBe(10);

    // Forward paging has no backward cursor to offer.
    const forward = await handlers.roadmap_ai_session_messages({
      roadmap_id: 'r1',
      session_id: 's1',
      after_seq: 5,
    });
    expect(JSON.parse(raw(forward)).next_before_seq).toBeNull();
  });

  it('passes the seq cursors through untouched', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['ai-sessions:read']);
    registerAiSessionTools(server, deps);

    await handlers.roadmap_ai_session_messages({
      roadmap_id: 'r1',
      session_id: 's1',
      before_seq: 42,
    });

    expect(deps.s.aiSessions.listMessages).toHaveBeenCalledWith(
      'r1',
      's1',
      'user-1',
      expect.objectContaining({ before_seq: 42 }),
    );
  });
});
