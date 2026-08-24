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
 * Delivery-governance sub-resource management: the in-page actions of the
 * deliverable, change-request and decision detail views — criteria, reviewers,
 * evidence, links, options, categories, and the deletes.
 *
 * These shipped AFTER the lifecycle tools, by an explicit product decision:
 * expose the full surface and let the caller's live role decide, rather than
 * withholding tools. Every call still runs scope -> assertProjectViewer ->
 * the domain service, which enforces the real permission
 * (deliverables.edit / change_requests.create / change_requests.decide /
 * decisions.edit) and the per-row visibility gates.
 *
 * Still deliberately NOT exposed, because they are identity or integrity
 * questions rather than capability ones:
 *  - `decided_by` / `source_chat_message_id` on decisions — the decider is
 *    always the caller; an agent must not put words in a named person's mouth.
 *  - `reviewer_ids` on deliverable_create — the create path skips the
 *    project_access membership check. deliverable_reviewer_add goes through
 *    `addReviewer`, which enforces it; that is the only reviewer door here.
 *  - `storage_key` / `mime_type` / `size_bytes` on attachments — they describe
 *    an uploaded object, and a connector has no upload path; it can only add
 *    link evidence.
 *  - `submit` on change_request_create — creating is silent, notifying is its
 *    own confirmed call (change_request_submit).
 *
 * The three link junctions allow DIFFERENT targets on purpose; each surface
 * gets its own schema below so a model cannot aim a milestone at a change
 * request and get a 400 it does not understand.
 *
 * NOTE: no `audit.log` calls in this file — the delivery services self-audit
 * where they audit at all, and provenance comes from the request origin marker
 * set in McpController. See delivery-write.tools.ts.
 */

/** deliverable_links: feature | task | milestone (no epic, no deliverable). */
const deliverableLinkTarget = z.object({
  feature_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  milestone_id: z.string().uuid().optional(),
});

/** change_request_links: epic | feature | task | deliverable (no milestone). */
const changeRequestLinkTarget = z.object({
  epic_id: z.string().uuid().optional(),
  feature_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  deliverable_id: z.string().uuid().optional(),
});

/** decision_links: all five targets. */
const decisionLinkTarget = z.object({
  epic_id: z.string().uuid().optional(),
  feature_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  milestone_id: z.string().uuid().optional(),
  deliverable_id: z.string().uuid().optional(),
});

const evidenceCategory = z.enum([
  'github',
  'figma',
  'deployment',
  'docs',
  'demo',
  'other',
]);

const categoryColor = z.enum([
  'slate',
  'blue',
  'violet',
  'teal',
  'amber',
  'rose',
  'emerald',
  'indigo',
]);
const categoryIcon = z.enum([
  'tag',
  'cpu',
  'palette',
  'crosshair',
  'briefcase',
  'workflow',
  'shield',
  'database',
]);

export function registerDeliveryManageTools(
  server: McpServer,
  deps: McpToolDeps,
) {
  const uid = deps.caller.userId;

  const gate = async (projectId: string) => {
    requireScope(deps.caller, 'delivery:write');
    await assertProjectViewer(deps, projectId);
  };

  // ── Deliverables: acceptance criteria ─────────────────────────────────────

  defineTool(
    server,
    'deliverable_criterion_add',
    {
      title: 'Add an acceptance criterion',
      description:
        'Add one item to a deliverable’s acceptance checklist. New criteria start unmet.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        label: z.string().min(1).max(300),
      },
      annotations: {},
    },
    async ({ project_id, deliverable_id, label }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.addCriterion(
          project_id,
          deliverable_id,
          uid,
          { label },
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_criterion_update',
    {
      title: 'Update an acceptance criterion',
      description:
        'Rename a criterion or set whether it is met. Ticking `is_met` records who and when; unticking clears both. Met criteria drive the deliverable’s progress percentage, so only mark one met when the user confirms the work is actually done.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        criterion_id: z.string().uuid(),
        label: z.string().min(1).max(300).optional(),
        is_met: z.boolean().optional(),
      },
      annotations: {},
    },
    async ({ project_id, deliverable_id, criterion_id, label, is_met }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.updateCriterion(
          project_id,
          deliverable_id,
          criterion_id,
          uid,
          { label, is_met },
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_criterion_remove',
    {
      title: 'Remove an acceptance criterion',
      description:
        'Delete a criterion from the checklist, including its met/unmet record. Not reversible — confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        criterion_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id, criterion_id }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.removeCriterion(
          project_id,
          deliverable_id,
          criterion_id,
          uid,
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  // ── Deliverables: reviewers ───────────────────────────────────────────────

  defineTool(
    server,
    'deliverable_reviewer_add',
    {
      title: 'Add a deliverable reviewer',
      description:
        'Name a project member as a reviewer. Being named IS the authority to accept or reject this deliverable, so confirm with the user before granting it. Only current project members are accepted.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        reviewer_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id, reviewer_id }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.addReviewer(
          project_id,
          deliverable_id,
          uid,
          { reviewer_id },
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_reviewer_remove',
    {
      title: 'Remove a deliverable reviewer',
      description:
        'Remove a reviewer and their sign-off. If they were the last reviewer still pending, the deliverable’s status is re-derived from the remaining decisions — removing them can COMPLETE the review. Confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        reviewer_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id, reviewer_id }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.removeReviewer(
          project_id,
          deliverable_id,
          reviewer_id,
          uid,
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  // ── Deliverables: evidence ────────────────────────────────────────────────

  defineTool(
    server,
    'deliverable_attachment_add',
    {
      title: 'Add deliverable evidence',
      description:
        'Attach link evidence (a PR, design, deployment, doc, or demo URL) to a deliverable. Reviewers rely on this pane when accepting work, so only attach URLs the user has provided or verified — never an address you inferred. File uploads are not possible from a connector.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        url: z.string().min(1).max(2000),
        category: evidenceCategory.optional(),
        label: z.string().max(200).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id, url, category, label }) =>
      runTool(async () => {
        await gate(project_id);
        // kind is pinned to 'link': the storage fields describe uploaded
        // objects, and a connector has no upload path.
        const deliverable = await deps.s.deliverables.addAttachment(
          project_id,
          deliverable_id,
          uid,
          { kind: 'link', url, category, label },
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_attachment_remove',
    {
      title: 'Remove deliverable evidence',
      description:
        'Delete an attachment from the evidence pane. Not reversible — confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        attachment_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id, attachment_id }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.removeAttachment(
          project_id,
          deliverable_id,
          attachment_id,
          uid,
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  // ── Deliverables: links + delete ──────────────────────────────────────────

  defineTool(
    server,
    'deliverable_link_add',
    {
      title: 'Link roadmap work to a deliverable',
      description:
        'Attach one roadmap item to a deliverable. Exactly one of feature_id, task_id or milestone_id — deliverable links do not take epics.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        target: deliverableLinkTarget,
      },
      annotations: {},
    },
    async ({ project_id, deliverable_id, target }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.addLink(
          project_id,
          deliverable_id,
          uid,
          target as Record<string, string>,
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_link_remove',
    {
      title: 'Unlink roadmap work from a deliverable',
      description: 'Remove one linked roadmap item by its link id.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
        link_id: z.string().uuid(),
      },
      annotations: {},
    },
    async ({ project_id, deliverable_id, link_id }) =>
      runTool(async () => {
        await gate(project_id);
        const deliverable = await deps.s.deliverables.removeLink(
          project_id,
          deliverable_id,
          link_id,
          uid,
        );
        return { deliverable: projectDeliverable(deliverable) };
      }),
  );

  defineTool(
    server,
    'deliverable_remove',
    {
      title: 'Delete a deliverable',
      description:
        'Permanently delete a deliverable with its criteria, reviewers, evidence and links. There is no undo and no archive — state exactly what will be lost and get the user’s explicit confirmation first.',
      inputSchema: {
        project_id: z.string().uuid(),
        deliverable_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, deliverable_id }) =>
      runTool(async () => {
        await gate(project_id);
        return deps.s.deliverables.remove(project_id, deliverable_id, uid);
      }),
  );

  // ── Change requests: links + delete ───────────────────────────────────────

  defineTool(
    server,
    'change_request_link_add',
    {
      title: 'Link roadmap work to a change request',
      description:
        'Attach one item the change bears on. Exactly one of epic_id, feature_id, task_id or deliverable_id — change-request links do not take milestones.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
        target: changeRequestLinkTarget,
      },
      annotations: {},
    },
    async ({ project_id, change_request_id, target }) =>
      runTool(async () => {
        await gate(project_id);
        const change_request = await deps.s.changeRequests.addLink(
          project_id,
          change_request_id,
          uid,
          target,
        );
        return { change_request };
      }),
  );

  defineTool(
    server,
    'change_request_link_remove',
    {
      title: 'Unlink roadmap work from a change request',
      description: 'Remove one linked item by its link id.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
        link_id: z.string().uuid(),
      },
      annotations: {},
    },
    async ({ project_id, change_request_id, link_id }) =>
      runTool(async () => {
        await gate(project_id);
        const change_request = await deps.s.changeRequests.removeLink(
          project_id,
          change_request_id,
          link_id,
          uid,
        );
        return { change_request };
      }),
  );

  defineTool(
    server,
    'change_request_remove',
    {
      title: 'Delete a change request',
      description:
        'Permanently delete a change request and its decision record. Requires decide authority. Prefer change_request_withdraw, which keeps the paper trail — delete only when the user explicitly wants the record gone, and confirm first.',
      inputSchema: {
        project_id: z.string().uuid(),
        change_request_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, change_request_id }) =>
      runTool(async () => {
        await gate(project_id);
        return deps.s.changeRequests.remove(project_id, change_request_id, uid);
      }),
  );

  // ── Decisions: links, options, delete ─────────────────────────────────────

  defineTool(
    server,
    'decision_link_add',
    {
      title: 'Link work to a decision',
      description:
        'Attach one item this decision bears on. Exactly one of epic_id, feature_id, task_id, milestone_id or deliverable_id.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
        target: decisionLinkTarget,
      },
      annotations: {},
    },
    async ({ project_id, decision_id, target }) =>
      runTool(async () => {
        await gate(project_id);
        const decision = await deps.s.decisions.addLink(
          project_id,
          decision_id,
          uid,
          target,
        );
        return { decision };
      }),
  );

  defineTool(
    server,
    'decision_link_remove',
    {
      title: 'Unlink work from a decision',
      description: 'Remove one linked item by its link id.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
        link_id: z.string().uuid(),
      },
      annotations: {},
    },
    async ({ project_id, decision_id, link_id }) =>
      runTool(async () => {
        await gate(project_id);
        const decision = await deps.s.decisions.removeLink(
          project_id,
          decision_id,
          link_id,
          uid,
        );
        return { decision };
      }),
  );

  defineTool(
    server,
    'decision_option_add',
    {
      title: 'Add a decision option',
      description:
        'Add an option that was weighed. Setting `is_selected` clears any previously selected sibling in the same write — at most one option can be the chosen one.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
        title: z.string().min(1).max(200),
        detail: z.string().max(2000).optional(),
        is_selected: z.boolean().optional(),
      },
      annotations: {},
    },
    async ({ project_id, decision_id, title, detail, is_selected }) =>
      runTool(async () => {
        await gate(project_id);
        const decision = await deps.s.decisions.addOption(
          project_id,
          decision_id,
          uid,
          { title, detail, is_selected },
        );
        return { decision };
      }),
  );

  defineTool(
    server,
    'decision_option_update',
    {
      title: 'Update a decision option',
      description:
        'Edit an option, or move the selection to it — selecting one deselects the previous choice in the same write.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
        option_id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        detail: z.string().max(2000).optional(),
        is_selected: z.boolean().optional(),
      },
      annotations: {},
    },
    async ({
      project_id,
      decision_id,
      option_id,
      title,
      detail,
      is_selected,
    }) =>
      runTool(async () => {
        await gate(project_id);
        const decision = await deps.s.decisions.updateOption(
          project_id,
          decision_id,
          option_id,
          uid,
          { title, detail, is_selected },
        );
        return { decision };
      }),
  );

  defineTool(
    server,
    'decision_option_remove',
    {
      title: 'Remove a decision option',
      description:
        'Delete an option and its detail. Not reversible — confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
        option_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, decision_id, option_id }) =>
      runTool(async () => {
        await gate(project_id);
        const decision = await deps.s.decisions.removeOption(
          project_id,
          decision_id,
          option_id,
          uid,
        );
        return { decision };
      }),
  );

  defineTool(
    server,
    'decision_remove',
    {
      title: 'Delete a decision',
      description:
        'Permanently delete a decision with its options and links. Prefer superseding (decision_create with supersedes_decision_id), which keeps the history — delete only when the user explicitly wants the record gone, and confirm first. An internal decision you cannot see returns NOT_FOUND.',
      inputSchema: {
        project_id: z.string().uuid(),
        decision_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, decision_id }) =>
      runTool(async () => {
        await gate(project_id);
        return deps.s.decisions.remove(project_id, decision_id, uid);
      }),
  );

  // ── Decision categories ───────────────────────────────────────────────────

  defineTool(
    server,
    'decision_category_create',
    {
      title: 'Create a decision category',
      description:
        'Add a category to the project’s decision taxonomy. Names are unique per project (case-insensitive) — a duplicate returns CONFLICT.',
      inputSchema: {
        project_id: z.string().uuid(),
        name: z.string().min(1).max(60),
        color: categoryColor.optional(),
        icon: categoryIcon.optional(),
      },
      annotations: {},
    },
    async ({ project_id, name, color, icon }) =>
      runTool(async () => {
        await gate(project_id);
        const category = await deps.s.decisionCategories.create(
          project_id,
          uid,
          { name, color, icon },
        );
        return { category };
      }),
  );

  defineTool(
    server,
    'decision_category_update',
    {
      title: 'Update a decision category',
      description: 'Rename, recolor or reorder a category.',
      inputSchema: {
        project_id: z.string().uuid(),
        category_id: z.string().uuid(),
        name: z.string().min(1).max(60).optional(),
        color: categoryColor.optional(),
        icon: categoryIcon.optional(),
        position: z.number().int().min(0).optional(),
      },
      annotations: {},
    },
    async ({ project_id, category_id, name, color, icon, position }) =>
      runTool(async () => {
        await gate(project_id);
        const category = await deps.s.decisionCategories.update(
          project_id,
          category_id,
          uid,
          { name, color, icon, position },
        );
        return { category };
      }),
  );

  defineTool(
    server,
    'decision_category_remove',
    {
      title: 'Delete a decision category',
      description:
        'Delete a category. Decisions that carried it are kept but left uncategorized — the result reports how many were orphaned. Confirm with the user first.',
      inputSchema: {
        project_id: z.string().uuid(),
        category_id: z.string().uuid(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, category_id }) =>
      runTool(async () => {
        await gate(project_id);
        return deps.s.decisionCategories.remove(project_id, category_id, uid);
      }),
  );
}
