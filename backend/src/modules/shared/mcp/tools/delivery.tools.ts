import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CHANGE_REQUEST_STATUSES,
  DELIVERABLE_STATUSES,
  RISK_KINDS,
  RISK_STATUSES,
} from '../../../execution/delivery/dto/delivery.dto';
import {
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
 * Phase 5 reads over the delivery governance registers. Gated by
 * `delivery:read`; every service call re-asserts the live `access.delivery`
 * permission, and the risk/decision services additionally filter `internal`
 * rows for callers without `risks.view_internal` / the decisions equivalent —
 * so the tool layer never sees data the web UI would withhold.
 *
 * The services return full result sets (the register pages render them all),
 * so lists are clamped here the way `task_comments_list` clamps threads.
 */
export function registerDeliveryTools(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  // The services return the whole register, so a page is exact and the total
  // is known. `total` is kept beside `total_items` because hosts (and specs)
  // already read it.
  const capped = <T>(rows: T[], limit?: number, offset?: number) => ({
    ...pageFromStart(rows, 'items', {
      offset: clampOffset(offset),
      limit: clampLimit(limit, deps.s.maxPageSize, 50),
      complete: true,
    }),
    total: rows.length,
  });

  defineTool(
    server,
    'deliverables_list',
    {
      title: 'List deliverables',
      description:
        'List the deliverables register of a project, with acceptance-criteria progress, optionally filtered by status.' +
        pagingClause(50, 50),
      inputSchema: {
        project_id: z.string().uuid(),
        status: z.enum(DELIVERABLE_STATUSES).optional(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      project_id,
      status,
      limit,
      offset,
    }: {
      project_id: string;
      status?: (typeof DELIVERABLE_STATUSES)[number];
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        const rows = await deps.s.deliverables.list(project_id, uid, {
          status,
        });
        return capped(rows, limit, offset);
      }),
  );

  defineTool(
    server,
    'deliverable_get',
    {
      title: 'Get a deliverable',
      description:
        'Fetch one deliverable with its acceptance criteria, reviewers, attachments, and roadmap links.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, deliverable_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        return deps.s.deliverables.get(project_id, deliverable_id, uid);
      }),
  );

  defineTool(
    server,
    'change_requests_list',
    {
      title: 'List change requests',
      description:
        'List the change-request register of a project. `status` filters exactly; `view` is the coarse grouping (open / awaiting_decision / decided / closed) and is ignored when `status` is given.' +
        pagingClause(50, 50),
      inputSchema: {
        project_id: z.string().uuid(),
        status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
        view: z
          .enum(['open', 'awaiting_decision', 'decided', 'closed', 'all'])
          .optional(),
        requested_by: z.string().uuid().optional(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      project_id,
      status,
      view,
      requested_by,
      limit,
      offset,
    }: {
      project_id: string;
      status?: (typeof CHANGE_REQUEST_STATUSES)[number];
      view?: 'open' | 'awaiting_decision' | 'decided' | 'closed' | 'all';
      requested_by?: string;
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        const rows = await deps.s.changeRequests.list(project_id, uid, {
          status,
          view,
          requested_by,
        });
        return capped(rows, limit, offset);
      }),
  );

  defineTool(
    server,
    'change_request_get',
    {
      title: 'Get a change request',
      description:
        'Fetch one change request with its impact fields, roadmap links, and submission/decision stamps.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, change_request_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        return deps.s.changeRequests.get(project_id, change_request_id, uid);
      }),
  );

  defineTool(
    server,
    'risks_list',
    {
      title: 'List risks & issues',
      description:
        'List the risk & issue register of a project, ordered by severity. Internal-only rows are omitted unless you hold the view-internal permission.' +
        pagingClause(50, 50),
      inputSchema: {
        project_id: z.string().uuid(),
        kind: z.enum(RISK_KINDS).optional(),
        status: z.enum(RISK_STATUSES).optional(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      project_id,
      kind,
      status,
      limit,
      offset,
    }: {
      project_id: string;
      kind?: (typeof RISK_KINDS)[number];
      status?: (typeof RISK_STATUSES)[number];
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        const result = await deps.s.risks.list(project_id, uid, {
          kind,
          status,
        });
        return {
          ...capped(result.items, limit, offset),
          can_view_internal: result.can_view_internal,
        };
      }),
  );

  defineTool(
    server,
    'decisions_list',
    {
      title: 'List decisions',
      description:
        'List the decision register of a project, newest decided first, optionally filtered by status or category. Internal-only rows are omitted unless permitted.' +
        pagingClause(50, 50),
      inputSchema: {
        project_id: z.string().uuid(),
        status: z.enum(['proposed', 'final', 'superseded']).optional(),
        category_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      project_id,
      status,
      category_id,
      limit,
      offset,
    }: {
      project_id: string;
      status?: 'proposed' | 'final' | 'superseded';
      category_id?: string;
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        const rows = await deps.s.decisions.list(project_id, uid, {
          status,
          category_id,
        });
        return capped(rows, limit, offset);
      }),
  );

  defineTool(
    server,
    'decision_get',
    {
      title: 'Get a decision',
      description:
        'Fetch one decision with its weighed options, links, and supersession chain.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, decision_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:read');
        return deps.s.decisions.get(project_id, decision_id, uid);
      }),
  );

  defineTool(
    server,
    'decision_categories_list',
    {
      title: 'List decision categories',
      description:
        "List a project's decision categories." + pagingClause(50, 50),
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
        requireScope(deps.caller, 'delivery:read');
        const rows = await deps.s.decisionCategories.list(project_id, uid);
        return capped(rows, limit, offset);
      }),
  );
}
