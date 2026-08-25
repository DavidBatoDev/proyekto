import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  RISK_KINDS,
  RISK_LIKELIHOODS,
  RISK_SEVERITIES,
  RISK_STATUSES,
  VISIBILITIES,
} from '../../../execution/delivery/dto/delivery.dto';
import {
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Phase 5 writes over the delivery governance registers. Live on deploy by
 * owner decision (2026-08-25) — no per-feature flag; the per-credential
 * `delivery:write` scope opt-in is the gate. Every call additionally
 * re-asserts the live permission inside
 * the service (`deliverables.edit` / `deliverables.approve` /
 * `change_requests.create` / `change_requests.decide` / `risks.edit` /
 * `decisions.edit`), and the services self-audit through the global
 * AuditService — which is why, unlike the task writes, these tools emit no
 * audit rows of their own: they would double-log.
 *
 * Lifecycle verbs (submit / review / decide / finalize) are separate tools on
 * purpose, mirroring the REST controller: the update DTOs cannot reach the
 * reviewed/decided statuses, so the submitted_by / reviewed_by / decided_by
 * stamps can never be skipped.
 *
 * Deletes are deliberately not exposed — the registers are audit trails, and
 * destructive cleanup belongs in the web UI.
 */

/** Exactly one target set — the service re-checks and 400s otherwise. */
const linkTarget = z.object({
  epic_id: z.string().uuid().optional(),
  feature_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  milestone_id: z.string().uuid().optional(),
  deliverable_id: z.string().uuid().optional(),
});

const decisionOption = z.object({
  title: z.string().min(1).max(200),
  detail: z.string().max(2000).optional(),
  is_selected: z.boolean().optional(),
});

export function registerDeliveryWriteTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  // ── Deliverables ──────────────────────────────────────────────────────────

  defineTool(
    server,
    'deliverable_create',
    {
      title: 'Create a deliverable',
      description:
        'Add a deliverable to the register, optionally with acceptance criteria (in order), reviewers, an owner, and roadmap links — all in one call. Naming an owner or reviewers does not notify them.',
      inputSchema: {
        project_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(4000).optional(),
        acceptance_criteria: z.string().max(8000).optional(),
        roadmap_id: z.string().uuid().optional(),
        owner_id: z.string().uuid().optional(),
        due_date: z.string().optional(),
        links: z.array(linkTarget).optional(),
        criteria: z.array(z.string().min(1).max(300)).optional(),
        reviewer_ids: z.array(z.string().uuid()).optional(),
      },
      annotations: {},
    },
    async ({ project_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.deliverables.create(project_id, uid, dto);
      }),
  );

  defineTool(
    server,
    'deliverable_update',
    {
      title: 'Update a deliverable',
      description:
        'Update a deliverable’s fields, owner, or due date. Status here only accepts not_started / in_progress — moving into or out of review goes through deliverable_submit / deliverable_review so the stamps cannot be skipped.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional(),
        acceptance_criteria: z.string().max(8000).optional(),
        owner_id: z.string().uuid().nullable().optional(),
        due_date: z.string().nullable().optional(),
        position: z.number().int().optional(),
        status: z.enum(['not_started', 'in_progress']).optional(),
      },
      annotations: {},
    },
    async ({ project_id, deliverable_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.deliverables.update(project_id, deliverable_id, uid, dto);
      }),
  );

  defineTool(
    server,
    'deliverable_submit',
    {
      title: 'Submit a deliverable for review',
      description:
        'Hand a deliverable to its reviewers (status → in_review, stamps the submitter). Confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.deliverables.submit(project_id, deliverable_id, uid);
      }),
  );

  defineTool(
    server,
    'deliverable_review',
    {
      title: 'Review a deliverable',
      description:
        'Record a review verdict (approved or changes_requested) with an optional note. Stamps the reviewer, so confirm with the user first. Requires the approve permission.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        decision: z.enum(['approved', 'changes_requested']),
        review_note: z.string().max(2000).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id, decision, review_note }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.deliverables.review(project_id, deliverable_id, uid, {
          decision,
          review_note,
        });
      }),
  );

  // ── Change requests ───────────────────────────────────────────────────────

  defineTool(
    server,
    'change_request_create',
    {
      title: 'Create a change request',
      description:
        'Raise a change request as a draft, optionally with roadmap links and impact fields. Pass submit: true to raise-and-submit in one step — submitting notifies everyone who can decide, so confirm with the user first when submitting.',
      inputSchema: {
        project_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(8000).optional(),
        impact_scope: z.string().max(4000).optional(),
        impact_timeline_days: z.number().int().optional(),
        target_date_before: z.string().optional(),
        target_date_after: z.string().optional(),
        roadmap_id: z.string().uuid().optional(),
        links: z.array(linkTarget).optional(),
        submit: z.boolean().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.changeRequests.create(project_id, uid, dto);
      }),
  );

  defineTool(
    server,
    'change_request_update',
    {
      title: 'Update a change request',
      description:
        'Edit a change request’s fields, including attaching the roadmap it will be applied against. Status never changes here — use the submit / withdraw / decide tools.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(8000).optional(),
        impact_scope: z.string().max(4000).optional(),
        impact_timeline_days: z.number().int().nullable().optional(),
        target_date_before: z.string().nullable().optional(),
        target_date_after: z.string().nullable().optional(),
        roadmap_id: z.string().uuid().nullable().optional(),
      },
      annotations: {},
    },
    async ({ project_id, change_request_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.changeRequests.update(
          project_id,
          change_request_id,
          uid,
          dto,
        );
      }),
  );

  defineTool(
    server,
    'change_request_submit',
    {
      title: 'Submit a change request',
      description:
        'Submit a draft change request for decision. This notifies every member who can decide it, so confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.changeRequests.submit(project_id, change_request_id, uid);
      }),
  );

  defineTool(
    server,
    'change_request_withdraw',
    {
      title: 'Withdraw a change request',
      description: 'Withdraw a submitted change request (the requester’s own corrective action).',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.changeRequests.withdraw(
          project_id,
          change_request_id,
          uid,
        );
      }),
  );

  defineTool(
    server,
    'change_request_decide',
    {
      title: 'Decide a change request',
      description:
        'Record the decision on a submitted change request (approved / rejected / changes_requested) with an optional note. Notifies the requester and stamps the decider, so confirm with the user first. Requires the decide permission.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
        decision: z.enum(['approved', 'rejected', 'changes_requested']),
        decision_note: z.string().max(2000).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id, decision, decision_note }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.changeRequests.decide(
          project_id,
          change_request_id,
          uid,
          { decision, decision_note },
        );
      }),
  );

  defineTool(
    server,
    'change_request_mark_applied',
    {
      title: 'Mark a change request applied',
      description:
        'Record that an approved change request reached the roadmap. Perform the roadmap edit first via the normal preview → commit protocol, then pass the resulting change_id here — approval never writes the roadmap itself.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
        applied_change_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id, applied_change_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.changeRequests.markApplied(
          project_id,
          change_request_id,
          uid,
          { applied_change_id },
        );
      }),
  );

  // ── Risks & issues ────────────────────────────────────────────────────────

  defineTool(
    server,
    'risk_create',
    {
      title: 'Create a risk or issue',
      description:
        'Add a risk or issue to the register with severity, likelihood (risks only), owner, mitigation, and roadmap links. Naming an owner does not notify them.',
      inputSchema: {
        project_id: z.string().uuid(),
        kind: z.enum(RISK_KINDS),
        title: z.string().min(1).max(200),
        description: z.string().max(4000).optional(),
        severity: z.enum(RISK_SEVERITIES).optional(),
        likelihood: z.enum(RISK_LIKELIHOODS).optional(),
        impact: z.string().max(4000).optional(),
        mitigation: z.string().max(4000).optional(),
        owner_id: z.string().uuid().optional(),
        due_date: z.string().optional(),
        visibility: z.enum(VISIBILITIES).optional(),
        links: z.array(linkTarget).optional(),
      },
      annotations: {},
    },
    async ({ project_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.risks.create(project_id, uid, dto);
      }),
  );

  defineTool(
    server,
    'risk_update',
    {
      title: 'Update a risk or issue',
      description:
        'Update a register entry, including its status ladder (open / mitigating / monitoring / resolved / accepted / closed), owner, and visibility.',
      inputSchema: {
        project_id: z.string().uuid(),
        risk_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional(),
        severity: z.enum(RISK_SEVERITIES).optional(),
        likelihood: z.enum(RISK_LIKELIHOODS).optional(),
        status: z.enum(RISK_STATUSES).optional(),
        impact: z.string().max(4000).optional(),
        mitigation: z.string().max(4000).optional(),
        owner_id: z.string().uuid().nullable().optional(),
        due_date: z.string().nullable().optional(),
        visibility: z.enum(VISIBILITIES).optional(),
      },
      annotations: {},
    },
    async ({ project_id, risk_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.risks.update(project_id, risk_id, uid, dto);
      }),
  );

  // ── Decisions ─────────────────────────────────────────────────────────────

  defineTool(
    server,
    'decision_create',
    {
      title: 'Create a decision',
      description:
        'Record a decision, optionally with the options that were weighed (in order, one selectable), roadmap links, a category, and the decision it supersedes — all in one call.',
      inputSchema: {
        project_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        decision: z.string().min(1).max(4000),
        context: z.string().max(4000).optional(),
        rationale: z.string().max(4000).optional(),
        alternatives_considered: z.string().max(4000).optional(),
        decided_on: z.string().optional(),
        decided_by: z.string().uuid().optional(),
        supersedes_decision_id: z.string().uuid().optional(),
        visibility: z.enum(VISIBILITIES).optional(),
        category_id: z.string().uuid().optional(),
        status: z.enum(['proposed', 'final']).optional(),
        links: z.array(linkTarget).optional(),
        options: z.array(decisionOption).optional(),
      },
      annotations: {},
    },
    async ({ project_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.decisions.create(project_id, uid, dto);
      }),
  );

  defineTool(
    server,
    'decision_update',
    {
      title: 'Update a decision',
      description:
        'Update a decision’s fields. Status never changes here — moving proposed → final goes through decision_finalize so the stamps cannot be skipped.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        decision: z.string().min(1).max(4000).optional(),
        context: z.string().max(4000).optional(),
        rationale: z.string().max(4000).optional(),
        alternatives_considered: z.string().max(4000).optional(),
        decided_on: z.string().optional(),
        visibility: z.enum(VISIBILITIES).optional(),
        category_id: z.string().uuid().nullable().optional(),
      },
      annotations: {},
    },
    async ({ project_id, decision_id, ...dto }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.decisions.update(project_id, decision_id, uid, dto);
      }),
  );

  defineTool(
    server,
    'decision_finalize',
    {
      title: 'Finalize a decision',
      description:
        'Move a proposed decision to final, stamping who decided and when. Confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, decision_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'delivery:write');
        return deps.s.decisions.finalize(project_id, decision_id, uid);
      }),
  );
}
