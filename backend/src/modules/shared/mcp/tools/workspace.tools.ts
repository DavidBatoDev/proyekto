import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  cappedList,
  clampLimit,
  clampOffset,
  defineTool,
  pageFromBackend,
  pagingClause,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Cross-roadmap reads, the MCP twins of the agent's `list_my_tasks`,
 * `search_everything` and `get_workspace_overview`. Every other read tool here
 * answers about ONE roadmap or ONE project; these answer about everything the
 * caller can reach, which is what a host needs for "what's on my plate" or
 * "where does X live".
 *
 * They delegate to `AiContextService` — the same reader the in-app assistant
 * uses — so the offset paging, the authorization and the lane tagging are the
 * ones already in production rather than a second implementation. Authorization
 * needs no gate here: every read starts from the caller's accessible roadmap
 * and project sets and silently drops anything it cannot attribute, so an
 * inaccessible item is invisible rather than forbidden.
 *
 * `search_everything` and `workspace_overview_get` return project rows AND
 * roadmap rows, so they require both read scopes; a token holding only one must
 * not learn titles from the other half.
 */
const TASK_STATUS = [
  'open',
  'all',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
] as const;

const DUE_WINDOWS = ['overdue', 'today', 'week', 'all'] as const;

const SEARCH_KINDS = ['project', 'roadmap', 'epic', 'feature', 'task'] as const;

/** `due` -> the service's date filters (the agent's `_DUE_WINDOWS` arithmetic). */
function dueFilters(due: string | undefined): {
  overdue?: boolean;
  due_after?: string;
  due_before?: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  if (due === 'overdue') return { overdue: true };
  if (due === 'today') return { due_after: today, due_before: today };
  if (due === 'week') {
    const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return { due_after: today, due_before: week };
  }
  return {};
}

export function registerWorkspaceTools(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'my_tasks_list',
    {
      title: 'List my tasks across every roadmap',
      description:
        'List the tasks assigned to you across every roadmap you can access, with roadmap and project attribution, due dates and the full assignee set. Use this for "what am I working on" / "what is overdue for me"; tasks_list answers the same question inside ONE roadmap.' +
        pagingClause(50, 25),
      inputSchema: {
        status: z.enum(TASK_STATUS).optional(),
        due: z.enum(DUE_WINDOWS).optional(),
        roadmap_ids: z.array(z.string().uuid()).max(20).optional(),
        project_id: z.string().uuid().optional(),
        workspace_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      status,
      due,
      roadmap_ids,
      project_id,
      workspace_id,
      limit,
      offset,
    }: {
      status?: string;
      due?: string;
      roadmap_ids?: string[];
      project_id?: string;
      workspace_id?: string;
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:read');
        const start = clampOffset(offset);
        const page = (await deps.s.aiContext.listTasks(uid, {
          assigned_to_me: true,
          status: status as never,
          roadmap_ids,
          project_id,
          workspace_id,
          limit: clampLimit(limit, 50, 25),
          offset: start,
          ...dueFilters(due),
        })) as unknown as Record<string, unknown>;
        // Already offset-paged upstream; just rename onto the tool contract.
        return pageFromBackend(page, 'tasks', { offset: start });
      }),
  );

  defineTool(
    server,
    'search_everything',
    {
      title: 'Search across every roadmap and project',
      description:
        'Search epics, features, tasks, roadmaps and projects across everything you can access, ranked by how well the title matches. Use it when you do not know which roadmap an item lives on; roadmap_search_nodes searches inside ONE roadmap.' +
        pagingClause(20, 10),
      inputSchema: {
        query: z.string().min(2).max(160),
        kinds: z.array(z.enum(SEARCH_KINDS)).min(1).max(5).optional(),
        roadmap_ids: z.array(z.string().uuid()).max(20).optional(),
        project_id: z.string().uuid().optional(),
        workspace_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(20).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      query,
      kinds,
      roadmap_ids,
      project_id,
      workspace_id,
      limit,
      offset,
    }: {
      query: string;
      kinds?: string[];
      roadmap_ids?: string[];
      project_id?: string;
      workspace_id?: string;
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        // Matches carry both roadmap and project attribution, so a token needs
        // both reads before it can see them.
        requireScope(deps.caller, 'roadmaps:read');
        requireScope(deps.caller, 'projects:read');
        const start = clampOffset(offset);
        const page = (await deps.s.aiContext.search(uid, {
          q: query,
          kinds: kinds as never,
          roadmap_ids,
          project_id,
          workspace_id,
          limit: clampLimit(limit, 20, 10),
          offset: start,
        })) as unknown as Record<string, unknown>;
        return pageFromBackend(page, 'matches', { offset: start });
      }),
  );

  defineTool(
    server,
    'workspace_overview_get',
    {
      title: 'Get the workspace overview',
      description:
        'The projects, roadmaps (with epic/feature/task counts) and teams you can reach, tagged by lane: `current` for the named workspace, `other_workspace` for another workspace you belong to, `shared` for anything reached through project access alone. Use it to find ids before the roadmap tools. Each list is capped at 60; total_<list> says how many exist, and roadmaps_list pages the full roadmap set.',
      inputSchema: {
        workspace_id: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ workspace_id }: { workspace_id?: string }) =>
      runTool(async () => {
        requireScope(deps.caller, 'projects:read');
        requireScope(deps.caller, 'roadmaps:read');
        const overview = (await deps.s.aiContext.getOverview(
          { id: uid } as AuthenticatedUser,
          { workspace_id },
        )) as unknown as Record<string, unknown>;
        // Not offset-paged upstream: bound each list and say how many exist.
        let bounded = overview;
        for (const key of ['projects', 'roadmaps', 'teams']) {
          bounded = cappedList(bounded, key, 60);
        }
        return bounded;
      }),
  );
}
