import {
	Activity,
	ArrowRightLeft,
	ArrowUpDown,
	Bot,
	CircleCheck,
	Copy,
	FolderTree,
	Gavel,
	GitCommitHorizontal,
	Link2,
	Link2Off,
	type LucideIcon,
	MessageSquare,
	Milestone,
	Paperclip,
	Pencil,
	Plus,
	Redo2,
	Send,
	Share2,
	ShieldCheck,
	Trash2,
	Undo2,
	UserMinus,
	UserPlus,
	Users,
} from "lucide-react";
import type { ActivityEntry } from "@/services/activity.service";

/**
 * MIRROR of backend/src/modules/audit/activity-actions.ts.
 *
 * That file is the source of truth. This copy exists because there is no
 * shared TS package in this monorepo (the far larger permission catalog uses
 * the same convention). `scripts/check_activity_actions.mjs` compares the two
 * in order and fails the build on any drift — keys, values and ordering.
 *
 * NEVER rename an action: rows carrying it already exist in
 * project_activity_log and the feed would render them as unknown.
 */
export const ACTIVITY_ACTIONS = {
	ROADMAP_CREATED: "roadmap.created",
	ROADMAP_UPDATED: "roadmap.updated",
	ROADMAP_DELETED: "roadmap.deleted",
	ROADMAP_REPLACED_FOR_PROJECT: "roadmap.replaced_for_project",
	ROADMAP_COMMITTED: "roadmap.committed",
	ROADMAP_REVERTED: "roadmap.reverted",
	ROADMAP_ROLLED_BACK: "roadmap.rolled_back",
	ROADMAP_SHARE_CREATED: "roadmap.share_created",
	ROADMAP_SHARE_REVOKED: "roadmap.share_revoked",
	EPIC_CREATED: "epic.created",
	EPIC_UPDATED: "epic.updated",
	EPIC_STATUS_CHANGED: "epic.status_changed",
	EPIC_DELETED: "epic.deleted",
	EPIC_REORDERED: "epic.reordered",
	EPIC_DUPLICATED: "epic.duplicated",
	FEATURE_CREATED: "feature.created",
	FEATURE_UPDATED: "feature.updated",
	FEATURE_STATUS_CHANGED: "feature.status_changed",
	FEATURE_MOVED: "feature.moved",
	FEATURE_DELETED: "feature.deleted",
	FEATURE_REORDERED: "feature.reordered",
	FEATURE_MILESTONE_LINKED: "feature.milestone_linked",
	FEATURE_MILESTONE_UNLINKED: "feature.milestone_unlinked",
	FEATURE_DUPLICATED: "feature.duplicated",
	TASK_CREATED: "task.created",
	TASK_UPDATED: "task.updated",
	TASK_STATUS_CHANGED: "task.status_changed",
	TASK_ASSIGNED: "task.assigned",
	TASK_UNASSIGNED: "task.unassigned",
	TASK_MOVED: "task.moved",
	TASK_DELETED: "task.deleted",
	TASK_REORDERED: "task.reordered",
	TASK_DUPLICATED: "task.duplicated",
	MILESTONE_CREATED: "milestone.created",
	MILESTONE_UPDATED: "milestone.updated",
	MILESTONE_DELETED: "milestone.deleted",
	MILESTONE_REORDERED: "milestone.reordered",
	TASK_COMMENT_CREATED: "task_comment.created",
	TASK_COMMENT_UPDATED: "task_comment.updated",
	TASK_COMMENT_DELETED: "task_comment.deleted",
	EPIC_COMMENT_CREATED: "epic_comment.created",
	EPIC_COMMENT_UPDATED: "epic_comment.updated",
	EPIC_COMMENT_DELETED: "epic_comment.deleted",
	FEATURE_COMMENT_CREATED: "feature_comment.created",
	FEATURE_COMMENT_UPDATED: "feature_comment.updated",
	FEATURE_COMMENT_DELETED: "feature_comment.deleted",
	TASK_ATTACHMENT_ADDED: "task_attachment.added",
	TASK_ATTACHMENT_REMOVED: "task_attachment.removed",
	TASK_DEPENDENCY_ADDED: "task_dependency.added",
	TASK_DEPENDENCY_REMOVED: "task_dependency.removed",
	FEATURE_DEPENDENCY_ADDED: "feature_dependency.added",
	FEATURE_DEPENDENCY_REMOVED: "feature_dependency.removed",
	MEMBER_INVITED: "member.invited",
	MEMBER_INVITE_RESPONDED: "member.invite_responded",
	MEMBER_INVITE_REVOKED: "member.invite_revoked",
	MEMBER_ROLE_CHANGED: "member.role_changed",
	MEMBER_PERMISSIONS_CHANGED: "member.permissions_changed",
	MEMBER_REMOVED: "member.removed",
	MEMBER_LEFT: "member.left",
	PROJECT_OWNER_TRANSFERRED: "project.owner_transferred",
	PROJECT_CONSULTANT_ASSIGNED: "project.consultant_assigned",
	PROJECT_CONSULTANT_REASSIGNED: "project.consultant_reassigned",
	MCP_TASK_CREATE: "mcp.task_create",
	MCP_TASK_UPDATE: "mcp.task_update",
	MCP_TASK_ASSIGN: "mcp.task_assign",
	MCP_TASK_COMMENT_ADD: "mcp.task_comment_add",
	MCP_EPIC_COMMENT_ADD: "mcp.epic_comment_add",
	MCP_FEATURE_COMMENT_ADD: "mcp.feature_comment_add",
	MCP_CHAT_SEND_MESSAGE: "mcp.chat_send_message",
	MCP_CHAT_MESSAGE_EDIT: "mcp.chat_message_edit",
	MCP_CHAT_MESSAGE_UNSEND: "mcp.chat_message_unsend",
	DELIVERABLE_CREATED: "deliverable.created",
	DELIVERABLE_UPDATED: "deliverable.updated",
	DELIVERABLE_SUBMITTED: "deliverable.submitted",
	DELIVERABLE_APPROVED: "deliverable.approved",
	DELIVERABLE_CHANGES_REQUESTED: "deliverable.changes_requested",
	DELIVERABLE_DELETED: "deliverable.deleted",
	DELIVERABLE_LINK_ADDED: "deliverable.link_added",
	DELIVERABLE_LINK_REMOVED: "deliverable.link_removed",
	CHANGE_REQUEST_CREATED: "change_request.created",
	CHANGE_REQUEST_UPDATED: "change_request.updated",
	CHANGE_REQUEST_SUBMITTED: "change_request.submitted",
	CHANGE_REQUEST_APPROVED: "change_request.approved",
	CHANGE_REQUEST_REJECTED: "change_request.rejected",
	CHANGE_REQUEST_CHANGES_REQUESTED: "change_request.changes_requested",
	CHANGE_REQUEST_WITHDRAWN: "change_request.withdrawn",
	CHANGE_REQUEST_APPLIED: "change_request.applied",
	CHANGE_REQUEST_DELETED: "change_request.deleted",
	CHANGE_REQUEST_LINK_ADDED: "change_request.link_added",
	CHANGE_REQUEST_LINK_REMOVED: "change_request.link_removed",
	RISK_CREATED: "risk.created",
	RISK_UPDATED: "risk.updated",
	RISK_STATUS_CHANGED: "risk.status_changed",
	RISK_OWNER_CHANGED: "risk.owner_changed",
	RISK_DELETED: "risk.deleted",
	DECISION_CREATED: "decision.created",
	DECISION_UPDATED: "decision.updated",
	DECISION_FINALIZED: "decision.finalized",
	DECISION_SUPERSEDED: "decision.superseded",
	DECISION_DELETED: "decision.deleted",
	ACCESS_GRANTED: "access.granted",
	ACCESS_REVOKED: "access.revoked",
	CHANNEL_CREATED: "channel.created",
	CHANNEL_UPDATED: "channel.updated",
	CHANNEL_ARCHIVED: "channel.archived",
	CHANNEL_MEMBER_ADDED: "channel.member_added",
	CHANNEL_MEMBER_REMOVED: "channel.member_removed",
	CHANNEL_LEFT: "channel.left",
} as const;

export type ActivityAction =
	(typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS];

export const ACTIVITY_ENTITY_TYPES = [
	"roadmap",
	"epic",
	"feature",
	"task",
	"milestone",
	"task_comment",
	"epic_comment",
	"feature_comment",
	"task_attachment",
	"task_dependency",
	"feature_dependency",
	"roadmap_share",
	"project_member",
	"project_access",
	"chat_channel",
	"chat_message",
	"deliverable",
	"deliverable_link",
	"change_request",
	"change_request_link",
	"risk",
	"decision",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** `task.status_changed` -> `task`. */
export function actionFamily(action: string): string {
	const dot = action.indexOf(".");
	return dot === -1 ? action : action.slice(0, dot);
}

export const ACTION_FAMILIES = [
	...new Set(Object.values(ACTIVITY_ACTIONS).map(actionFamily)),
] as const;

/** Human labels for the family filter. */
export const ACTION_FAMILY_LABELS: Record<string, string> = {
	roadmap: "Roadmap",
	epic: "Epics",
	feature: "Features",
	task: "Tasks",
	milestone: "Milestones",
	task_comment: "Task comments",
	epic_comment: "Epic comments",
	feature_comment: "Feature comments",
	task_attachment: "Attachments",
	task_dependency: "Dependencies",
	feature_dependency: "Feature dependencies",
	member: "Members",
	project: "Project",
	mcp: "AI connector",
	deliverable: "Deliverables",
	change_request: "Change requests",
	risk: "Risks & issues",
	decision: "Decisions",
	access: "Access",
	channel: "Channels",
};

// ─── Presentation registry ───────────────────────────────────────────────────

export type ActivityTone =
	| "neutral"
	| "create"
	| "destroy"
	| "sensitive"
	| "ai";

export interface ActivityCopy {
	icon: LucideIcon;
	tone: ActivityTone;
	/** Past-tense verb phrase; the actor's name is rendered before it. */
	verb: string;
	/** Object of the sentence. MUST NOT throw on absent metadata. */
	object: (entry: ActivityEntry) => string;
}

type Meta = Record<string, unknown>;

const str = (meta: Meta, key: string): string | null => {
	const value = meta?.[key];
	return typeof value === "string" && value.trim() ? value : null;
};
const num = (meta: Meta, key: string): number | null => {
	const value = meta?.[key];
	return typeof value === "number" ? value : null;
};

/** "epic" -> "an epic"; "task" -> "a task". */
function withArticle(noun: string): string {
	return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/**
 * The entity's name as it was AT THE TIME, denormalized into metadata by the
 * recorder. Never synthesise one from entity_id: "epic 7f3a-…" is noise, and
 * the row may describe something that no longer exists.
 */
function named(entry: ActivityEntry, fallback: string): string {
	const title = str(entry.metadata as Meta, "title");
	return title ? `${fallback} “${title}”` : withArticle(fallback);
}

const plural = (n: number | null, one: string, many: string) =>
	n === 1 ? `1 ${one}` : `${n ?? 0} ${many}`;

function reordered(entry: ActivityEntry, noun: string): string {
	return plural(num(entry.metadata as Meta, "item_count"), noun, `${noun}s`);
}

function commentOn(entry: ActivityEntry, parent: string): string {
	const on = `on ${withArticle(parent)}`;
	const excerpt = str(entry.metadata as Meta, "excerpt");
	return excerpt ? `${on}: “${excerpt}”` : on;
}

const create = (noun: string): ActivityCopy => ({
	icon: Plus,
	tone: "create",
	verb: "created",
	object: (e) => named(e, noun),
});
const update = (noun: string): ActivityCopy => ({
	icon: Pencil,
	tone: "neutral",
	verb: "updated",
	object: (e) => named(e, noun),
});
const remove = (noun: string): ActivityCopy => ({
	icon: Trash2,
	tone: "destroy",
	verb: "deleted",
	object: (e) => named(e, noun),
});
const statusChanged = (noun: string): ActivityCopy => ({
	icon: CircleCheck,
	tone: "neutral",
	verb: "changed the status of",
	object: (e) => named(e, noun),
});
const reorder = (noun: string): ActivityCopy => ({
	icon: ArrowUpDown,
	tone: "neutral",
	verb: "reordered",
	object: (e) => reordered(e, noun),
});
const duplicated = (noun: string): ActivityCopy => ({
	icon: Copy,
	tone: "create",
	verb: "duplicated",
	object: (e) => named(e, noun),
});
const commentCreated = (parent: string): ActivityCopy => ({
	icon: MessageSquare,
	tone: "neutral",
	verb: "commented",
	object: (e) => commentOn(e, parent),
});
const commentEdited = (parent: string): ActivityCopy => ({
	icon: MessageSquare,
	tone: "neutral",
	verb: "edited a comment",
	object: (e) => commentOn(e, parent),
});
const commentDeleted = (parent: string): ActivityCopy => ({
	icon: MessageSquare,
	tone: "destroy",
	verb: "deleted a comment",
	object: (e) => commentOn(e, parent),
});
const mcp = (verb: string, object: string): ActivityCopy => ({
	icon: Bot,
	tone: "ai",
	verb,
	object: (e) => str(e.metadata as Meta, "title") ?? object,
});

/**
 * Typed as a total Record, so adding an action to the mirror above without
 * adding copy here fails the TypeScript build. The drift script covers the
 * other direction (backend gains an action, mirror doesn't).
 */
export const ACTIVITY_COPY: Record<ActivityAction, ActivityCopy> = {
	"roadmap.created": create("roadmap"),
	"roadmap.updated": update("roadmap"),
	"roadmap.deleted": remove("roadmap"),
	"roadmap.replaced_for_project": {
		icon: ArrowRightLeft,
		tone: "neutral",
		verb: "replaced the project roadmap",
		object: (e) => named(e, "roadmap"),
	},
	"roadmap.committed": {
		icon: GitCommitHorizontal,
		tone: "ai",
		verb: "committed",
		object: (e) =>
			`${plural(num(e.metadata as Meta, "operation_count"), "roadmap change", "roadmap changes")}`,
	},
	"roadmap.reverted": {
		icon: Undo2,
		tone: "destroy",
		verb: "reverted",
		object: () => "a roadmap change",
	},
	"roadmap.rolled_back": {
		icon: Redo2,
		tone: "neutral",
		verb: "restored",
		object: () => "a reverted roadmap change",
	},
	"roadmap.share_created": {
		icon: Share2,
		tone: "sensitive",
		verb: "created",
		object: (e) => {
			const level = str(e.metadata as Meta, "access_level");
			return level ? `a ${level} share link` : "a public share link";
		},
	},
	"roadmap.share_revoked": {
		icon: Share2,
		tone: "sensitive",
		verb: "revoked",
		object: () => "the share link",
	},

	"epic.created": create("epic"),
	"epic.updated": update("epic"),
	"epic.status_changed": statusChanged("epic"),
	"epic.deleted": remove("epic"),
	"epic.reordered": reorder("epic"),
	"epic.duplicated": duplicated("epic"),

	"feature.created": create("feature"),
	"feature.updated": update("feature"),
	"feature.status_changed": statusChanged("feature"),
	"feature.moved": {
		icon: FolderTree,
		tone: "neutral",
		verb: "moved",
		object: (e) => named(e, "feature"),
	},
	"feature.deleted": remove("feature"),
	"feature.reordered": reorder("feature"),
	"feature.milestone_linked": {
		icon: Link2,
		tone: "neutral",
		verb: "linked",
		object: (e) => `${named(e, "feature")} to a milestone`,
	},
	"feature.milestone_unlinked": {
		icon: Link2Off,
		tone: "neutral",
		verb: "unlinked",
		object: (e) => `${named(e, "feature")} from a milestone`,
	},
	"feature.duplicated": duplicated("feature"),

	"task.created": create("task"),
	"task.updated": update("task"),
	"task.status_changed": statusChanged("task"),
	"task.assigned": {
		icon: UserPlus,
		tone: "neutral",
		verb: "assigned",
		object: (e) => named(e, "task"),
	},
	"task.unassigned": {
		icon: UserMinus,
		tone: "neutral",
		verb: "unassigned",
		object: (e) => named(e, "task"),
	},
	"task.moved": {
		icon: FolderTree,
		tone: "neutral",
		verb: "moved",
		object: (e) => named(e, "task"),
	},
	"task.deleted": remove("task"),
	"task.reordered": reorder("task"),
	"task.duplicated": duplicated("task"),

	"milestone.created": {
		icon: Milestone,
		tone: "create",
		verb: "created",
		object: (e) => named(e, "milestone"),
	},
	"milestone.updated": update("milestone"),
	"milestone.deleted": remove("milestone"),
	// NOT `reorder()`: unlike the epic/feature/task bulk reorders, this moves a
	// SINGLE milestone to a position and carries no item_count — rendering it
	// as a count produced "reordered 0 milestones".
	"milestone.reordered": {
		icon: ArrowUpDown,
		tone: "neutral",
		verb: "moved",
		object: (e) => named(e, "milestone"),
	},

	"task_comment.created": commentCreated("task"),
	"task_comment.updated": commentEdited("task"),
	"task_comment.deleted": commentDeleted("task"),
	"epic_comment.created": commentCreated("epic"),
	"epic_comment.updated": commentEdited("epic"),
	"epic_comment.deleted": commentDeleted("epic"),
	"feature_comment.created": commentCreated("feature"),
	"feature_comment.updated": commentEdited("feature"),
	"feature_comment.deleted": commentDeleted("feature"),

	"task_attachment.added": {
		icon: Paperclip,
		tone: "create",
		verb: "attached",
		object: (e) => str(e.metadata as Meta, "title") ?? "a file",
	},
	"task_attachment.removed": {
		icon: Paperclip,
		tone: "destroy",
		verb: "removed",
		object: (e) => str(e.metadata as Meta, "title") ?? "an attachment",
	},
	"task_dependency.added": {
		icon: Link2,
		tone: "neutral",
		verb: "added",
		object: () => "a task dependency",
	},
	"task_dependency.removed": {
		icon: Link2Off,
		tone: "neutral",
		verb: "removed",
		object: () => "a task dependency",
	},

	"feature_dependency.added": {
		icon: Link2,
		tone: "neutral",
		verb: "added",
		object: () => "a feature dependency",
	},
	"feature_dependency.removed": {
		icon: Link2Off,
		tone: "neutral",
		verb: "removed",
		object: () => "a feature dependency",
	},

	"member.invited": {
		icon: UserPlus,
		tone: "neutral",
		verb: "invited",
		object: (e) => str(e.metadata as Meta, "email") ?? "someone to the project",
	},
	"member.invite_responded": {
		icon: Users,
		tone: "neutral",
		verb: "responded to",
		object: () => "a project invite",
	},
	"member.invite_revoked": {
		icon: UserMinus,
		tone: "neutral",
		verb: "revoked",
		object: () => "a project invite",
	},
	"member.role_changed": {
		icon: ShieldCheck,
		tone: "sensitive",
		verb: "changed a member's role",
		object: (e) => {
			const role = str(e.metadata as Meta, "role");
			return role ? `to ${role}` : "";
		},
	},
	"member.permissions_changed": {
		icon: ShieldCheck,
		tone: "sensitive",
		verb: "changed",
		object: () => "a member's permissions",
	},
	"member.removed": {
		icon: UserMinus,
		tone: "sensitive",
		verb: "removed",
		object: () => "a member from the project",
	},
	"member.left": {
		icon: UserMinus,
		tone: "neutral",
		verb: "left",
		object: () => "the project",
	},
	"project.owner_transferred": {
		icon: ShieldCheck,
		tone: "sensitive",
		verb: "transferred",
		object: () => "project ownership",
	},
	"project.consultant_assigned": {
		icon: Users,
		tone: "neutral",
		verb: "assigned",
		object: () => "the project consultant",
	},
	"project.consultant_reassigned": {
		icon: Users,
		tone: "neutral",
		verb: "reassigned",
		object: () => "the project consultant",
	},

	"mcp.task_create": mcp("created a task via the AI connector", "a task"),
	"mcp.task_update": mcp("updated a task via the AI connector", "a task"),
	"mcp.task_assign": mcp("assigned a task via the AI connector", "a task"),
	"mcp.task_comment_add": mcp(
		"commented on a task via the AI connector",
		"a task",
	),
	"mcp.epic_comment_add": mcp(
		"commented on an epic via the AI connector",
		"an epic",
	),
	"mcp.feature_comment_add": mcp(
		"commented on a feature via the AI connector",
		"a feature",
	),
	"mcp.chat_send_message": mcp(
		"sent a chat message via the AI connector",
		"a message",
	),
	"mcp.chat_message_edit": mcp(
		"edited a chat message via the AI connector",
		"a message",
	),
	"mcp.chat_message_unsend": mcp(
		"unsent a chat message via the AI connector",
		"a message",
	),

	"deliverable.created": create("deliverable"),
	"deliverable.updated": update("deliverable"),
	"deliverable.submitted": {
		icon: Send,
		tone: "neutral",
		verb: "submitted for review",
		object: (e) => named(e, "deliverable"),
	},
	"deliverable.approved": {
		icon: CircleCheck,
		tone: "create",
		verb: "approved",
		object: (e) => named(e, "deliverable"),
	},
	"deliverable.changes_requested": {
		icon: Undo2,
		tone: "neutral",
		verb: "requested changes on",
		object: (e) => named(e, "deliverable"),
	},
	"deliverable.deleted": remove("deliverable"),
	"deliverable.link_added": {
		icon: Plus,
		tone: "neutral",
		verb: "linked work to",
		object: (e) => named(e, "deliverable"),
	},
	"deliverable.link_removed": {
		icon: Trash2,
		tone: "neutral",
		verb: "unlinked work from",
		object: (e) => named(e, "deliverable"),
	},

	"change_request.created": create("change request"),
	"change_request.updated": update("change request"),
	"change_request.submitted": {
		icon: Send,
		tone: "neutral",
		verb: "submitted",
		object: (e) => named(e, "change request"),
	},
	"change_request.approved": {
		icon: CircleCheck,
		tone: "create",
		verb: "approved",
		object: (e) => named(e, "change request"),
	},
	"change_request.rejected": {
		icon: Undo2,
		tone: "destroy",
		verb: "rejected",
		object: (e) => named(e, "change request"),
	},
	"change_request.changes_requested": {
		icon: Undo2,
		tone: "neutral",
		verb: "requested changes on",
		object: (e) => named(e, "change request"),
	},
	"change_request.withdrawn": {
		icon: Undo2,
		tone: "neutral",
		verb: "withdrew",
		object: (e) => named(e, "change request"),
	},
	"change_request.applied": {
		icon: ArrowUpDown,
		tone: "create",
		verb: "applied to the roadmap",
		object: (e) => named(e, "change request"),
	},
	"change_request.deleted": remove("change request"),
	"change_request.link_added": {
		icon: Plus,
		tone: "neutral",
		verb: "linked work to",
		object: (e) => named(e, "change request"),
	},
	"change_request.link_removed": {
		icon: Trash2,
		tone: "neutral",
		verb: "unlinked work from",
		object: (e) => named(e, "change request"),
	},

	// `object` deliberately never reads a title here: an internal risk's title
	// must not reach the feed, which is not gated per row.
	"risk.created": {
		icon: Plus,
		tone: "create",
		verb: "logged",
		object: (e) => str(e.metadata as Meta, "kind") ?? "a risk",
	},
	"risk.updated": {
		icon: Pencil,
		tone: "neutral",
		verb: "updated",
		object: (e) => str(e.metadata as Meta, "kind") ?? "a risk",
	},
	"risk.status_changed": {
		icon: CircleCheck,
		tone: "neutral",
		verb: "changed the status of",
		object: (e) => str(e.metadata as Meta, "kind") ?? "a risk",
	},
	"risk.owner_changed": {
		icon: Users,
		tone: "neutral",
		verb: "reassigned",
		object: (e) => str(e.metadata as Meta, "kind") ?? "a risk",
	},
	"risk.deleted": {
		icon: Trash2,
		tone: "destroy",
		verb: "removed",
		object: (e) => str(e.metadata as Meta, "kind") ?? "a risk",
	},

	"decision.created": {
		icon: Plus,
		tone: "create",
		verb: "recorded a decision",
		object: (e) => named(e, "decision"),
	},
	"decision.updated": update("decision"),
	"decision.finalized": {
		icon: Gavel,
		tone: "create",
		verb: "marked final",
		object: (e) => named(e, "decision"),
	},
	"decision.superseded": {
		icon: ArrowUpDown,
		tone: "neutral",
		verb: "superseded",
		object: (e) => named(e, "decision"),
	},
	"decision.deleted": remove("decision"),

	"access.granted": {
		icon: ShieldCheck,
		tone: "sensitive",
		verb: "granted access",
		object: (e) => {
			const role = str(e.metadata as Meta, "role");
			return role ? `as ${role}` : "";
		},
	},
	"access.revoked": {
		icon: ShieldCheck,
		tone: "sensitive",
		verb: "revoked",
		object: () => "project access",
	},

	"channel.created": create("channel"),
	"channel.updated": update("channel"),
	"channel.archived": {
		icon: Trash2,
		tone: "destroy",
		verb: "archived",
		object: (e) => named(e, "channel"),
	},
	"channel.member_added": {
		icon: UserPlus,
		tone: "neutral",
		verb: "added someone to",
		object: (e) => named(e, "channel"),
	},
	"channel.member_removed": {
		icon: UserMinus,
		tone: "neutral",
		verb: "removed someone from",
		object: (e) => named(e, "channel"),
	},
	"channel.left": {
		icon: UserMinus,
		tone: "neutral",
		verb: "left",
		object: (e) => named(e, "channel"),
	},
};

/**
 * Copy for any action, including ones this build has never heard of.
 *
 * The fallback is load-bearing, not defensive padding: backend and web deploy
 * independently, so the API can legitimately return an action newer than this
 * bundle — and old rows carry actions that may since have been retired. An
 * audit page must never blank out or crash over one unrecognised verb.
 */
export const UNKNOWN_ACTIVITY_COPY: ActivityCopy = {
	icon: Activity,
	tone: "neutral",
	verb: "performed",
	object: () => "",
};

export function activityCopyFor(action: string): ActivityCopy {
	const known = ACTIVITY_COPY[action as ActivityAction];
	if (known) return known;
	return {
		...UNKNOWN_ACTIVITY_COPY,
		// Show the raw action rather than pretending nothing happened.
		object: () => action,
	};
}
