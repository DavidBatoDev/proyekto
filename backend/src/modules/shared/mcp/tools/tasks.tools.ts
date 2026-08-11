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

  defineTool(
    server,
    'task_comments_list',
    {
      title: 'List task comments',
      description:
        'List the comments on a task, oldest first, with author names. Returns the most recent `limit` comments and the total count.',
      inputSchema: {
        task_id: z.string().uuid(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ task_id, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:read');
        // View permission is asserted inside findComments.
        const all = (await deps.s.taskExtras.findComments(
          task_id,
          uid,
        )) as Array<{
          id: string;
          task_id: string;
          content: string;
          created_at: string;
          edited_at: string | null;
          author?: { id: string; display_name: string | null } | null;
        }>;
        // Rows come back ascending; keep the newest N so long threads stay
        // useful, and whitelist fields (no avatar URLs / raw author_id).
        const capped = all.slice(-clampLimit(limit, deps.s.maxPageSize, 50));
        return {
          total: all.length,
          comments: capped.map((c) => ({
            id: c.id,
            task_id: c.task_id,
            content: c.content,
            author: c.author
              ? { id: c.author.id, display_name: c.author.display_name }
              : null,
            created_at: c.created_at,
            edited_at: c.edited_at,
          })),
        };
      }),
  );
}
