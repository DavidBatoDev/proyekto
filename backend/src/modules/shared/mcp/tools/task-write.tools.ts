import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Ergonomic task writes via the DIRECT tasks.service path (not the roadmap-ops
 * lifecycle). This path reconciles the multi-assignee join table and fires
 * task_assigned notifications, which the AI-ops path does not — the reason task
 * mutations get their own tools. Each carries its own authz (roadmap.create_tasks
 * / roadmap.edit / roadmap.assign / roadmap.comment).
 */

const taskStatus = z.enum([
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
]);
const taskPriority = z.enum(['urgent', 'high', 'medium', 'low']);

/** Resolve the owning project for a task (task → feature → roadmap → project),
 * for the audit trail. Best-effort: returns null on a personal roadmap or any
 * lookup miss, in which case the write is simply not audited. */
async function resolveTaskProjectId(
  deps: McpToolDeps,
  taskId: string,
): Promise<string | null> {
  const { data: task } = await deps.s.db
    .from('roadmap_tasks')
    .select('feature_id')
    .eq('id', taskId)
    .maybeSingle();
  if (!task?.feature_id) return null;
  return resolveFeatureProjectId(deps, task.feature_id as string);
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
  const { data: roadmap } = await deps.s.db
    .from('roadmaps')
    .select('project_id')
    .eq('id', feature.roadmap_id as string)
    .maybeSingle();
  return (roadmap?.project_id as string | null) ?? null;
}

function auditWrite(
  deps: McpToolDeps,
  projectId: string | null,
  action: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): void {
  if (!projectId) return;
  // Fire-and-forget (AuditService.log never throws / never awaits).
  deps.s.audit.log({
    projectId,
    actorId: deps.caller.userId,
    action,
    entityType: 'task',
    entityId,
    metadata: { scopes: deps.caller.scopes, ...metadata },
  });
}

export function registerTaskWriteTools(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'task_create',
    {
      title: 'Create a task',
      description:
        'Create a task under a feature. To assign it to people, call task_assign afterwards (assignment is separately permissioned).',
      inputSchema: {
        feature_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        status: taskStatus.optional(),
        priority: taskPriority.optional(),
        due_date: z.string().optional(),
        position: z.number().int().min(0).optional(),
      },
      annotations: {},
    },
    async ({
      feature_id,
      title,
      description,
      status,
      priority,
      due_date,
      position,
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'tasks:write');
        const task = await deps.s.tasks.create(
          {
            feature_id,
            title,
            description,
            status,
            priority,
            due_date,
            position,
          },
          uid,
        );
        auditWrite(
          deps,
          await resolveFeatureProjectId(deps, feature_id),
          'mcp.task_create',
          (task as { id: string }).id,
        );
        return { task };
      }),
  );

  defineTool(
    server,
    'task_update',
    {
      title: 'Update a task',
      description:
        'Update a task’s fields (title, description, status, priority, due date, position). Use task_assign to change assignees.',
      inputSchema: {
        task_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        status: taskStatus.optional(),
        priority: taskPriority.optional(),
        due_date: z.string().nullable().optional(),
        position: z.number().int().min(0).optional(),
      },
      annotations: {},
    },
    async ({
      task_id,
      title,
      description,
      status,
      priority,
      due_date,
      position,
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'tasks:write');
        const task = await deps.s.tasks.update(
          task_id,
          { title, description, status, priority, due_date, position },
          uid,
        );
        auditWrite(
          deps,
          await resolveTaskProjectId(deps, task_id),
          'mcp.task_update',
          task_id,
        );
        return { task };
      }),
  );

  defineTool(
    server,
    'task_assign',
    {
      title: 'Assign a task',
      description:
        'Set the assignees of a task (replaces the current set — pass all assignee ids you want, or an empty array to unassign). This notifies newly-assigned members, so confirm with the user first.',
      inputSchema: {
        task_id: z.string().uuid(),
        assignee_ids: z.array(z.string().uuid()),
      },
      annotations: { destructiveHint: true },
    },
    async ({ task_id, assignee_ids }) =>
      runTool(async () => {
        requireScope(deps.caller, 'tasks:assign');
        const task = await deps.s.tasks.update(task_id, { assignee_ids }, uid);
        auditWrite(
          deps,
          await resolveTaskProjectId(deps, task_id),
          'mcp.task_assign',
          task_id,
          { assignee_ids },
        );
        return { task };
      }),
  );

  defineTool(
    server,
    'task_comment_add',
    {
      title: 'Comment on a task',
      description:
        'Add a comment to a task. Comments are visible to collaborators and can notify mentioned members, so confirm with the user before posting.',
      inputSchema: {
        task_id: z.string().uuid(),
        content: z.string().min(1).max(5000),
      },
      annotations: { destructiveHint: true },
    },
    async ({ task_id, content }) =>
      runTool(async () => {
        requireScope(deps.caller, 'tasks:write');
        const comment = await deps.s.taskExtras.addComment(
          task_id,
          { content },
          uid,
        );
        auditWrite(
          deps,
          await resolveTaskProjectId(deps, task_id),
          'mcp.task_comment_add',
          task_id,
        );
        return { comment };
      }),
  );
}
