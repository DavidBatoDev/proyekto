import { registerCommentWriteTools } from './comment-write.tools';
import type { McpToolDeps } from './tool-helpers';

/** Fake McpServer that captures each tool's handler by name. */
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

function depsWith(scopes: string[], services: Partial<McpToolDeps['s']> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      epics: { addComment: jest.fn() },
      features: { addComment: jest.fn() },
      audit: { log: jest.fn() },
      db: {
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        }),
      },
      ...services,
    },
  } as unknown as McpToolDeps;
}

function isError(res: any): boolean {
  return res?.isError === true;
}
function errorCode(res: any): string {
  return JSON.parse(res.content[0].text).error;
}

describe('MCP comment write tools', () => {
  it('registers exactly the epic/feature comment tools', () => {
    const { server, handlers } = captureServer();
    registerCommentWriteTools(server, depsWith(['tasks:write']));
    expect(Object.keys(handlers).sort()).toEqual([
      'epic_comment_add',
      'feature_comment_add',
    ]);
  });

  it('epic_comment_add denies a token without tasks:write', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read']);
    registerCommentWriteTools(server, deps);

    const res = await handlers.epic_comment_add({
      epic_id: 'e1',
      content: 'hi',
    });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(deps.s.epics.addComment).not.toHaveBeenCalled();
  });

  it('feature_comment_add denies a token without tasks:write', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:write']);
    registerCommentWriteTools(server, deps);

    const res = await handlers.feature_comment_add({
      feature_id: 'f1',
      content: 'hi',
    });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(deps.s.features.addComment).not.toHaveBeenCalled();
  });

  it('epic_comment_add routes through epics.addComment when authorized', async () => {
    const { server, handlers } = captureServer();
    const addComment = jest.fn().mockResolvedValue({ id: 'ec1' });
    const deps = depsWith(['tasks:write'], {
      epics: { addComment } as any,
    });
    registerCommentWriteTools(server, deps);

    const res = await handlers.epic_comment_add({
      epic_id: 'e1',
      content: 'Scope confirmed.',
    });
    expect(isError(res)).toBeFalsy();
    expect(addComment).toHaveBeenCalledWith(
      'e1',
      { content: 'Scope confirmed.' },
      'user-1',
    );
  });

  it('feature_comment_add routes through features.addComment when authorized', async () => {
    const { server, handlers } = captureServer();
    const addComment = jest.fn().mockResolvedValue({ id: 'fc1' });
    const deps = depsWith(['tasks:write'], {
      features: { addComment } as any,
    });
    registerCommentWriteTools(server, deps);

    const res = await handlers.feature_comment_add({
      feature_id: 'f1',
      content: 'Deliverable ready.',
    });
    expect(isError(res)).toBeFalsy();
    expect(addComment).toHaveBeenCalledWith(
      'f1',
      { content: 'Deliverable ready.' },
      'user-1',
    );
  });
});
