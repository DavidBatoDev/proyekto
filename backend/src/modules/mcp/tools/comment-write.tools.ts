import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Comment writes for non-task nodes. Same risk class as task_comment_add
 * (visible to collaborators, mention notifications), so they share the
 * `tasks:write` scope rather than minting a comments-specific one. Live authz
 * is per call inside the services (`roadmap.comment` or `roadmap.edit`).
 * Note: unlike task comments, epic/feature comments are NOT knowledge-indexed
 * — project_knowledge_search will not surface them.
 */

/** epic → roadmap → project, for the audit trail. Best-effort like the task
 * variant: null (no audit) on personal roadmaps or lookup misses. */
async function resolveEpicProjectId(
  deps: McpToolDeps,
  epicId: string,
): Promise<string | null> {
  const { data: epic } = await deps.s.db
    .from('roadmap_epics')
    .select('roadmap_id')
    .eq('id', epicId)
    .maybeSingle();
  if (!epic?.roadmap_id) return null;
  return resolveRoadmapProjectId(deps, epic.roadmap_id as string);
}

async function resolveFeatureProjectId(
  deps: McpToolDeps,
  featureId: string,
): Promise<string | null> {
  const { data: feature } = await deps.s.db
    .from('roadmap_features')
    .select('roadmap_id')
    .eq('id', featureId)
    .maybeSingle();
  if (!feature?.roadmap_id) return null;
  return resolveRoadmapProjectId(deps, feature.roadmap_id as string);
}

async function resolveRoadmapProjectId(
  deps: McpToolDeps,
  roadmapId: string,
): Promise<string | null> {
  const { data: roadmap } = await deps.s.db
    .from('roadmaps')
    .select('project_id')
    .eq('id', roadmapId)
    .maybeSingle();
  return (roadmap?.project_id as string | null) ?? null;
}

function auditWrite(
  deps: McpToolDeps,
  projectId: string | null,
  action: string,
  entityType: string,
  entityId: string,
): void {
  if (!projectId) return;
  // Fire-and-forget (AuditService.log never throws / never awaits).
  deps.s.audit.log({
    projectId,
    actorId: deps.caller.userId,
    action,
    entityType,
    entityId,
    metadata: { scopes: deps.caller.scopes },
  });
}

export function registerCommentWriteTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'epic_comment_add',
    {
      title: 'Comment on an epic',
      description:
        'Add a comment to an epic. Comments are visible to collaborators and can notify mentioned members, so confirm with the user before posting.',
      inputSchema: {
        epic_id: z.string().uuid(),
        content: z.string().min(1).max(5000),
      },
      annotations: { destructiveHint: true },
    },
    async ({ epic_id, content }) =>
      runTool(async () => {
        requireScope(deps.caller, 'tasks:write');
        const comment = await deps.s.epics.addComment(
          epic_id,
          { content },
          uid,
        );
        auditWrite(
          deps,
          await resolveEpicProjectId(deps, epic_id),
          'mcp.epic_comment_add',
          'epic',
          epic_id,
        );
        return { comment };
      }),
  );

  defineTool(
    server,
    'feature_comment_add',
    {
      title: 'Comment on a feature',
      description:
        'Add a comment to a feature. Comments are visible to collaborators and can notify mentioned members, so confirm with the user before posting.',
      inputSchema: {
        feature_id: z.string().uuid(),
        content: z.string().min(1).max(5000),
      },
      annotations: { destructiveHint: true },
    },
    async ({ feature_id, content }) =>
      runTool(async () => {
        requireScope(deps.caller, 'tasks:write');
        const comment = await deps.s.features.addComment(
          feature_id,
          { content },
          uid,
        );
        auditWrite(
          deps,
          await resolveFeatureProjectId(deps, feature_id),
          'mcp.feature_comment_add',
          'feature',
          feature_id,
        );
        return { comment };
      }),
  );
}
