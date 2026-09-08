import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getPermission } from '../../../execution/projects/permissions/project-permissions';
import {
  McpToolError,
  assertProjectViewer,
  clampLimit,
  clampOffset,
  defineTool,
  pageFromStart,
  pagingClause,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Project-level read tools. All gated by the `projects:read` scope AND the
 * caller's live project access; identity always comes from deps.caller, never
 * from tool arguments.
 */
export function registerProjectTools(server: McpServer, deps: McpToolDeps) {
  defineTool(
    server,
    'projects_list',
    {
      title: 'List my projects',
      description:
        'List every Proyekto project the authenticated user can access, newest first.' +
        pagingClause(25, 25),
      inputSchema: {
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, offset }: { limit?: number; offset?: number }) =>
      runTool(async () => {
        requireScope(deps.caller, 'projects:read');
        const projects = await deps.s.projects.listUserProjects(
          deps.caller.userId,
        );
        // The service returns the whole accessible set, so the page is exact
        // and the total is known.
        return pageFromStart(projects, 'projects', {
          offset: clampOffset(offset),
          limit: clampLimit(limit, deps.s.maxPageSize, 25),
          complete: true,
        });
      }),
  );

  defineTool(
    server,
    'projects_get',
    {
      title: 'Get a project',
      description:
        'Fetch a single project by id, including the details and the effective permissions the authenticated user holds on it.',
      inputSchema: { project_id: z.string().uuid() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'projects:read');
        const permissions = await assertProjectViewer(deps, project_id);
        const project = await deps.s.projects.getProject(project_id);
        return { project, my_permissions: permissions };
      }),
  );

  defineTool(
    server,
    'project_members_list',
    {
      title: 'List project members',
      description:
        'List the members of a project with their share roles. Requires member-view access.' +
        pagingClause(50, 50),
      inputSchema: {
        project_id: z.string().uuid(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      project_id,
      limit,
      offset,
    }: {
      project_id: string;
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'projects:read');
        const perms = await assertProjectViewer(deps, project_id);
        if (!getPermission(perms, 'members.view')) {
          throw new McpToolError(
            'FORBIDDEN',
            'You do not have permission to view this project’s members.',
          );
        }
        const cap = clampLimit(limit, deps.s.maxPageSize, 50);
        const start = clampOffset(offset);
        // A real database page: `range` is inclusive on both ends and the
        // exact count comes back in the same round trip.
        const { data, error, count } = await deps.s.db
          .from('project_access')
          .select('user_id, role, origin, created_at', { count: 'exact' })
          .eq('project_id', project_id)
          .order('created_at', { ascending: true })
          .range(start, start + cap - 1);
        if (error) {
          throw new McpToolError('INTERNAL', error.message);
        }
        const members = data ?? [];
        const total =
          typeof count === 'number' ? count : start + members.length;
        return {
          members,
          offset: start,
          returned_members: members.length,
          total_members: total,
          next_offset:
            start + members.length < total ? start + members.length : null,
        };
      }),
  );
}
