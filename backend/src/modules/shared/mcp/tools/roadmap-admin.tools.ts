import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { generateRoadmapThumbnailDataUri } from '../../../execution/roadmaps/roadmap-thumbnail.util';
import { ACTIVITY_ACTIONS } from '../../audit/activity-actions';
import {
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Roadmap provisioning: create a roadmap, attach a standalone one to a project.
 * The MCP twins of the agent's `create_roadmap` / `attach_roadmap_to_project`.
 *
 * Deliberately its own file rather than part of roadmap-write.tools.ts: that
 * one is the preview -> commit -> revert lifecycle for a roadmap's CONTENT,
 * with revision tokens and an undo log. These two create and re-home the
 * container itself, are plain REST underneath, and are not revertable through
 * `roadmap_revert_change`.
 *
 * A project holds at most one roadmap, so both tools can answer CONFLICT
 * (`PROJECT_ALREADY_HAS_ROADMAP`) — tell the user which roadmap the project
 * already has rather than retrying.
 */
const ROADMAP_STATUS = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
] as const;

function auditWrite(
  deps: McpToolDeps,
  projectId: string | null,
  action: string,
  roadmapId: string,
  metadata: Record<string, unknown> = {},
): void {
  // The audit log is project-scoped; a standalone roadmap has no project to
  // file the row under, so it is skipped rather than logged nowhere.
  if (!projectId) return;
  deps.s.audit.log({
    projectId,
    actorId: deps.caller.userId,
    action,
    entityType: 'roadmap',
    entityId: roadmapId,
    metadata: { scopes: deps.caller.scopes, ...metadata },
  });
}

export function registerRoadmapAdminTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'roadmap_create',
    {
      title: 'Create a roadmap',
      description:
        'Create a new roadmap. Pass project_id to attach it to a project you can edit — a project holds at most one roadmap, so this answers CONFLICT when it already has one. Omit project_id for a standalone roadmap you own. The roadmap starts empty: call roadmap_get_summary on the returned id, then roadmap_preview_operations to fill it. Do NOT call this after project_create, which already provisions a roadmap.',
      inputSchema: {
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z.string().max(80).optional(),
        status: z.enum(ROADMAP_STATUS).optional(),
        project_id: z.string().uuid().optional(),
      },
      annotations: {},
    },
    async ({
      name,
      description,
      category,
      status,
      project_id,
    }: {
      name: string;
      description?: string;
      category?: string;
      status?: string;
      project_id?: string;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:write');
        const roadmap = (await deps.s.roadmaps.create(
          {
            name,
            description,
            category,
            status: status ?? 'draft',
            project_id,
            settings: {},
            // Required by CreateRoadmapDto; the same generator the web uses.
            preview_url: generateRoadmapThumbnailDataUri(name, name),
          } as never,
          uid,
        )) as unknown as Record<string, unknown>;
        const roadmapId = typeof roadmap.id === 'string' ? roadmap.id : '';
        auditWrite(
          deps,
          project_id ?? null,
          ACTIVITY_ACTIONS.MCP_ROADMAP_CREATE,
          roadmapId,
          { name },
        );
        return {
          created: true,
          roadmap,
          next_step: `The roadmap is empty. Call roadmap_get_summary with id ${roadmapId} before adding epics, features or tasks with roadmap_preview_operations.`,
        };
      }),
  );

  defineTool(
    server,
    'roadmap_attach_to_project',
    {
      title: 'Attach a roadmap to a project',
      description:
        "Link a standalone roadmap to a project, so the project's members can see and edit it. This CANNOT be undone from here: a roadmap that already belongs to a project cannot be moved, and a project holds at most one roadmap. Confirm with the user before calling it.",
      inputSchema: {
        roadmap_id: z.string().uuid(),
        project_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({
      roadmap_id,
      project_id,
    }: {
      roadmap_id: string;
      project_id: string;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:write');
        const roadmap = (await deps.s.roadmaps.update(
          roadmap_id,
          { project_id } as never,
          uid,
        )) as unknown as Record<string, unknown>;
        auditWrite(
          deps,
          project_id,
          ACTIVITY_ACTIONS.MCP_ROADMAP_ATTACHED,
          roadmap_id,
        );
        return { attached: true, roadmap };
      }),
  );
}
