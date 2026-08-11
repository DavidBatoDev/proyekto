import {
  ROADMAP_APP_MIME_TYPE,
  ROADMAP_SUMMARY_APP_URI,
  registerRoadmapApp,
} from './roadmap-app';

function captureServer() {
  const definitions: Record<string, any> = {};
  const handlers: Record<string, () => Promise<any>> = {};
  const server = {
    registerResource: (
      name: string,
      _uri: unknown,
      definition: unknown,
      callback: () => Promise<any>,
    ) => {
      definitions[name] = definition;
      handlers[name] = callback;
    },
  };
  return { server: server as any, definitions, handlers };
}

describe('MCP roadmap app resource', () => {
  it('serves a self-contained MCP App HTML resource', async () => {
    const html =
      '<!doctype html><main data-proyekto-roadmap-app>Roadmap</main>';
    const { server, definitions, handlers } = captureServer();
    registerRoadmapApp(server, () => Promise.resolve(html));

    expect(definitions['Proyekto roadmap view']).toEqual(
      expect.objectContaining({ mimeType: ROADMAP_APP_MIME_TYPE }),
    );

    const result = await handlers['Proyekto roadmap view']();
    expect(result.contents).toEqual([
      {
        uri: ROADMAP_SUMMARY_APP_URI,
        mimeType: ROADMAP_APP_MIME_TYPE,
        text: html,
      },
    ]);
  });
});
