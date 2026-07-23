import { HttpException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import type { ProjectsService } from '../../projects/projects.service';
import type { ProjectAuthorizationService } from '../../projects/authorization/project-authorization.service';
import type { RoadmapsService } from '../../roadmaps/services/roadmaps.service';
import type { RoadmapAuthorizationService } from '../../roadmaps/services/roadmap-authorization.service';
import type { RoadmapAiService } from '../../roadmaps/services/roadmap-ai.service';
import type { RoadmapAiProjectContextService } from '../../roadmaps/services/roadmap-ai-project-context.service';
import type { RoadmapAiKnowledgeService } from '../../roadmaps/services/roadmap-ai-knowledge.service';
import type { TasksService } from '../../roadmaps/services/tasks.service';
import type { TaskExtrasService } from '../../roadmaps/services/task-extras.service';
import type { ChatService } from '../../chat/chat.service';
import type { AuditService } from '../../audit/audit.service';
import type { McpScope } from '../mcp-scopes';
import { hasScope } from '../mcp-scopes';

/** The identity + grants resolved by McpAuthGuard for one request. */
export interface McpCaller {
  userId: string;
  scopes: string[];
}

/** Domain services the tools reuse in-process (all carry their own authz). */
export interface McpServices {
  projects: ProjectsService;
  projectAuthz: ProjectAuthorizationService;
  roadmaps: RoadmapsService;
  roadmapAuthz: RoadmapAuthorizationService;
  roadmapAi: RoadmapAiService;
  projectContext: RoadmapAiProjectContextService;
  knowledge: RoadmapAiKnowledgeService;
  tasks: TasksService;
  taskExtras: TaskExtrasService;
  chat: ChatService;
  audit: AuditService;
  db: SupabaseClient;
  maxPageSize: number;
}

/** What every tool file receives. */
export interface McpToolDeps {
  s: McpServices;
  caller: McpCaller;
}

/** Stable, machine-readable error codes surfaced to the host model. */
export type McpErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'STALE_REVISION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NO_PROJECT'
  | 'INTERNAL';

export class McpToolError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

/** Reject a call whose PAT lacks the required scope. */
export function requireScope(caller: McpCaller, scope: McpScope): void {
  if (!hasScope(caller.scopes, scope)) {
    throw new McpToolError(
      'FORBIDDEN',
      `This token is missing the required scope "${scope}".`,
    );
  }
}

/** Clamp a caller-requested page size to the configured ceiling. */
export function clampLimit(
  requested: number | undefined,
  max: number,
  fallback = 25,
): number {
  const n = requested ?? fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** A successful tool result carrying JSON data as text content. */
export function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Run a tool body and normalize any thrown error into a structured MCP error
 * result (isError:true) with a stable code — Nest HttpExceptions are mapped by
 * status so the host model sees FORBIDDEN/NOT_FOUND rather than a raw 500.
 */
export async function runTool(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    const { code, message } = normalizeError(err);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: code, message }),
        },
      ],
      isError: true as const,
    };
  }
}

function normalizeError(err: unknown): { code: McpErrorCode; message: string } {
  if (err instanceof McpToolError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const message = err.message;
    if (status === 401) return { code: 'UNAUTHENTICATED', message };
    if (status === 403) return { code: 'FORBIDDEN', message };
    if (status === 404) return { code: 'NOT_FOUND', message };
    if (status === 400 || status === 422)
      return { code: 'VALIDATION_FAILED', message };
    if (status === 409) {
      // The write lifecycle raises 409 with a structured `code` (e.g.
      // STALE_REVISION on a concurrent edit, IDEMPOTENCY_KEY_REUSED on a
      // mismatched retry). Surface that code so the host can react precisely.
      const body = err.getResponse();
      const raw =
        body && typeof body === 'object' && 'code' in body
          ? String((body as { code: unknown }).code)
          : '';
      if (raw === 'STALE_REVISION') return { code: 'STALE_REVISION', message };
      return { code: 'CONFLICT', message };
    }
    if (status === 429) return { code: 'RATE_LIMITED', message };
    return { code: 'INTERNAL', message };
  }
  return {
    code: 'INTERNAL',
    message: err instanceof Error ? err.message : 'Unexpected error',
  };
}

interface McpToolDef {
  title?: string;
  description?: string;
  inputSchema?: ZodRawShape;
  annotations?: Record<string, unknown>;
}

/**
 * Register a read tool. Thin wrapper over `server.registerTool` that erases its
 * callback-arg generic inference — the SDK infers handler arg types from the zod
 * shape, which trips TS2589 ("type instantiation excessively deep") on our
 * larger enum schemas. The runtime schema is still passed and enforced by the
 * SDK; only the compile-time inference is dropped (args typed as `any`).
 */
export function defineTool(
  server: McpServer,
  name: string,
  def: McpToolDef,
  handler: (args: any) => Promise<unknown>,
): void {
  (
    server.registerTool as unknown as (
      n: string,
      d: McpToolDef,
      cb: (args: any) => Promise<unknown>,
    ) => void
  )(name, def, handler);
}

/**
 * Gate a project-level read: the caller must hold at least view access. Returns
 * the resolved permissions for callers that also want to inspect a capability.
 * Throws NOT_FOUND (not FORBIDDEN) on no-access to avoid leaking existence.
 */
export async function assertProjectViewer(
  deps: McpToolDeps,
  projectId: string,
) {
  const perms = await deps.s.projectAuthz.resolvePermissions(
    deps.caller.userId,
    projectId,
  );
  if (!perms) {
    throw new McpToolError(
      'NOT_FOUND',
      'Project not found or you do not have access to it.',
    );
  }
  return perms;
}
