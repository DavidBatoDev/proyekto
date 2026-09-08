import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createRoadmapVisual, type RoadmapVisualKind } from '../roadmap-visual';
import { ROADMAP_SUMMARY_APP_URI } from '../roadmap-app';
import {
  clampLimit,
  clampOffset,
  defineAppTool,
  defineTool,
  fetchWindow,
  pageFetchedList,
  pageFromStart,
  pagingClause,
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
        'List the roadmaps you can access (owned, or shared with you through a project), with a compact portfolio visual by default. Set include_visual=false for JSON only.' +
        pagingClause(25, 25),
      inputSchema: {
        include_visual: z.boolean().optional(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      include_visual,
      limit,
      offset,
    }: {
      include_visual?: boolean;
      limit?: number;
      offset?: number;
    }) =>
      runTool(
        async () => {
          requireScope(deps.caller, 'roadmaps:read');
          // Owner UNION project_access — the same set the web dashboard
          // shows. `findByUser` is owner-only and would hide shared roadmaps.
          const roadmaps = await deps.s.roadmaps.findAll(uid);
          return pageFromStart(roadmaps, 'roadmaps', {
            offset: clampOffset(offset),
            limit: clampLimit(limit, deps.s.maxPageSize, 25),
            complete: true,
          });
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
    'roadmap_get_by_project',
    {
      title: "Get project's roadmap",
      description:
        'Get the single roadmap linked to this project. Projects have at most one linked roadmap; returns roadmap: null if none exists yet. Set include_visual=false for JSON only.',
      inputSchema: {
        project_id: z.string().uuid(),
        include_visual: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, include_visual }) =>
      runTool(
        async () => {
          requireScope(deps.caller, 'roadmaps:read');
          const roadmap: unknown = await deps.s.roadmaps.findByProjectId(
            project_id,
            uid,
          );
          return { roadmap: roadmap ?? null };
        },
        {
          enabled: include_visual !== false,
          create: (data) =>
            createRoadmapVisual(
              'list',
              {
                roadmaps: (data as { roadmap: unknown }).roadmap
                  ? [(data as { roadmap: unknown }).roadmap]
                  : [],
              },
              `proyekto://roadmaps/visual/by-project/${project_id}.svg`,
            ),
        },
      ),
  );

  defineAppTool(
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
      _meta: {
        ui: {
          resourceUri: ROADMAP_SUMMARY_APP_URI,
          visibility: ['model'],
        },
      },
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
        children_offset: z.number().int().min(0).optional(),
        include_visual: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      roadmap_id,
      node_id,
      include_children,
      children_limit,
      children_offset,
      include_visual,
    }: {
      roadmap_id: string;
      node_id: string;
      include_children?: boolean;
      children_limit?: number;
      children_offset?: number;
      include_visual?: boolean;
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
          const limit = clampLimit(children_limit, deps.s.maxPageSize, 50);
          const offset = clampOffset(children_offset);
          // The reader takes a limit and returns from the start, so fetch the
          // page plus a probe row and slice.
          const window = fetchWindow(offset, limit, 100);
          const result = (await deps.s.roadmapAi.getContextNodeChildren(
            roadmap_id,
            node_id,
            { limit: window },
            uid,
          )) as unknown as Record<string, unknown>;
          return {
            node,
            ...pageFetchedList(result, 'children', { offset, limit, window }),
          };
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
        'Search a roadmap’s epics, features, and tasks by title/keyword and return a ranked visual. Set include_visual=false for JSON only.' +
        pagingClause(50, 20),
      inputSchema: {
        roadmap_id: z.string().uuid(),
        query: z.string().min(1),
        node_type: nodeType.optional(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
        include_visual: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      roadmap_id,
      query,
      node_type,
      limit,
      offset,
      include_visual,
    }: {
      roadmap_id: string;
      query: string;
      node_type?: string;
      limit?: number;
      offset?: number;
      include_visual?: boolean;
    }) =>
      runTool(
        async () => {
          requireScope(deps.caller, 'roadmaps:read');
          const size = clampLimit(limit, deps.s.maxPageSize, 20);
          const start = clampOffset(offset);
          const window = fetchWindow(start, size, 50);
          const result = (await deps.s.roadmapAi.searchContextNodes(
            roadmap_id,
            {
              query: typeof query === 'string' ? query : '',
              node_type: normalizeNodeType(node_type),
              limit: window,
            },
            uid,
          )) as unknown as Record<string, unknown>;
          // `resolution_id`'s choice indexes address the reader's own list, so
          // it is only meaningful on the first page.
          if (start > 0) delete result.resolution_id;
          return pageFetchedList(result, 'matches', {
            offset: start,
            limit: size,
            window,
          });
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
        'List committed changes to a roadmap as JSON and a timeline visual by default, newest first — who changed it, when, and what the change did. Set include_operations to see exact operations, include_visual=false for JSON only, and `before` to page backwards — pass the returned `next_before` to continue. A listed change is not necessarily revertable: see roadmap_revert_change.',
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
          const size = clampLimit(limit, deps.s.maxPageSize, 25);
          const changes = await deps.s.roadmapAi.listChangeHistory(
            roadmap_id,
            uid,
            {
              limit: size,
              before: typeof before === 'string' ? before : undefined,
              includeOperations: include_operations === true,
            },
          );
          // Keyset paging: hand back the cursor for the next page rather than
          // making the host read it off the last row.
          const oldest = changes[changes.length - 1] as
            | { committed_at?: string }
            | undefined;
          return {
            changes,
            returned_changes: changes.length,
            next_before:
              changes.length >= size && oldest?.committed_at
                ? oldest.committed_at
                : null,
          };
        },
        visualResult(
          'changes',
          `proyekto://roadmaps/${roadmap_id}/changes/visual.svg`,
          include_visual,
        ),
      ),
  );
}
