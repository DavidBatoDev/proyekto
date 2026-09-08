import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ACTIVITY_ACTIONS } from '../../audit/activity-actions';
import {
  McpToolError,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Project provisioning: create a project, rename it, move its status. The MCP
 * twins of the agent's `create_project` / `update_project`.
 *
 * Both need the `projects:write` scope AND the service's own gate — creation is
 * bounded by workspace membership, updates are owner-only. Only the fields the
 * projects table actually persists are exposed: `toProjectsTablePayload` writes
 * title, status, duration and currency and nothing else, so declaring a
 * `description` or `brief` input would accept text and silently drop it.
 */
const PROJECT_STATUS = [
  'draft',
  'bidding',
  'active',
  'paused',
  'completed',
  'archived',
] as const;

function auditWrite(
  deps: McpToolDeps,
  projectId: string,
  action: string,
  metadata: Record<string, unknown> = {},
): void {
  // Fire-and-forget, like every other MCP write (AuditService.log never throws).
  deps.s.audit.log({
    projectId,
    actorId: deps.caller.userId,
    action,
    entityType: 'project',
    entityId: projectId,
    metadata: { scopes: deps.caller.scopes, ...metadata },
  });
}

export function registerProjectWriteTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'project_create',
    {
      title: 'Create a project',
      description:
        'Create a new Proyekto project owned by the authenticated user. The project ALWAYS comes with its own empty roadmap named after it, returned as `roadmap` — never follow this with roadmap_create. Omit workspace_id to use your default workspace; naming a workspace you are not a member of is refused. The brief and description cannot be set here (the app owns them). Call roadmap_get_summary on the returned roadmap id before adding epics, features or tasks.',
      inputSchema: {
        title: z.string().min(1).max(200),
        status: z.enum(PROJECT_STATUS).optional(),
        duration: z.string().max(120).optional(),
        workspace_id: z.string().uuid().optional(),
      },
      annotations: {},
    },
    async ({
      title,
      status,
      duration,
      workspace_id,
    }: {
      title: string;
      status?: string;
      duration?: string;
      workspace_id?: string;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'projects:write');
        const created = await deps.s.projects.createProject(uid, {
          title,
          status: status as never,
          duration,
          workspace_id,
        } as never);
        const project = created.project as unknown as Record<string, unknown>;
        const projectId = typeof project.id === 'string' ? project.id : '';
        if (projectId) {
          auditWrite(deps, projectId, ACTIVITY_ACTIONS.MCP_PROJECT_CREATE, {
            title,
            roadmap_id: created.roadmap?.id ?? null,
          });
        }
        return {
          created: true,
          project,
          roadmap: created.roadmap,
          next_step: `The project has an empty roadmap "${created.roadmap?.name ?? ''}" (id ${created.roadmap?.id ?? ''}). Call roadmap_get_summary with that roadmap id before adding epics, features or tasks.`,
        };
      }),
  );

  defineTool(
    server,
    'project_update',
    {
      title: 'Update a project',
      description:
        'Rename a project or change its status or duration. Only the project OWNER can do this — anyone else gets FORBIDDEN. The description and brief CANNOT be changed here; say so plainly if asked. Pass at least one of title, status, duration.',
      inputSchema: {
        project_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        status: z.enum(PROJECT_STATUS).optional(),
        duration: z.string().max(120).optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      title,
      status,
      duration,
    }: {
      project_id: string;
      title?: string;
      status?: string;
      duration?: string;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'projects:write');
        // Zod cannot express "at least one of"; an empty patch would otherwise
        // be an authorized no-op the model reads as success.
        if (
          title === undefined &&
          status === undefined &&
          duration === undefined
        ) {
          throw new McpToolError(
            'VALIDATION_FAILED',
            'Pass at least one of title, status, duration. Descriptions and briefs cannot be changed with project_update.',
          );
        }
        const project = await deps.s.projects.updateProject(project_id, uid, {
          title,
          status: status as never,
          duration,
        } as never);
        auditWrite(deps, project_id, ACTIVITY_ACTIONS.MCP_PROJECT_UPDATE, {
          fields: Object.entries({ title, status, duration })
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
        });
        return { updated: true, project };
      }),
  );
}
