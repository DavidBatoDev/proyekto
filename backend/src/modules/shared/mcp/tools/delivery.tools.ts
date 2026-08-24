import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  assertProjectViewer,
  clampLimit,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Delivery-governance reads: deliverables, change requests, the risk & issue
 * register, and the decision log.
 *
 * Three things here are load-bearing:
 *
 * 1. Every tool calls `assertProjectViewer` BEFORE the service. The delivery
 *    services raise 403 for a non-member, but the rest of this surface answers
 *    NOT_FOUND so a caller cannot probe which project ids exist. A member who
 *    merely lacks a capability still gets the service's honest FORBIDDEN.
 * 2. Reviewers are projected through a whitelist. `REVIEWER_PROFILE_COLS` in
 *    deliverables.service.ts selects `email, first_name, last_name` (the web
 *    Avatar needs them) but DeliverableReviewerRow declares only three fields —
 *    so the PII is invisible to the type system and a rest-spread would ship it
 *    to the host model. Build the object; never blacklist keys.
 * 3. Nothing here touches `deps.s.db`. The internal/shared visibility filter
 *    lives in the services, so a direct read would be a service-role side
 *    channel straight around it.
 */

const deliverableStatus = z.enum([
  'not_started',
  'in_progress',
  'in_review',
  'approved',
  'changes_requested',
]);

const changeRequestStatus = z.enum([
  'draft',
  'submitted',
  'approved',
  'rejected',
  'changes_requested',
  'withdrawn',
  'applied',
]);

const changeRequestView = z.enum([
  'open',
  'awaiting_decision',
  'decided',
  'closed',
  'all',
]);

const riskKind = z.enum(['risk', 'issue']);
const riskStatus = z.enum([
  'open',
  'mitigating',
  'monitoring',
  'resolved',
  'accepted',
  'closed',
]);

const decisionStatus = z.enum(['proposed', 'final', 'superseded']);

/** Default page size, before MCP_MAX_PAGE_SIZE clamps it. */
const DEFAULT_PAGE = 50;

interface RawReviewer {
  id?: unknown;
  reviewer_id?: unknown;
  decision?: unknown;
  note?: unknown;
  decided_at?: unknown;
  reviewer?: { id?: unknown; display_name?: unknown } | null;
}

/**
 * Whitelist a reviewer down to what a model may see. Mirrors the author
 * whitelist on `task_comments_list` and the field-by-field projections in
 * ai-sessions.tools.ts — a spread here would leak email addresses.
 */
export function projectReviewer(raw: RawReviewer): Record<string, unknown> {
  return {
    id: raw.id ?? null,
    reviewer_id: raw.reviewer_id ?? null,
    decision: raw.decision ?? null,
    note: raw.note ?? null,
    decided_at: raw.decided_at ?? null,
    reviewer: raw.reviewer
      ? {
          id: raw.reviewer.id ?? null,
          display_name: raw.reviewer.display_name ?? null,
        }
      : null,
  };
}

/**
 * Apply the reviewer whitelist to a deliverable row. Used on EVERY deliverable
 * that leaves this server — create/update/submit/review all return rows with
 * reviewers embedded, so the write tools import this too.
 */
export function projectDeliverable(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  const record = row as Record<string, unknown>;
  if (!Array.isArray(record.reviewers)) return record;
  return {
    ...record,
    reviewers: (record.reviewers as RawReviewer[]).map(projectReviewer),
  };
}

/**
 * Page a full result set in the tool layer.
 *
 * No delivery service takes a limit — these are governance registers the web UI
 * renders whole, so the query returns everything and we keep the first n. The
 * services order most-relevant-first (change requests newest, risks
 * severity-desc, deliverables board-order), so a head slice is the right slice.
 * `total` is the true count, which a SQL LIMIT would have cost a second query.
 */
export function page<T>(
  rows: T[],
  limit: number | undefined,
  deps: McpToolDeps,
): { total: number; items: T[] } {
  const size = clampLimit(limit, deps.s.maxPageSize, DEFAULT_PAGE);
  return { total: rows.length, items: rows.slice(0, size) };
}

export function registerDeliveryReadTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  // ── Deliverables ──────────────────────────────────────────────────────────

  defineTool(
    server,
    'deliverables_list',
    {
      title: 'List deliverables',
      description:
        'List a project’s deliverables with their acceptance criteria, reviewers, linked roadmap work and computed progress. Board order; optionally filter by status.',
      inputSchema: {
        project_id: z.string().uuid(),
        status: deliverableStatus.optional(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, status, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const rows = await deps.s.deliverables.list(project_id, uid, {
          status,
        });
        const { total, items } = page(rows as unknown[], limit, deps);
        return {
          project_id,
          total,
          deliverables: items.map(projectDeliverable),
        };
      }),
  );

  defineTool(
    server,
    'deliverable_get',
    {
      title: 'Get a deliverable',
      description:
        'One deliverable in full — acceptance criteria, reviewers and their decisions, linked work, attachments and progress.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, deliverable_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const deliverable = await deps.s.deliverables.get(
          project_id,
          deliverable_id,
          uid,
        );
        return { project_id, deliverable: projectDeliverable(deliverable) };
      }),
  );

  // ── Change requests ───────────────────────────────────────────────────────

  defineTool(
    server,
    'change_requests_list',
    {
      title: 'List change requests',
      description:
        'List a project’s change requests, newest first. `view` is the coarse grouping the app’s filter chips use: open, awaiting_decision, decided, closed, all. An exact `status` always wins over `view`.',
      inputSchema: {
        project_id: z.string().uuid(),
        status: changeRequestStatus.optional(),
        view: changeRequestView.optional(),
        requested_by: z.string().uuid().optional(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, status, view, requested_by, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const rows = await deps.s.changeRequests.list(project_id, uid, {
          status,
          view,
          requested_by,
        });
        const { total, items } = page(rows as unknown[], limit, deps);
        return { project_id, total, change_requests: items };
      }),
  );

  defineTool(
    server,
    'change_request_get',
    {
      title: 'Get a change request',
      description:
        'One change request in full — its impact, linked work, decision stamps, and the roadmap commit that applied it (if any).',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, change_request_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const change_request = await deps.s.changeRequests.get(
          project_id,
          change_request_id,
          uid,
        );
        return { project_id, change_request };
      }),
  );

  // ── Risks & issues ────────────────────────────────────────────────────────

  defineTool(
    server,
    'risks_list',
    {
      title: 'List risks and issues',
      description:
        'The project’s combined risk and issue register, most severe first. A risk has not happened yet and carries a likelihood; an issue already has. Rows marked internal are withheld unless you are entitled to see them — check `can_view_internal` before telling the user the register is complete.',
      inputSchema: {
        project_id: z.string().uuid(),
        kind: riskKind.optional(),
        status: riskStatus.optional(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, kind, status, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        // The only delivery list that returns a wrapper rather than an array.
        const result = await deps.s.risks.list(project_id, uid, {
          kind,
          status,
        });
        const { total, items } = page(result.items as unknown[], limit, deps);
        return {
          project_id,
          total,
          can_view_internal: result.can_view_internal,
          risks: items,
        };
      }),
  );

  defineTool(
    server,
    'risk_get',
    {
      title: 'Get a risk or issue',
      description:
        'One row from the risk & issue register. An internal row you are not entitled to see returns NOT_FOUND — that is not proof it does not exist.',
      inputSchema: {
        project_id: z.string().uuid(),
        risk_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, risk_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const risk = await deps.s.risks.get(project_id, risk_id, uid);
        return { project_id, risk };
      }),
  );

  defineTool(
    server,
    'risk_candidates_list',
    {
      title: 'List unregistered risk signals',
      description:
        'Blocked tasks and at-risk or missed milestones that nobody has entered in the register yet. Promote one with risk_create, passing a matching `links` target and `source_kind` so it is not re-keyed by hand.',
      inputSchema: { project_id: z.string().uuid() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const candidates = await deps.s.risks.candidates(project_id, uid);
        return { project_id, ...candidates };
      }),
  );

  // ── Decisions ─────────────────────────────────────────────────────────────

  defineTool(
    server,
    'decisions_list',
    {
      title: 'List decisions',
      description:
        'The project’s decision log, most recently decided first, with each decision’s options and linked work. Rows marked internal are withheld unless you are entitled to see them.',
      inputSchema: {
        project_id: z.string().uuid(),
        status: decisionStatus.optional(),
        category_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, status, category_id, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const rows = await deps.s.decisions.list(project_id, uid, {
          status,
          category_id,
        });
        const { total, items } = page(rows as unknown[], limit, deps);
        return { project_id, total, decisions: items };
      }),
  );

  defineTool(
    server,
    'decision_get',
    {
      title: 'Get a decision',
      description:
        'One decision in full — context, rationale, alternatives, the options weighed, linked work, and what it supersedes. An internal decision you are not entitled to see returns NOT_FOUND.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, decision_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const decision = await deps.s.decisions.get(
          project_id,
          decision_id,
          uid,
        );
        return { project_id, decision };
      }),
  );

  defineTool(
    server,
    'decision_categories_list',
    {
      title: 'List decision categories',
      description:
        'The project’s decision taxonomy. Resolve a category here before passing `category_id` to decision_create — categories are per-project and none are seeded by default.',
      inputSchema: { project_id: z.string().uuid() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        await assertProjectViewer(deps, project_id);
        const categories = await deps.s.decisionCategories.list(
          project_id,
          uid,
        );
        return { project_id, categories };
      }),
  );
}
