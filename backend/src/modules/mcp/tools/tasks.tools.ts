import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  clampLimit,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

const taskStatus = z.enum([
  'open',
  'all',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
]);

/**
 * Task read tool. Gated by `roadmaps:read`; the context reads are view-level
 * authorized per roadmap. `assigned_to_me` routes to the assigned-tasks reader
 * so the model can answer "what's on my plate".
 */
export function registerTaskTools(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'tasks_list',
    {
      title: 'List roadmap tasks',
      description:
        'List tasks in a roadmap, filtered by status, parent, assignee, or keyword. Set assigned_to_me to list only tasks assigned to you.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        assigned_to_me: z.boolean().optional(),
        status: taskStatus.optional(),
        parent_type: z.enum(['epic', 'feature']).optional(),
        parent_id: z.string().uuid().optional(),
        assignee_id: z.string().uuid().optional(),
        keyword: z.string().optional(),
        include_completed: z.boolean().optional(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:read');
        const limit = clampLimit(args.limit, deps.s.maxPageSize, 50);

        if (args.assigned_to_me) {
          return deps.s.roadmapAi.getContextTasksAssignedToMe(
            args.roadmap_id,
            {
              status: args.status === 'all' ? 'all' : 'open',
              limit,
            },
            uid,
          );
        }

        return deps.s.roadmapAi.getContextTasksFiltered(
          args.roadmap_id,
          {
            status: args.status,
            parent_type: args.parent_type,
            parent_id: args.parent_id,
            assignee_id: args.assignee_id,
            keyword: args.keyword,
            include_completed: args.include_completed ? 'true' : undefined,
            limit,
          },
          uid,
        );
      }),
  );
}
