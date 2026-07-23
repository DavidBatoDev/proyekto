import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  assertProjectViewer,
  requireScope,
  type McpToolDeps,
} from './tools/tool-helpers';

/**
 * Addressable read resources — a convenience mirror of the read tools for hosts
 * that prefetch/cite entities by id. Each is backed by the same authorized
 * façade the tools use; nothing is cached (authenticated data).
 */
export function registerResources(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  const json = (uri: string, data: unknown) => ({
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  });

  server.registerResource(
    'projects',
    'proyekto://projects',
    {
      title: 'My projects',
      description: 'Every Proyekto project you can access.',
      mimeType: 'application/json',
    },
    async (uri) => {
      requireScope(deps.caller, 'projects:read');
      const projects = await deps.s.projects.listUserProjects(uid);
      return json(uri.href, { projects });
    },
  );

  server.registerResource(
    'project',
    new ResourceTemplate('proyekto://projects/{projectId}', {
      list: undefined,
    }),
    {
      title: 'Project detail',
      description: 'A project’s details plus your effective permissions on it.',
      mimeType: 'application/json',
    },
    async (uri, { projectId }) => {
      requireScope(deps.caller, 'projects:read');
      const id = String(projectId);
      const permissions = await assertProjectViewer(deps, id);
      const project = await deps.s.projects.getProject(id);
      return json(uri.href, { project, my_permissions: permissions });
    },
  );

  server.registerResource(
    'roadmap-summary',
    new ResourceTemplate('proyekto://roadmaps/{roadmapId}/summary', {
      list: undefined,
    }),
    {
      title: 'Roadmap summary',
      description: 'A compact tree summary of a roadmap.',
      mimeType: 'application/json',
    },
    async (uri, { roadmapId }) => {
      requireScope(deps.caller, 'roadmaps:read');
      const summary = await deps.s.roadmapAi.getContextSummary(
        String(roadmapId),
        {},
        uid,
      );
      return json(uri.href, summary);
    },
  );
}
