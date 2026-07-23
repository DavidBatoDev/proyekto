import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  clampLimit,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

const nodeType = z.enum(['epic', 'feature', 'task']);

/**
 * Roadmap graph read tools. Gated by `roadmaps:read`; the underlying context
 * reads are view-level authorized per roadmap (Phase-0 G2), so an outsider gets
 * a FORBIDDEN/NOT_FOUND rather than data.
 */
export function registerRoadmapTools(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'roadmaps_list',
    {
      title: 'List roadmaps',
      description:
        'List roadmaps. With a project_id, returns that project’s roadmap; without one, returns the roadmaps you own.',
      inputSchema: { project_id: z.string().uuid().optional() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:read');
        if (project_id) {
          const roadmap = await deps.s.roadmaps.findByProjectId(
            project_id,
            uid,
          );
          return { roadmaps: roadmap ? [roadmap] : [] };
        }
        const roadmaps = await deps.s.roadmaps.findByUser(uid, uid);
        return { roadmaps };
      }),
  );

  defineTool(
    server,
    'roadmap_get_summary',
    {
      title: 'Get roadmap summary',
      description:
        'Get a compact tree summary of a roadmap: counts, epics, features, and milestones.',
      inputSchema: { roadmap_id: z.string().uuid() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ roadmap_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:read');
        return deps.s.roadmapAi.getContextSummary(roadmap_id, {}, uid);
      }),
  );

  defineTool(
    server,
    'roadmap_get_node',
    {
      title: 'Get roadmap node',
      description:
        'Get the details of a single roadmap node (epic, feature, task, or milestone), optionally with its immediate children.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        node_id: z.string().uuid(),
        include_children: z.boolean().optional(),
        children_limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ roadmap_id, node_id, include_children, children_limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:read');
        const node = await deps.s.roadmapAi.getContextNodeDetails(
          roadmap_id,
          node_id,
          uid,
        );
        if (!include_children) return { node };
        const children = await deps.s.roadmapAi.getContextNodeChildren(
          roadmap_id,
          node_id,
          { limit: clampLimit(children_limit, deps.s.maxPageSize, 50) },
          uid,
        );
        return { node, children };
      }),
  );

  defineTool(
    server,
    'roadmap_search_nodes',
    {
      title: 'Search roadmap nodes',
      description:
        'Search a roadmap’s epics, features, and tasks by title/keyword and resolve references to node ids.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        query: z.string().min(1),
        node_type: nodeType.optional(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ roadmap_id, query, node_type, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:read');
        return deps.s.roadmapAi.searchContextNodes(
          roadmap_id,
          {
            query,
            node_type,
            limit: clampLimit(limit, deps.s.maxPageSize, 20),
          },
          uid,
        );
      }),
  );
}
