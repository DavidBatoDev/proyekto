import { HttpException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import type { ProjectsService } from '../../../execution/projects/projects.service';
import type { ProjectAuthorizationService } from '../../../execution/projects/authorization/project-authorization.service';
import type { RoadmapsService } from '../../../execution/roadmaps/services/roadmaps.service';
import type { RoadmapAuthorizationService } from '../../../execution/roadmaps/services/roadmap-authorization.service';
import type { RoadmapAiService } from '../../../execution/roadmaps/services/roadmap-ai.service';
import type { RoadmapAiProjectContextService } from '../../../execution/roadmaps/services/roadmap-ai-project-context.service';
import type { RoadmapAiKnowledgeService } from '../../../execution/roadmaps/services/roadmap-ai-knowledge.service';
import type { TasksService } from '../../../execution/roadmaps/services/tasks.service';
import type { TaskExtrasService } from '../../../execution/roadmaps/services/task-extras.service';
import type { EpicsService } from '../../../execution/roadmaps/services/epics.service';
import type { FeaturesService } from '../../../execution/roadmaps/services/features.service';
import type { RoadmapAiSessionsService } from '../../../execution/roadmaps/services/roadmap-ai-sessions.service';
import type { AiContextService } from '../../../execution/ai-context/services/ai-context.service';
import type { ChatService } from '../../../execution/chat/chat.service';
import type { DeliverablesService } from '../../../execution/delivery/deliverables.service';
import type { ChangeRequestsService } from '../../../execution/delivery/change-requests.service';
import type { RisksService } from '../../../execution/delivery/risks.service';
import type { DecisionsService } from '../../../execution/delivery/decisions.service';
import type { DecisionCategoriesService } from '../../../execution/delivery/decision-categories.service';
import type { AuditService } from '../../audit/audit.service';
import type { McpScope } from '../mcp-scopes';
import type { RoadmapVisual } from '../roadmap-visual';
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
  epics: EpicsService;
  features: FeaturesService;
  aiSessions: RoadmapAiSessionsService;
  /** Cross-roadmap reads (already offset-paged) for the workspace tools. */
  aiContext: AiContextService;
  chat: ChatService;
  deliverables: DeliverablesService;
  changeRequests: ChangeRequestsService;
  risks: RisksService;
  decisions: DecisionsService;
  decisionCategories: DecisionCategoriesService;
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

// ---------------------------------------------------------------------------
// Offset paging
//
// Every list tool takes an optional `offset` beside `limit` and answers with
// the same keys, so a host reads "showing N from offset O of T; continue at
// next_offset" the same way everywhere:
//
//   offset            the effective zero-based start of this page
//   returned_<key>    rows on this page
//   next_offset       where the next page starts, or null when this page
//                     ended the set
//   total_<key>       the size of the whole filtered set, only when known
//
// This is the same contract the Proyekto agent speaks
// (agent/app/core/tools/handlers/paging.py), so one shape covers both AI
// surfaces. The three tools that page by keyset cursor (chat messages,
// AI-session messages, roadmap changes) keep their cursors.
// ---------------------------------------------------------------------------

/** Hard ceiling on `offset`, so a runaway host cannot walk forever. */
export const MAX_OFFSET = 10_000;

/** A non-negative integer offset; anything else (junk, floats, bools) is 0. */
export function clampOffset(requested: unknown, max = MAX_OFFSET): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return 0;
  return Math.min(Math.max(Math.floor(requested), 0), max);
}

/**
 * Rows to request from a source that only takes `limit` and returns from the
 * start of the set: the page, plus one probe row that answers "is there more",
 * never beyond what the source can return.
 */
export function fetchWindow(
  offset: number,
  limit: number,
  cap: number,
): number {
  return Math.max(1, Math.min(cap, offset + limit + 1));
}

export interface PageOptions {
  offset: number;
  limit: number;
  /**
   * True when `rows` is the whole filtered set — a fetch that came back
   * shorter than its window, or a list built from a complete source. Only then
   * is `total_<key>` reported, because only then is it known.
   */
  complete: boolean;
  /** Scalars to keep alongside the page (roadmap_id, parent_type, ...). */
  extra?: Record<string, unknown>;
}

/** Slice a page out of rows that begin at index 0. */
export function pageFromStart<T>(
  rows: readonly T[],
  key: string,
  { offset, limit, complete, extra }: PageOptions,
): Record<string, unknown> {
  const page = rows.slice(offset, offset + limit);
  const result: Record<string, unknown> = { ...extra };
  result[key] = page;
  result.offset = offset;
  result[`returned_${key}`] = page.length;
  if (complete) result[`total_${key}`] = rows.length;
  // A full page from a source we could not prove complete is assumed to have a
  // successor even when a later filter ate the probe row.
  const hasMore =
    rows.length > offset + page.length || (!complete && page.length >= limit);
  result.next_offset = hasMore && page.length > 0 ? offset + page.length : null;
  return result;
}

/**
 * Page a result whose list was fetched from the start of the set with a
 * `fetchWindow` limit: rows shorter than the window prove the set complete.
 * Scalars on the payload (roadmap_id, parent_type, ...) ride along.
 */
export function pageFetchedList(
  payload: Record<string, unknown>,
  key: string,
  { offset, limit, window }: { offset: number; limit: number; window: number },
): Record<string, unknown> {
  const raw = payload[key];
  const rows = Array.isArray(raw) ? raw : [];
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k !== key) extra[k] = v;
  }
  return pageFromStart(rows, key, {
    offset,
    limit,
    complete: rows.length < window,
    extra,
  });
}

const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

/**
 * Normalize a page the backend already computed (`AiContextService` answers
 * `{<key>, offset, total, next_offset}`) onto the tool contract.
 */
export function pageFromBackend(
  payload: Record<string, unknown>,
  key: string,
  { offset }: { offset: number },
): Record<string, unknown> {
  const raw = payload[key];
  const items = Array.isArray(raw) ? raw : [];
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === key || k === 'offset' || k === 'total' || k === 'next_offset') {
      continue;
    }
    result[k] = v;
  }
  result[key] = items;
  result.offset = asCount(payload.offset) ?? offset;
  result[`returned_${key}`] = items.length;
  const total = asCount(payload.total);
  if (total !== null) result[`total_${key}`] = total;
  result.next_offset = asCount(payload.next_offset);
  return result;
}

/**
 * A list that is bounded but not paged: keep the first `cap` rows and say how
 * many exist, so the host knows it is seeing a slice.
 */
export function cappedList(
  payload: Record<string, unknown>,
  key: string,
  cap: number,
): Record<string, unknown> {
  const rows = payload[key];
  if (!Array.isArray(rows)) return payload;
  const kept = rows.slice(0, cap);
  return {
    ...payload,
    [key]: kept,
    [`total_${key}`]: rows.length,
    [`returned_${key}`]: kept.length,
  };
}

/** The sentence every paged tool's description ends with. */
export function pagingClause(cap: number, fallback: number): string {
  return (
    ` Returns up to ${cap} per call (limit, default ${fallback}); pass ` +
    'offset = next_offset from the previous result to continue.'
  );
}

// ---------------------------------------------------------------------------
// Result size
// ---------------------------------------------------------------------------

/** Ceiling on one serialized tool result, before the whole-item cut. */
export const DEFAULT_MAX_RESULT_CHARS = 24_000;

/** `MCP_MAX_RESULT_CHARS`, read once; falls back to the default. */
export function resultCharCap(): number {
  const raw = Number(process.env.MCP_MAX_RESULT_CHARS);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_MAX_RESULT_CHARS;
}

const serialize = (value: unknown): string => JSON.stringify(value, null, 2);

/** The root key holding this result's bulk as a list of objects. */
function bulkListKey(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  let best: string | null = null;
  let bestSize = 0;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (!value.every((item) => item !== null && typeof item === 'object')) {
      continue;
    }
    const size = serialize(value).length;
    if (size > bestSize) {
      best = key;
      bestSize = size;
    }
  }
  return best;
}

function truncationHint(
  key: string,
  returned: number,
  pageSize: number,
  nextOffset: number,
): string {
  return (
    `Only the first ${returned} of the ${pageSize} ${key} on this page fit in ` +
    'one result. Tell the user how many you are showing; to continue, repeat ' +
    `the same call with offset=${nextOffset}. Do not raise limit.`
  );
}

/**
 * Serialize a tool result, cutting an over-large list on WHOLE items so every
 * id the host sees is complete and it can resume from `next_offset`. Mirrors
 * the agent's engine cut (agent/app/core/engine/tool_results.py).
 */
export function serializeToolResult(
  data: unknown,
  maxChars = resultCharCap(),
): string {
  const text = serialize(data);
  if (text.length <= maxChars) return text;

  const key = bulkListKey(data);
  if (!key) return `${text.slice(0, maxChars)}…(truncated)`;

  const source = data as Record<string, unknown>;
  const items = (source[key] as unknown[]).filter(
    (item) => item !== null && typeof item === 'object',
  );
  const offset = asCount(source.offset) ?? 0;
  const cut: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k !== key) cut[k] = v;
  }
  const kept: unknown[] = [];
  cut[key] = kept;
  // A handler that counted the whole set already wrote total_<key>; the cut
  // only knows the page it was handed.
  if (cut[`total_${key}`] === undefined) cut[`total_${key}`] = items.length;
  cut[`returned_${key}`] = 0;
  cut.result_truncated = true;
  // Seed with the widest hint the loop can end on, so the final one always fits.
  cut.next_offset = offset + items.length;
  cut.truncation_hint = truncationHint(
    key,
    items.length,
    items.length,
    offset + items.length,
  );
  if (serialize(cut).length > maxChars) {
    return `${text.slice(0, maxChars)}…(truncated)`;
  }
  for (const item of items) {
    kept.push(item);
    cut[`returned_${key}`] = kept.length;
    if (serialize(cut).length > maxChars) {
      kept.pop();
      cut[`returned_${key}`] = kept.length;
      break;
    }
  }
  if (kept.length === 0) return `${text.slice(0, maxChars)}…(truncated)`;
  cut.next_offset = offset + kept.length;
  cut.truncation_hint = truncationHint(
    key,
    kept.length,
    items.length,
    offset + kept.length,
  );
  return serialize(cut);
}

/** A successful tool result carrying JSON data as text content. */
export function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: serializeToolResult(data) }],
  };
}

interface VisualResultOptions {
  enabled: boolean;
  create: (data: unknown) => Promise<RoadmapVisual> | RoadmapVisual;
}

function structuredData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { data };
}

async function okWithVisual(data: unknown, visual: VisualResultOptions) {
  // The size cut applies to the JSON block only — never to the rendered
  // SVG/PNG blocks, whose data URIs must stay whole.
  const json = {
    type: 'text' as const,
    text: serializeToolResult(data),
  };
  if (!visual.enabled) {
    return {
      content: [json],
      structuredContent: structuredData(data),
    };
  }

  try {
    const rendered = await visual.create(data);
    return {
      content: [
        json,
        {
          type: 'resource' as const,
          resource: {
            uri: rendered.uri,
            mimeType: 'image/svg+xml',
            text: rendered.svg,
          },
          annotations: {
            audience: ['user' as const],
            priority: 0.8,
          },
        },
        {
          type: 'image' as const,
          data: rendered.pngBase64,
          mimeType: 'image/png',
          annotations: {
            audience: ['user' as const],
            priority: 1,
          },
        },
      ],
      structuredContent: {
        ...structuredData(data),
        visual: {
          svg_uri: rendered.uri,
          svg_mime_type: 'image/svg+xml',
          inline_mime_type: 'image/png',
          alt: rendered.alt,
        },
      },
    };
  } catch {
    const warning = {
      code: 'VISUAL_RENDER_FAILED',
      message:
        'The roadmap data was returned, but its visual could not be generated.',
    };
    return {
      content: [
        json,
        {
          type: 'text' as const,
          text: JSON.stringify({ visual_warning: warning }),
        },
      ],
      structuredContent: {
        ...structuredData(data),
        visual_warning: warning,
      },
    };
  }
}

/**
 * Run a tool body and normalize any thrown error into a structured MCP error
 * result (isError:true) with a stable code — Nest HttpExceptions are mapped by
 * status so the host model sees FORBIDDEN/NOT_FOUND rather than a raw 500.
 */
export async function runTool(fn: () => unknown, visual?: VisualResultOptions) {
  try {
    const data = await fn();
    return visual ? okWithVisual(data, visual) : ok(data);
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
      // A project holds at most one roadmap; keep the code in the message so
      // the host can tell this conflict from a concurrent-edit one.
      if (raw === 'PROJECT_ALREADY_HAS_ROADMAP') {
        return { code: 'CONFLICT', message: `${message} (${raw})` };
      }
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

interface McpAppToolDef extends McpToolDef {
  _meta: {
    ui: {
      resourceUri: string;
      visibility?: Array<'model' | 'app'>;
    };
    [key: string]: unknown;
  };
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

/** Register a tool whose result should render through a linked MCP App view. */
export function defineAppTool(
  server: McpServer,
  name: string,
  def: McpAppToolDef,
  handler: (args: any) => Promise<unknown>,
): void {
  const normalized = {
    ...def,
    _meta: {
      ...def._meta,
      'ui/resourceUri': def._meta.ui.resourceUri,
    },
  };
  (
    server.registerTool as unknown as (
      n: string,
      d: McpAppToolDef,
      cb: (args: any) => Promise<unknown>,
    ) => void
  )(name, normalized, handler);
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
