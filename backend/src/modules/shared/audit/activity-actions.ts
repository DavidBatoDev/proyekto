/**
 * The project activity vocabulary.
 *
 * SOURCE OF TRUTH. Mirrored by hand in
 * web/src/components/project/logs/activityCatalog.ts, the same convention the
 * far larger permission catalog already uses. `scripts/check_activity_actions.mjs`
 * fails the build if the two drift.
 *
 * Actions are dotted `<entity_family>.<verb>`. Never rename an existing one:
 * rows carrying it already exist in project_activity_log and the feed would
 * render them as unknown.
 */

export const ACTIVITY_ACTIONS = {
  // ── Roadmap ───────────────────────────────────────────────────────────────
  ROADMAP_CREATED: 'roadmap.created',
  ROADMAP_UPDATED: 'roadmap.updated',
  ROADMAP_DELETED: 'roadmap.deleted',
  ROADMAP_REPLACED_FOR_PROJECT: 'roadmap.replaced_for_project',
  // Emitted by RoadmapAiService since before this module existed.
  ROADMAP_COMMITTED: 'roadmap.committed',
  ROADMAP_REVERTED: 'roadmap.reverted',
  ROADMAP_ROLLED_BACK: 'roadmap.rolled_back',
  ROADMAP_SHARE_CREATED: 'roadmap.share_created',
  ROADMAP_SHARE_REVOKED: 'roadmap.share_revoked',

  // ── Epic ──────────────────────────────────────────────────────────────────
  EPIC_CREATED: 'epic.created',
  EPIC_UPDATED: 'epic.updated',
  EPIC_STATUS_CHANGED: 'epic.status_changed',
  EPIC_DELETED: 'epic.deleted',
  EPIC_REORDERED: 'epic.reordered',
  EPIC_DUPLICATED: 'epic.duplicated',

  // ── Feature ───────────────────────────────────────────────────────────────
  FEATURE_CREATED: 'feature.created',
  FEATURE_UPDATED: 'feature.updated',
  FEATURE_STATUS_CHANGED: 'feature.status_changed',
  FEATURE_MOVED: 'feature.moved',
  FEATURE_DELETED: 'feature.deleted',
  FEATURE_REORDERED: 'feature.reordered',
  FEATURE_MILESTONE_LINKED: 'feature.milestone_linked',
  FEATURE_MILESTONE_UNLINKED: 'feature.milestone_unlinked',
  FEATURE_DUPLICATED: 'feature.duplicated',

  // ── Task ──────────────────────────────────────────────────────────────────
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_STATUS_CHANGED: 'task.status_changed',
  TASK_ASSIGNED: 'task.assigned',
  TASK_UNASSIGNED: 'task.unassigned',
  TASK_MOVED: 'task.moved',
  TASK_DELETED: 'task.deleted',
  TASK_REORDERED: 'task.reordered',
  TASK_DUPLICATED: 'task.duplicated',

  // ── Milestone ─────────────────────────────────────────────────────────────
  MILESTONE_CREATED: 'milestone.created',
  MILESTONE_UPDATED: 'milestone.updated',
  MILESTONE_DELETED: 'milestone.deleted',
  MILESTONE_REORDERED: 'milestone.reordered',

  // ── Comments ──────────────────────────────────────────────────────────────
  TASK_COMMENT_CREATED: 'task_comment.created',
  TASK_COMMENT_UPDATED: 'task_comment.updated',
  TASK_COMMENT_DELETED: 'task_comment.deleted',
  EPIC_COMMENT_CREATED: 'epic_comment.created',
  EPIC_COMMENT_UPDATED: 'epic_comment.updated',
  EPIC_COMMENT_DELETED: 'epic_comment.deleted',
  FEATURE_COMMENT_CREATED: 'feature_comment.created',
  FEATURE_COMMENT_UPDATED: 'feature_comment.updated',
  FEATURE_COMMENT_DELETED: 'feature_comment.deleted',

  // ── Task extras ───────────────────────────────────────────────────────────
  TASK_ATTACHMENT_ADDED: 'task_attachment.added',
  TASK_ATTACHMENT_REMOVED: 'task_attachment.removed',
  TASK_DEPENDENCY_ADDED: 'task_dependency.added',
  TASK_DEPENDENCY_REMOVED: 'task_dependency.removed',
  FEATURE_DEPENDENCY_ADDED: 'feature_dependency.added',
  FEATURE_DEPENDENCY_REMOVED: 'feature_dependency.removed',

  // ── Membership / access ───────────────────────────────────────────────────
  MEMBER_INVITED: 'member.invited',
  MEMBER_INVITE_RESPONDED: 'member.invite_responded',
  MEMBER_INVITE_REVOKED: 'member.invite_revoked',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_PERMISSIONS_CHANGED: 'member.permissions_changed',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_LEFT: 'member.left',
  PROJECT_OWNER_TRANSFERRED: 'project.owner_transferred',
  PROJECT_CONSULTANT_ASSIGNED: 'project.consultant_assigned',
  PROJECT_CONSULTANT_REASSIGNED: 'project.consultant_reassigned',

  // ── MCP connector writes ──────────────────────────────────────────────────
  // Emitted by mcp/tools/{task,comment,chat}-write.tools.ts since the MCP
  // server shipped, and predating this file — mcp.task_update already has rows
  // in production. They are namespaced rather than folded into the task.* /
  // *_comment.* families on purpose: "who did this" is a person for the
  // latter and an AI connector for these, which is exactly the distinction an
  // audit reader is looking for.
  MCP_TASK_CREATE: 'mcp.task_create',
  MCP_TASK_UPDATE: 'mcp.task_update',
  MCP_TASK_ASSIGN: 'mcp.task_assign',
  MCP_TASK_COMMENT_ADD: 'mcp.task_comment_add',
  MCP_EPIC_COMMENT_ADD: 'mcp.epic_comment_add',
  MCP_FEATURE_COMMENT_ADD: 'mcp.feature_comment_add',
  MCP_CHAT_SEND_MESSAGE: 'mcp.chat_send_message',
  MCP_CHAT_MESSAGE_EDIT: 'mcp.chat_message_edit',
  MCP_CHAT_MESSAGE_UNSEND: 'mcp.chat_message_unsend',

  // ── Pre-existing (chat + access). DO NOT RENAME — rows exist. ─────────────
  ACCESS_GRANTED: 'access.granted',
  ACCESS_REVOKED: 'access.revoked',
  CHANNEL_CREATED: 'channel.created',
  CHANNEL_UPDATED: 'channel.updated',
  CHANNEL_ARCHIVED: 'channel.archived',
  CHANNEL_MEMBER_ADDED: 'channel.member_added',
  CHANNEL_MEMBER_REMOVED: 'channel.member_removed',
  CHANNEL_LEFT: 'channel.left',
} as const;

export type ActivityAction =
  (typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS];

export const ACTIVITY_ENTITY_TYPES = [
  'roadmap',
  'epic',
  'feature',
  'task',
  'milestone',
  'task_comment',
  'epic_comment',
  'feature_comment',
  'task_attachment',
  'task_dependency',
  'feature_dependency',
  'roadmap_share',
  'project_member',
  'project_access',
  'chat_channel',
  // Emitted by mcp/tools/chat-write.tools.ts.
  'chat_message',
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/**
 * Actions whose rows are worth an embedding in the RAG index.
 *
 * DENY BY DEFAULT. Every audit row currently enqueues knowledge-ingest work
 * (AuditService.log). That is latent today because KNOWLEDGE_INGEST_ENABLED is
 * off, but once the recorder starts logging every task rename and drag-reorder
 * it would flood ai_knowledge_outbox and dilute the vector index with field
 * churn that carries no semantic content.
 *
 * Excluded deliberately:
 *  - `*.updated` / `*.status_changed` / `*.reordered` / `*.moved` / assignment
 *    — highest volume, lowest meaning.
 *  - `task.created` / `task.deleted` — highest-cardinality entity; the epic and
 *    feature creates already give the index the roadmap's shape.
 *  - every `*_comment.*` — task comments are ALREADY indexed as
 *    sourceType:'task_comment' (task-extras.service.ts), so indexing the
 *    activity row too would embed the same text twice.
 */
export const INDEXABLE_ACTIONS: ReadonlySet<string> = new Set<string>([
  ACTIVITY_ACTIONS.ROADMAP_CREATED,
  ACTIVITY_ACTIONS.ROADMAP_DELETED,
  ACTIVITY_ACTIONS.ROADMAP_COMMITTED,
  ACTIVITY_ACTIONS.ROADMAP_REVERTED,
  ACTIVITY_ACTIONS.ROADMAP_ROLLED_BACK,
  ACTIVITY_ACTIONS.EPIC_CREATED,
  ACTIVITY_ACTIONS.EPIC_DELETED,
  ACTIVITY_ACTIONS.FEATURE_CREATED,
  ACTIVITY_ACTIONS.FEATURE_DELETED,
  ACTIVITY_ACTIONS.MILESTONE_CREATED,
  ACTIVITY_ACTIONS.MILESTONE_DELETED,
  ACTIVITY_ACTIONS.ACCESS_GRANTED,
  ACTIVITY_ACTIONS.ACCESS_REVOKED,
  ACTIVITY_ACTIONS.CHANNEL_CREATED,
  ACTIVITY_ACTIONS.CHANNEL_ARCHIVED,
]);

/**
 * Actions hidden from readers lacking `logs.view_sensitive`. Everything here
 * either changes who can reach the project or hands out an access path.
 */
export const SENSITIVE_ACTIONS: ReadonlySet<string> = new Set<string>([
  ACTIVITY_ACTIONS.ACCESS_GRANTED,
  ACTIVITY_ACTIONS.ACCESS_REVOKED,
  ACTIVITY_ACTIONS.ROADMAP_SHARE_CREATED,
  ACTIVITY_ACTIONS.ROADMAP_SHARE_REVOKED,
  ACTIVITY_ACTIONS.MEMBER_ROLE_CHANGED,
  ACTIVITY_ACTIONS.MEMBER_PERMISSIONS_CHANGED,
  ACTIVITY_ACTIONS.MEMBER_REMOVED,
  ACTIVITY_ACTIONS.PROJECT_OWNER_TRANSFERRED,
]);

export function isSensitiveAction(action: string): boolean {
  return SENSITIVE_ACTIONS.has(action);
}

export function isIndexableAction(action: string): boolean {
  return INDEXABLE_ACTIONS.has(action);
}

/** `task.status_changed` -> `task`. Used by the read API's family filter. */
export function actionFamily(action: string): string {
  const dot = action.indexOf('.');
  return dot === -1 ? action : action.slice(0, dot);
}

export const ACTION_FAMILIES = [
  ...new Set(Object.values(ACTIVITY_ACTIONS).map(actionFamily)),
] as const;
