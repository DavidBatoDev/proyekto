import { registerResources } from './resources';
import type { McpToolDeps } from './tools/tool-helpers';

function captureServer() {
  const handlers: Record<string, (uri: URL, vars: any) => Promise<any>> = {};
  const server = {
    registerResource: (
      name: string,
      _template: unknown,
      _definition: unknown,
      callback: (uri: URL, vars: any) => Promise<any>,
    ) => {
      handlers[name] = callback;
    },
  };
  return { server: server as any, handlers };
}

function deps(summary: Record<string, unknown>): McpToolDeps {
  return {
    caller: { userId: 'user-1', scopes: ['roadmaps:read'] },
    s: {
      roadmapAi: {
        getContextSummary: jest.fn(() => Promise.resolve(summary)),
      },
    },
  } as unknown as McpToolDeps;
}

describe('MCP roadmap visual resources', () => {
  const roadmapId = '11111111-1111-1111-1111-111111111111';
  const summary = {
    roadmap_id: roadmapId,
    title: 'Launch',
    epic_count: 0,
    feature_count: 0,
    task_count: 0,
    epics: [],
    milestones: [],
  };

  it('returns an authorized SVG resource', async () => {
    const { server, handlers } = captureServer();
    registerResources(server, deps(summary));
    const uri = new URL(`proyekto://roadmaps/${roadmapId}/visual.svg`);

    const result = await handlers['roadmap-visual-svg'](uri, { roadmapId });

    expect(result.contents[0]).toEqual(
      expect.objectContaining({
        uri: uri.href,
        mimeType: 'image/svg+xml',
      }),
    );
    expect(result.contents[0].text).toContain('<svg');
    expect(result.contents[0].text).toContain('Launch');
  });

  it('returns a PNG blob resource derived from the same summary', async () => {
    const { server, handlers } = captureServer();
    registerResources(server, deps(summary));
    const uri = new URL(`proyekto://roadmaps/${roadmapId}/visual.png`);

    const result = await handlers['roadmap-visual-png'](uri, { roadmapId });
    const png = Buffer.from(result.contents[0].blob, 'base64');

    expect(result.contents[0].mimeType).toBe('image/png');
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it('requires roadmaps:read before fetching a visual', async () => {
    const { server, handlers } = captureServer();
    const unauthorized = deps(summary);
    unauthorized.caller.scopes = [];
    registerResources(server, unauthorized);
    const uri = new URL(`proyekto://roadmaps/${roadmapId}/visual.svg`);

    await expect(
      handlers['roadmap-visual-svg'](uri, { roadmapId }),
    ).rejects.toEqual(expect.objectContaining({ code: 'FORBIDDEN' }));
    // The injected service method is a Jest mock and does not depend on `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(unauthorized.s.roadmapAi.getContextSummary).not.toHaveBeenCalled();
  });
});
