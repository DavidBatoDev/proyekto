import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getPermission } from '../../projects/permissions/project-permissions';
import {
  McpToolError,
  assertProjectViewer,
  clampLimit,
  defineTool,
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
        'List every Proyekto project the authenticated user can access, newest first.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      runTool(async () => {
        requireScope(deps.caller, 'projects:read');
        const projects = await deps.s.projects.listUserProjects(
          deps.caller.userId,
        );
        return { projects };
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
        'List the members of a project with their share roles. Requires member-view access.',
      inputSchema: {
        project_id: z.string().uuid(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, limit }) =>
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
        const { data, error } = await deps.s.db
          .from('project_access')
          .select('user_id, role, origin, created_at')
          .eq('project_id', project_id)
          .order('created_at', { ascending: true })
          .limit(cap);
        if (error) {
          throw new McpToolError('INTERNAL', error.message);
        }
        return { members: data ?? [] };
      }),
  );
}
