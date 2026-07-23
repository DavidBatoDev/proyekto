import { registerRoadmapWriteTools } from './roadmap-write.tools';
import { registerTaskWriteTools } from './task-write.tools';
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
        preview: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
      },
      tasks: { create: jest.fn(), update: jest.fn() },
      taskExtras: { addComment: jest.fn() },
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

describe('MCP roadmap write tools', () => {
  it('roadmap_commit_operations denies a token without roadmaps:write', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read']);
    registerRoadmapWriteTools(server, deps);

    const res = await handlers.roadmap_commit_operations({
      roadmap_id: 'r1',
      operations: [{ op: 'add_epic' }],
      revision_token: 'tok',
      idempotency_key: 'k1',
    });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(deps.s.roadmapAi.commit).not.toHaveBeenCalled();
  });

  it('roadmap_commit_operations rejects a missing revision_token (require-preview)', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:write']);
    registerRoadmapWriteTools(server, deps);

    const res = await handlers.roadmap_commit_operations({
      roadmap_id: 'r1',
      operations: [{ op: 'add_epic' }],
      revision_token: '',
      idempotency_key: 'k1',
    });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
    expect(deps.s.roadmapAi.commit).not.toHaveBeenCalled();
  });

  it('roadmap_commit_operations rejects a missing idempotency_key', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:write']);
    registerRoadmapWriteTools(server, deps);

    const res = await handlers.roadmap_commit_operations({
      roadmap_id: 'r1',
      operations: [{ op: 'add_epic' }],
      revision_token: 'tok',
      idempotency_key: '',
    });
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
    expect(deps.s.roadmapAi.commit).not.toHaveBeenCalled();
  });

  it('roadmap_commit_operations calls the service when scope + tokens are present', async () => {
    const { server, handlers } = captureServer();
    const commit = jest
      .fn()
      .mockResolvedValue({
        change_id: 'c1',
        revision_token: 'r2',
        semantic_diff: {},
      });
    const deps = depsWith(['roadmaps:write'], {
      roadmapAi: { preview: jest.fn(), commit, rollback: jest.fn() } as any,
    });
    registerRoadmapWriteTools(server, deps);

    const res = await handlers.roadmap_commit_operations({
      roadmap_id: 'r1',
      operations: [{ op: 'add_epic' }],
      revision_token: 'tok',
      idempotency_key: 'k1',
    });
    expect(isError(res)).toBeFalsy();
    expect(commit).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        revision_token: 'tok',
        idempotency_key: 'k1',
        include_roadmap: false,
      }),
      'user-1',
    );
  });
});

describe('MCP task write tools', () => {
  it('task_assign denies a token with tasks:write but not tasks:assign', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['tasks:write']);
    registerTaskWriteTools(server, deps);

    const res = await handlers.task_assign({
      task_id: 't1',
      assignee_ids: ['u2'],
    });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(deps.s.tasks.update).not.toHaveBeenCalled();
  });

  it('task_create denies a token without tasks:write', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read']);
    registerTaskWriteTools(server, deps);

    const res = await handlers.task_create({ feature_id: 'f1', title: 'x' });
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(deps.s.tasks.create).not.toHaveBeenCalled();
  });

  it('task_assign routes through tasks.update with assignee_ids when authorized', async () => {
    const { server, handlers } = captureServer();
    const update = jest.fn().mockResolvedValue({ id: 't1' });
    const deps = depsWith(['tasks:assign'], {
      tasks: { create: jest.fn(), update } as any,
    });
    registerTaskWriteTools(server, deps);

    const res = await handlers.task_assign({
      task_id: 't1',
      assignee_ids: ['u2', 'u3'],
    });
    expect(isError(res)).toBeFalsy();
    expect(update).toHaveBeenCalledWith(
      't1',
      { assignee_ids: ['u2', 'u3'] },
      'user-1',
    );
  });
});
