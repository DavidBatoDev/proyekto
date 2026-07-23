import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  McpToolError,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Structural roadmap writes via the preview → commit → rollback lifecycle
 * (RoadmapAiService), which carries the Phase-0 hardening: authz-first,
 * idempotency replay, an atomic STALE_REVISION guard, and an audit-log write.
 *
 * Two-stage by design: `roadmap_preview_operations` returns a semantic diff +
 * a `revision_token`; `roadmap_commit_operations` REQUIRES that token (and an
 * idempotency key) — stricter than the web path's opt-in — so a host must
 * inspect the diff before it can mutate. On STALE_REVISION the host re-previews.
 */

const OP_TYPES = [
  'add_epic',
  'add_feature',
  'add_task',
  'add_milestone',
  'update_node',
  'move_node',
  'delete_node',
  'mark_status',
  'shift_dates',
] as const;

// Mirrors the shared operations contract (schemas/roadmap-ai-operations.json).
// The RoadmapAiService applies its own semantic validation and returns
// validation_issues; this schema just gives hosts a typed input surface.
const operationSchema = z
  .object({
    op: z.enum(OP_TYPES),
    node_type: z
      .enum(['roadmap', 'epic', 'feature', 'task', 'milestone'])
      .optional(),
    node_id: z.string().uuid().optional(),
    node_ref: z.string().optional(),
    parent_id: z.string().uuid().optional(),
    parent_ref: z.string().optional(),
    new_parent_id: z.string().uuid().optional(),
    new_parent_ref: z.string().optional(),
    temp_id: z.string().optional(),
    position: z.number().int().min(0).optional(),
    patch: z.record(z.unknown()).optional(),
    status: z.string().optional(),
    delta_days: z.number().int().optional(),
    scope: z.record(z.unknown()).optional(),
    data: z.record(z.unknown()).optional(),
    targets: z.array(z.string()).optional(),
  })
  .passthrough();

export function registerRoadmapWriteTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'roadmap_preview_operations',
    {
      title: 'Preview roadmap changes',
      description:
        'Validate a batch of typed roadmap operations without applying them. Returns a semantic diff, any validation issues, a temp-id → real-id map, and a revision_token you must pass to roadmap_commit_operations. Always preview before committing.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        operations: z.array(operationSchema).min(1),
        revision_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ roadmap_id, operations, revision_token }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:write');
        const result = await deps.s.roadmapAi.preview(
          roadmap_id,
          { operations, revision_token },
          uid,
        );
        // Omit the full candidate_snapshot — it can be very large. The
        // semantic_diff + operation_results are what the host reasons over.
        const { candidate_snapshot: _snapshot, ...lean } =
          result as unknown as Record<string, unknown>;
        return lean;
      }),
  );

  defineTool(
    server,
    'roadmap_commit_operations',
    {
      title: 'Commit roadmap changes',
      description:
        'Apply a previewed batch of roadmap operations. REQUIRES the revision_token returned by roadmap_preview_operations and an idempotency_key. If it returns a STALE_REVISION error, the roadmap changed under you — re-run roadmap_preview_operations and commit with the fresh token. Confirm with the user before committing changes that delete nodes.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        operations: z.array(operationSchema).min(1),
        revision_token: z.string(),
        idempotency_key: z.string().max(100),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ roadmap_id, operations, revision_token, idempotency_key }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:write');
        if (!revision_token) {
          throw new McpToolError(
            'VALIDATION_FAILED',
            'revision_token is required — call roadmap_preview_operations first and pass its revision_token.',
          );
        }
        if (!idempotency_key) {
          throw new McpToolError(
            'VALIDATION_FAILED',
            'idempotency_key is required so a retried commit is not applied twice.',
          );
        }
        const result = await deps.s.roadmapAi.commit(
          roadmap_id,
          {
            operations,
            revision_token,
            idempotency_key,
            include_roadmap: false,
          },
          uid,
        );
        const {
          candidate_snapshot: _snapshot,
          roadmap: _roadmap,
          ...lean
        } = result as unknown as Record<string, unknown>;
        return lean;
      }),
  );

  defineTool(
    server,
    'roadmap_revert_change',
    {
      title: 'Revert a roadmap change',
      description:
        'Undo a previously committed change by its change_id (from a commit result or roadmap_get_summary timeline): restores the roadmap to the state just before that change, which also undoes any changes made after it. Confirm with the user first — this changes the live roadmap.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        change_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ roadmap_id, change_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'roadmaps:write');
        // The service's `discard` is the undo/revert op (restores stateBefore);
        // its `rollback` is redo. We expose only revert for Phase 2.
        const result = await deps.s.roadmapAi.discard(
          roadmap_id,
          { change_id },
          uid,
        );
        const { roadmap: _roadmap, ...lean } = result as unknown as Record<
          string,
          unknown
        >;
        return lean;
      }),
  );
}
