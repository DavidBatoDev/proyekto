import { registerRoadmapTools } from './roadmaps.tools';
import type { McpToolDeps } from './tool-helpers';

/** Fake McpServer that captures each tool's handler by name. */
function captureServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const definitions: Record<string, any> = {};
  const server = {
    registerTool: (
      name: string,
      cfg: unknown,
      cb: (a: any) => Promise<any>,
    ) => {
      definitions[name] = cfg;
      handlers[name] = cb;
    },
  };
  return { server: server as any, handlers, definitions };
}

function depsWith(scopes: string[], services: Partial<McpToolDeps['s']> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      roadmapAi: {
        getContextSummary: jest.fn(),
        searchContextNodes: jest.fn(),
        listChangeHistory: jest.fn(() => Promise.resolve([])),
      },
      roadmaps: { findByProjectId: jest.fn(), findByUser: jest.fn() },
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

describe('MCP roadmap_list_changes', () => {
  it('denies a token without roadmaps:read and never touches the service', async () => {
    const listChangeHistory = jest.fn();
    const { server, handlers } = captureServer();
    const deps = depsWith(['projects:read'], {
      roadmapAi: { listChangeHistory } as any,
    });
    registerRoadmapTools(server, deps);

    const res = await handlers.roadmap_list_changes({
      roadmap_id: '11111111-1111-1111-1111-111111111111',
    });

    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(listChangeHistory).not.toHaveBeenCalled();
  });

  it('defaults to withholding the operations payload', async () => {
    const listChangeHistory = jest.fn(() => Promise.resolve([]));
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read'], {
      roadmapAi: { listChangeHistory } as any,
    });
    registerRoadmapTools(server, deps);

    await handlers.roadmap_list_changes({ roadmap_id: 'r1' });

    expect(listChangeHistory).toHaveBeenCalledWith('r1', 'user-1', {
      limit: 25,
      before: undefined,
      includeOperations: false,
    });
  });

  it('passes include_operations and the before cursor through', async () => {
    const listChangeHistory = jest.fn(() => Promise.resolve([]));
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read'], {
      roadmapAi: { listChangeHistory } as any,
    });
    registerRoadmapTools(server, deps);

    await handlers.roadmap_list_changes({
      roadmap_id: 'r1',
      include_operations: true,
      before: '2026-07-01T00:00:00.000Z',
      limit: 10,
    });

    expect(listChangeHistory).toHaveBeenCalledWith('r1', 'user-1', {
      limit: 10,
      before: '2026-07-01T00:00:00.000Z',
      includeOperations: true,
    });
  });

  it('clamps an oversized limit to the configured page ceiling', async () => {
    const listChangeHistory = jest.fn(() => Promise.resolve([]));
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read'], {
      roadmapAi: { listChangeHistory } as any,
      maxPageSize: 50,
    });
    registerRoadmapTools(server, deps);

    await handlers.roadmap_list_changes({ roadmap_id: 'r1', limit: 5000 });

    expect(listChangeHistory).toHaveBeenCalledWith(
      'r1',
      'user-1',
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('returns the rows under a stable `changes` key', async () => {
    const row = {
      change_id: 'c1',
      status: 'applied',
      committed_at: '2026-07-20T10:00:00.000Z',
      operations_count: 3,
    };
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read'], {
      roadmapAi: {
        listChangeHistory: jest.fn(() => Promise.resolve([row])),
      } as any,
    });
    registerRoadmapTools(server, deps);

    const res = await handlers.roadmap_list_changes({ roadmap_id: 'r1' });

    expect(isError(res)).toBeFalsy();
    expect(payload(res)).toEqual({ changes: [row] });
  });

  it('surfaces a denied roadmap as a structured error, not a raw throw', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read'], {
      roadmapAi: {
        listChangeHistory: jest.fn(async () => {
          const { ForbiddenException } = await import('@nestjs/common');
          throw new ForbiddenException('No access to this roadmap');
        }),
      } as any,
    });
    registerRoadmapTools(server, deps);

    const res = await handlers.roadmap_list_changes({ roadmap_id: 'r1' });

    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });
});

describe('MCP roadmap visual results', () => {
  const summary = {
    roadmap_id: '11111111-1111-1111-1111-111111111111',
    title: 'Launch',
    status: 'active',
    revision_token: '2026-07-29T00:00:00.000Z',
    epic_count: 1,
    feature_count: 1,
    task_count: 2,
    epics: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        title: 'MVP',
        status: 'in_progress',
        feature_count: 1,
        features: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            title: 'Sign in',
            status: 'todo',
          },
        ],
      },
    ],
    milestones: [],
  };

  it('links the summary tool to the roadmap MCP App', () => {
    const { server, definitions } = captureServer();
    registerRoadmapTools(server, depsWith(['roadmaps:read']));

    expect(definitions.roadmap_get_summary._meta).toEqual(
      expect.objectContaining({
        ui: {
          resourceUri: 'ui://proyekto/roadmap-summary-v3.html',
          visibility: ['model'],
        },
        'ui/resourceUri': 'ui://proyekto/roadmap-summary-v3.html',
      }),
    );
  });

  it('returns mixed JSON, SVG, and PNG content by default', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read'], {
      roadmapAi: {
        getContextSummary: jest.fn(() => Promise.resolve(summary)),
      } as any,
    });
    registerRoadmapTools(server, deps);

    const res = await handlers.roadmap_get_summary({
      roadmap_id: summary.roadmap_id,
    });

    expect(res.content.map((item: any) => item.type)).toEqual([
      'text',
      'resource',
      'image',
    ]);
    expect(payload(res)).toEqual(summary);
    expect(res.content[1].resource.mimeType).toBe('image/svg+xml');
    expect(res.content[1].resource.text).toContain('MVP');
    expect(res.content[2].mimeType).toBe('image/png');
    expect(
      Buffer.from(res.content[2].data, 'base64').subarray(1, 4).toString(),
    ).toBe('PNG');
  });

  it('returns the unchanged lean JSON result when visuals are disabled', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['roadmaps:read'], {
      roadmapAi: {
        getContextSummary: jest.fn(() => Promise.resolve(summary)),
      } as any,
    });
    registerRoadmapTools(server, deps);

    const res = await handlers.roadmap_get_summary({
      roadmap_id: summary.roadmap_id,
      include_visual: false,
    });

    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe('text');
    expect(payload(res)).toEqual(summary);
    expect(res.structuredContent).toEqual(summary);
  });
});
