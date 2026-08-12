import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const ROADMAP_SUMMARY_APP_URI = 'ui://proyekto/roadmap-summary-v4.html';
export const ROADMAP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

type LoadRoadmapAppHtml = () => Promise<string>;

function loadBundledRoadmapApp(): Promise<string> {
  return readFile(
    resolve(__dirname, '../../../mcp-apps/roadmap-summary.html'),
    'utf8',
  );
}

/** Register the static MCP App shell used to display authenticated tool data. */
export function registerRoadmapApp(
  server: McpServer,
  loadHtml: LoadRoadmapAppHtml = loadBundledRoadmapApp,
): void {
  server.registerResource(
    'Proyekto roadmap view',
    ROADMAP_SUMMARY_APP_URI,
    {
      title: 'Proyekto roadmap',
      description: 'An inline visual summary of a Proyekto roadmap.',
      mimeType: ROADMAP_APP_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: ROADMAP_SUMMARY_APP_URI,
          mimeType: ROADMAP_APP_MIME_TYPE,
          text: await loadHtml(),
        },
      ],
    }),
  );
}
