import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDeliverable } from './delivery.tools';
import {
  assertProjectViewer,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Delivery-governance writes.
 *
 * NOTE: there is deliberately NO `auditWrite` helper in this file, unlike
 * task-write.tools.ts and chat-write.tools.ts. All four delivery services call
 * `AuditService.log` themselves, with entity-correct metadata this layer could
 * not reproduce — a second `mcp.*` row would double-log the same event and
 * duplicate it into the RAG index (change_request.created/approved/applied and
 * decision.created/superseded are all INDEXABLE_ACTIONS). Provenance instead
 * comes from the request-level origin marker set in McpController, which merges
 * `{ via: 'mcp', scopes }` into the service's own row. Do not copy an audit
 * helper in here.
 *
 * Three inputs are deliberately NOT forwarded, each closing a real hole:
 *
 *  - `change_request_create.submit` — the DTO's `submit: true` fires the full
 *    decider notification fan-out in the same call, and `change_requests.create`
 *    is COMMENTER-tier, the lowest write bar in this whole server. Creating is
 *    always a draft here; notifying is its own confirmed call.
 *  - `decision_create.decided_by` — the service writes a caller-supplied value
 *    verbatim on a `final` decision. In the web UI that records who decided in a
 *    meeting; from a connector it is putting words in a named person's mouth in
 *    the system of record. The decider is always the caller.
 *    `source_chat_message_id` is omitted for the same reason: forged provenance.
 *  - `deliverable_create.reviewer_ids` — naming a reviewer IS the grant to
 *    decide, and the create path's `insertReviewers` skips the project_access
 *    membership check that `addReviewer` enforces.
 *
 * Every DTO below is a hand-built literal, never a spread of the tool args, so
 * a field added to the input schema later cannot silently reach the service.
 */

const linkTarget = z
  .object({
    epic_id: z.string().uuid().optional(),
    feature_id: z.string().uuid().optional(),
    task_id: z.string().uuid().optional(),
    milestone_id: z.string().uuid().optional(),
    deliverable_id: z.string().uuid().optional(),
  })
  .describe(
    'Exactly one target. Allowed targets differ per surface: change requests take epic/feature/task/deliverable (no milestone); deliverables take feature/task/milestone; risks and decisions take all five.',
  );

const visibility = z.enum(['internal', 'shared']);
const riskKind = z.enum(['risk', 'issue']);
const riskSeverity = z.enum(['low', 'medium', 'high', 'critical']);
const riskLikelihood = z.enum(['low', 'medium', 'high']);
const riskStatus = z.enum([
  'open',
  'mitigating',
  'monitoring',
  'resolved',
  'accepted',
  'closed',
]);

export function registerDeliveryWriteTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  /** Scope, then existence-safe project gate, for every write below. */
  const gate = async (projectId: string) => {
    requireScope(deps.caller, 'delivery:write');
    await assertProjectViewer(deps, projectId);
  };

  // ── Deliverables ──────────────────────────────────────────────────────────

  defineTool(
    server,
    'deliverable_create',
    {
      title: 'Create a deliverable',
      description:
        'Create a deliverable. Pass `criteria` to author its acceptance checklist and `links` to attach the roadmap work it covers. Reviewers cannot be named here — naming a reviewer grants them sign-off authority, so it stays a human action in the app.',
      inputSchema: {
        project_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(4000).optional(),
        acceptance_criteria: z.string().max(8000).optional(),
        roadmap_id: z.string().uuid().optional(),
        owner_id: z.string().uuid().optional(),
        due_date: z.string().optional(),
        links: z.array(linkTarget).optional(),
        criteria: z.array(z.string().max(300)).optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      title,
      description,
      acceptance_criteria,
      roadmap_id,
      owner_id,
      due_date,
      links,
      criteria,
    }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.create(project_id, uid, {
          title,
          description,
          acceptance_criteria,
          roadmap_id,
          owner_id,
          due_date,
          links,
          criteria,
        });
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_update',
    {
      title: 'Update a deliverable',
      description:
        'Update a deliverable’s fields. `status` only moves between not_started and in_progress — entering review or being accepted goes through deliverable_submit and deliverable_review so the stamps cannot be skipped.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional(),
        acceptance_criteria: z.string().max(8000).optional(),
        owner_id: z.string().uuid().nullable().optional(),
        due_date: z.string().nullable().optional(),
        position: z.number().int().min(0).optional(),
        status: z.enum(['not_started', 'in_progress']).optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      deliverable_id,
      title,
      description,
      acceptance_criteria,
      owner_id,
      due_date,
      position,
      status,
    }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.update(
          project_id,
          deliverable_id,
          uid,
          {
            title,
            description,
            acceptance_criteria,
            owner_id,
            due_date,
            position,
            status,
          },
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_submit',
    {
      title: 'Submit a deliverable for review',
      description:
        'Hand a deliverable to its reviewers. This RESETS every reviewer’s decision back to pending, so a resubmission erases sign-offs already given. Confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.submit(
          project_id,
          deliverable_id,
          uid,
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_review',
    {
      title: 'Review a deliverable',
      description:
        'Accept a deliverable or send it back. This is an act of authority in the user’s name and is recorded against them — state exactly what you are about to accept or reject and get explicit confirmation first. Only a named reviewer, or someone who can approve deliverables, may decide.',
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
        await gate(project_id);
        const deliverable = await deps.s.deliverables.review(
          project_id,
          deliverable_id,
          uid,
          { decision, review_note },
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  // ── Change requests ───────────────────────────────────────────────────────

  defineTool(
    server,
    'change_request_create',
    {
      title: 'Raise a change request',
      description:
        'Create a change request as a DRAFT. It notifies nobody until you call change_request_submit, so show the user the draft first. `impact_timeline_days` is signed — negative pulls the schedule in. There is deliberately no cost field: repricing is a contract amendment, not a change request.',
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
      },
      annotations: {},
    },
    async ({
      project_id,
      title,
      description,
      impact_scope,
      impact_timeline_days,
      target_date_before,
      target_date_after,
      roadmap_id,
      links,
    }) =>
      runTool(async () => {
        await gate(project_id);
        // `submit` is never forwarded — see the file header.
        const change_request = await deps.s.changeRequests.create(
          project_id,
          uid,
          {
            title,
            description,
            impact_scope,
            impact_timeline_days,
            target_date_before,
            target_date_after,
            roadmap_id,
            links,
          },
        );
        return { change_request };
      }),
  );

  defineTool(
    server,
    'change_request_update',
    {
      title: 'Update a change request',
      description:
        'Edit a change request that is still open. A decided or withdrawn request cannot be edited.',
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
    async ({
      project_id,
      change_request_id,
      title,
      description,
      impact_scope,
      impact_timeline_days,
      target_date_before,
      target_date_after,
      roadmap_id,
    }) =>
      runTool(async () => {
        await gate(project_id);
        const change_request = await deps.s.changeRequests.update(
          project_id,
          change_request_id,
          uid,
          {
            title,
            description,
            impact_scope,
            impact_timeline_days,
            target_date_before,
            target_date_after,
            roadmap_id,
          },
        );
        return { change_request };
      }),
  );

  defineTool(
    server,
    'change_request_submit',
    {
      title: 'Submit a change request for decision',
      description:
        'Send a draft change request for decision. This NOTIFIES everyone who can decide it. Confirm the exact content with the user before calling.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id }) =>
      runTool(async () => {
        await gate(project_id);
        const change_request = await deps.s.changeRequests.submit(
          project_id,
          change_request_id,
          uid,
        );
        return { change_request };
      }),
  );

  defineTool(
    server,
    'change_request_withdraw',
    {
      title: 'Withdraw a change request',
      description:
        'Take a change request off the table. Withdrawing is not reversible — a withdrawn request cannot be edited or resubmitted, so raise a new one instead.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id }) =>
      runTool(async () => {
        await gate(project_id);
        const change_request = await deps.s.changeRequests.withdraw(
          project_id,
          change_request_id,
          uid,
        );
        return { change_request };
      }),
  );

  defineTool(
    server,
    'change_request_decide',
    {
      title: 'Decide a change request',
      description:
        'Approve, reject, or send back a change request. This commits scope and schedule in the user’s name and notifies the requester — state exactly what you are deciding and get explicit confirmation first. Approving does NOT change the roadmap: apply it with roadmap_preview_operations then roadmap_commit_operations, and pass that commit’s change_id to change_request_mark_applied.',
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
        await gate(project_id);
        const change_request = await deps.s.changeRequests.decide(
          project_id,
          change_request_id,
          uid,
          { decision, decision_note },
        );
        return { change_request };
      }),
  );

  defineTool(
    server,
    'change_request_mark_applied',
    {
      title: 'Record a change request as applied',
      description:
        'Record that an approved change request reached the roadmap. `applied_change_id` must be the change_id returned by a roadmap_commit_operations call on THIS project — a commit from anywhere else is rejected. Run the commit first; this tool only records it.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
        applied_change_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id, applied_change_id }) =>
      runTool(async () => {
        await gate(project_id);
        const change_request = await deps.s.changeRequests.markApplied(
          project_id,
          change_request_id,
          uid,
          { applied_change_id },
        );
        return { change_request };
      }),
  );

  // ── Risks & issues ────────────────────────────────────────────────────────

  defineTool(
    server,
    'risk_create',
    {
      title: 'Log a risk or issue',
      description:
        'Add to the risk & issue register. A `risk` has not happened yet and REQUIRES a likelihood; an `issue` already has and must not carry one. Visibility defaults to internal (kept off client-facing surfaces) — only pass `shared` if the user says the client should see it.',
      inputSchema: {
        project_id: z.string().uuid(),
        kind: riskKind,
        title: z.string().min(1).max(200),
        description: z.string().max(4000).optional(),
        severity: riskSeverity.optional(),
        likelihood: riskLikelihood.optional(),
        impact: z.string().max(4000).optional(),
        mitigation: z.string().max(4000).optional(),
        owner_id: z.string().uuid().optional(),
        due_date: z.string().optional(),
        visibility: visibility.optional(),
        source_kind: z
          .enum(['manual', 'blocked_task', 'at_risk_milestone'])
          .optional(),
        links: z.array(linkTarget).optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      kind,
      title,
      description,
      severity,
      likelihood,
      impact,
      mitigation,
      owner_id,
      due_date,
      visibility: rowVisibility,
      source_kind,
      links,
    }) =>
      runTool(async () => {
        await gate(project_id);
        // `visibility` is forwarded as given — undefined included. Defaulting it
        // here would silently downgrade every agent-logged risk to client-visible.
        const risk = await deps.s.risks.create(project_id, uid, {
          kind,
          title,
          description,
          severity,
          likelihood,
          impact,
          mitigation,
          owner_id,
          due_date,
          visibility: rowVisibility,
          source_kind,
          links,
        });
        return { risk };
      }),
  );

  defineTool(
    server,
    'risk_update',
    {
      title: 'Update a risk or issue',
      description:
        'Update a register row. Moving `status` to resolved stamps who resolved it and when. An internal row you are not entitled to see returns NOT_FOUND.',
      inputSchema: {
        project_id: z.string().uuid(),
        risk_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(4000).optional(),
        severity: riskSeverity.optional(),
        likelihood: riskLikelihood.optional(),
        status: riskStatus.optional(),
        impact: z.string().max(4000).optional(),
        mitigation: z.string().max(4000).optional(),
        owner_id: z.string().uuid().nullable().optional(),
        due_date: z.string().nullable().optional(),
        visibility: visibility.optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      risk_id,
      title,
      description,
      severity,
      likelihood,
      status,
      impact,
      mitigation,
      owner_id,
      due_date,
      visibility: rowVisibility,
    }) =>
      runTool(async () => {
        await gate(project_id);
        const risk = await deps.s.risks.update(project_id, risk_id, uid, {
          title,
          description,
          severity,
          likelihood,
          status,
          impact,
          mitigation,
          owner_id,
          due_date,
          visibility: rowVisibility,
        });
        return { risk };
      }),
  );

  // ── Decisions ─────────────────────────────────────────────────────────────

  defineTool(
    server,
    'decision_create',
    {
      title: 'Record a decision',
      description:
        'Add to the decision log. `status` is required and you must choose deliberately: `final` records a decision already made and stamps YOU as its decider; `proposed` records one still to be settled, which a person then closes with decision_finalize. Visibility defaults to shared. Setting `supersedes_decision_id` irreversibly retires the named decision — confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        decision: z.string().min(1).max(4000),
        status: z.enum(['proposed', 'final']),
        context: z.string().max(4000).optional(),
        rationale: z.string().max(4000).optional(),
        alternatives_considered: z.string().max(4000).optional(),
        decided_on: z.string().optional(),
        category_id: z.string().uuid().optional(),
        visibility: visibility.optional(),
        supersedes_decision_id: z.string().uuid().optional(),
        links: z.array(linkTarget).optional(),
        options: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              detail: z.string().max(2000).optional(),
              is_selected: z.boolean().optional(),
            }),
          )
          .optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      title,
      decision,
      status,
      context,
      rationale,
      alternatives_considered,
      decided_on,
      category_id,
      visibility: rowVisibility,
      supersedes_decision_id,
      links,
      options,
    }) =>
      runTool(async () => {
        await gate(project_id);
        // `decided_by` and `source_chat_message_id` are never forwarded — see
        // the file header. The decider is always the caller.
        const record = await deps.s.decisions.create(project_id, uid, {
          title,
          decision,
          status,
          context,
          rationale,
          alternatives_considered,
          decided_on,
          category_id,
          visibility: rowVisibility,
          supersedes_decision_id,
          links,
          options,
        });
        return { decision: record };
      }),
  );

  defineTool(
    server,
    'decision_update',
    {
      title: 'Update a decision',
      description:
        'Edit a decision that has not been superseded. `status` is not editable here — moving a proposal to final is decision_finalize, so the decider stamps cannot be skipped. Pass `category_id: null` to clear the category.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        decision: z.string().min(1).max(4000).optional(),
        context: z.string().max(4000).optional(),
        rationale: z.string().max(4000).optional(),
        alternatives_considered: z.string().max(4000).optional(),
        decided_on: z.string().optional(),
        visibility: visibility.optional(),
        category_id: z.string().uuid().nullable().optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      decision_id,
      title,
      decision,
      context,
      rationale,
      alternatives_considered,
      decided_on,
      visibility: rowVisibility,
      category_id,
    }) =>
      runTool(async () => {
        await gate(project_id);
        const record = await deps.s.decisions.update(
          project_id,
          decision_id,
          uid,
          {
            title,
            decision,
            context,
            rationale,
            alternatives_considered,
            decided_on,
            visibility: rowVisibility,
            category_id,
          },
        );
        return { decision: record };
      }),
  );

  defineTool(
    server,
    'decision_finalize',
    {
      title: 'Finalize a decision',
      description:
        'Move a proposed decision to final, stamping the user as its decider. This is an act of authority in their name and is not reversible — confirm the exact wording with them first.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, decision_id }) =>
      runTool(async () => {
        await gate(project_id);
        const record = await deps.s.decisions.finalize(
          project_id,
          decision_id,
          uid,
        );
        return { decision: record };
      }),
  );
}
