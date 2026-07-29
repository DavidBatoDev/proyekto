import { registerTaskTools } from './tasks.tools';
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
      roadmapAi: {
        getContextTasksAssignedToMe: jest.fn(),
        getContextTasksFiltered: jest.fn(),
      },
      taskExtras: { findComments: jest.fn() },
      maxPageSize: 100,
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
function payload(res: any): any {
  return JSON.parse(res.content[0].text);
}

function commentRow(i: number) {
  return {
    id: `c${i}`,
    task_id: 't1',
    author_id: 'raw-author-id',
    content: `comment ${i}`,
    created_at: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    edited_at: null,
    author: {
      id: `u${i}`,
      display_name: `User ${i}`,
      avatar_url: 'https://cdn/avatar.png',
    },
  };
}

describe('MCP task_comments_list', () => {
  it('denies a token without roadmaps:read', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['tasks:write']);
    registerTaskTools(server, deps);

    const res = await handlers.task_comments_list({ task_id: 't1' });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(deps.s.taskExtras.findComments).not.toHaveBeenCalled();
  });

  it('delegates to taskExtras.findComments and whitelists fields', async () => {
    const { server, handlers } = captureServer();
    const findComments = jest.fn().mockResolvedValue([commentRow(1)]);
    const deps = depsWith(['roadmaps:read'], {
      taskExtras: { findComments } as any,
    });
    registerTaskTools(server, deps);

    const res = await handlers.task_comments_list({ task_id: 't1' });
    expect(isError(res)).toBeFalsy();
    expect(findComments).toHaveBeenCalledWith('t1', 'user-1');

    const body = payload(res);
    expect(body.total).toBe(1);
    expect(body.comments[0]).toEqual({
      id: 'c1',
      task_id: 't1',
      content: 'comment 1',
      author: { id: 'u1', display_name: 'User 1' },
      created_at: commentRow(1).created_at,
      edited_at: null,
    });
    // Raw author_id and avatar_url must not leak through the projection.
    expect(body.comments[0].author_id).toBeUndefined();
    expect(body.comments[0].author.avatar_url).toBeUndefined();
  });

  it('keeps the newest N comments with the true total (default limit 50)', async () => {
    const { server, handlers } = captureServer();
    const rows = Array.from({ length: 60 }, (_, i) => commentRow(i));
    const deps = depsWith(['roadmaps:read'], {
      taskExtras: { findComments: jest.fn().mockResolvedValue(rows) } as any,
    });
    registerTaskTools(server, deps);

    const res = await handlers.task_comments_list({ task_id: 't1' });
    const body = payload(res);
    expect(body.total).toBe(60);
    expect(body.comments).toHaveLength(50);
    // Ascending input → the slice keeps the tail (newest) rows.
    expect(body.comments[0].id).toBe('c10');
    expect(body.comments[49].id).toBe('c59');
  });

  it('handles a null author gracefully', async () => {
    const { server, handlers } = captureServer();
    const row = { ...commentRow(1), author: null };
    const deps = depsWith(['roadmaps:read'], {
      taskExtras: { findComments: jest.fn().mockResolvedValue([row]) } as any,
    });
    registerTaskTools(server, deps);

    const res = await handlers.task_comments_list({ task_id: 't1' });
    expect(payload(res).comments[0].author).toBeNull();
  });
});
