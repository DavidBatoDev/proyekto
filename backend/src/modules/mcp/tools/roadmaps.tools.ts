import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createRoadmapVisual, type RoadmapVisualKind } from '../roadmap-visual';
import {
  clampLimit,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

const nodeType = z.enum(['epic', 'feature', 'task']);

function visualResult(
  kind: RoadmapVisualKind,
  uri: string,
  includeVisual: boolean | undefined,
) {
  return {
    enabled: includeVisual !== false,
    create: (data: unknown) => createRoadmapVisual(kind, data, uri),
  };
}

function normalizeNodeType(
  value: unknown,
): 'epic' | 'feature' | 'task' | undefined {
  return value === 'epic' || value === 'feature' || value === 'task'
    ? value
    : undefined;
}

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
        'List roadmaps with a compact portfolio visual by default. With a project_id, returns that project’s roadmap; without one, returns the roadmaps you own. Set include_visual=false for JSON only.',
      inputSchema: {
        project_id: z.string().uuid().optional(),
        include_visual: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, include_visual }) =>
      runTool(
        async () => {
          requireScope(deps.caller, 'roadmaps:read');
          if (project_id) {
            const roadmap: unknown = await deps.s.roadmaps.findByProjectId(
              project_id,
              uid,
            );
            return { roadmaps: roadmap ? [roadmap] : [] };
          }
          const roadmaps = await deps.s.roadmaps.findByUser(uid, uid);
          return { roadmaps };
        },
        visualResult(
          'list',
          'proyekto://roadmaps/visual/list.svg',
          include_visual,
        ),
      ),
  );

  defineTool(
    server,
    'roadmap_get_summary',
    {
      title: 'Get roadmap summary',
      description:
        'Get a compact tree summary and visual of a roadmap: counts, epics, features, and milestones. Set include_visual=false for JSON only.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        include_visual: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ roadmap_id, include_visual }) =>
      runTool(
        async () => {
          requireScope(deps.caller, 'roadmaps:read');
          return deps.s.roadmapAi.getContextSummary(roadmap_id, {}, uid);
        },
        visualResult(
          'summary',
          `proyekto://roadmaps/${roadmap_id}/visual.svg`,
          include_visual,
        ),
      ),
  );

  defineTool(
    server,
    'roadmap_get_node',
    {
      title: 'Get roadmap node',
      description:
        'Get the details and a visual of a single roadmap node (epic, feature, task, or milestone), optionally with its immediate children. Set include_visual=false for JSON only.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        node_id: z.string().uuid(),
        include_children: z.boolean().optional(),
        children_limit: z.number().int().min(1).optional(),
        include_visual: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      roadmap_id,
      node_id,
      include_children,
      children_limit,
      include_visual,
    }) =>
      runTool(
        async () => {
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
        },
        visualResult(
          'node',
          `proyekto://roadmaps/${roadmap_id}/nodes/${node_id}/visual.svg`,
          include_visual,
        ),
      ),
  );

  defineTool(
    server,
    'roadmap_search_nodes',
    {
      title: 'Search roadmap nodes',
      description:
        'Search a roadmap’s epics, features, and tasks by title/keyword and return a ranked visual. Set include_visual=false for JSON only.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        query: z.string().min(1),
        node_type: nodeType.optional(),
        limit: z.number().int().min(1).optional(),
        include_visual: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ roadmap_id, query, node_type, limit, include_visual }) =>
      runTool(
        async () => {
          requireScope(deps.caller, 'roadmaps:read');
          return deps.s.roadmapAi.searchContextNodes(
            roadmap_id,
            {
              query: typeof query === 'string' ? query : '',
              node_type: normalizeNodeType(node_type),
              limit: clampLimit(limit, deps.s.maxPageSize, 20),
            },
            uid,
          );
        },
        visualResult(
          'search',
          `proyekto://roadmaps/${roadmap_id}/search/visual.svg`,
          include_visual,
        ),
      ),
  );

  defineTool(
    server,
    'roadmap_list_changes',
    {
      title: 'List roadmap changes',
      description:
        'List committed changes to a roadmap as JSON and a timeline visual by default, newest first — who changed it, when, and what the change did. Set include_operations to see exact operations, include_visual=false for JSON only, and `before` to page backwards. A listed change is not necessarily revertable: see roadmap_revert_change.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        limit: z.number().int().min(1).optional(),
        before: z.string().optional(),
        include_operations: z.boolean().optional(),
        include_visual: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ roadmap_id, limit, before, include_operations, include_visual }) =>
      runTool(
        async () => {
          requireScope(deps.caller, 'roadmaps:read');
          const changes = await deps.s.roadmapAi.listChangeHistory(
            roadmap_id,
            uid,
            {
              limit: clampLimit(limit, deps.s.maxPageSize, 25),
              before: typeof before === 'string' ? before : undefined,
              includeOperations: include_operations === true,
            },
          );
          return { changes };
        },
        visualResult(
          'changes',
          `proyekto://roadmaps/${roadmap_id}/changes/visual.svg`,
          include_visual,
        ),
      ),
  );
}
