import type {
	AgentClarifierCard,
	AgentContextRefKind,
	AgentIntentType,
	AgentPlanProposal,
	AgentResponseMode,
	RunCommitView,
} from "@/services/ai-agent.service";

// =============================================================================
// Shared AI kit message types — lifted from
// `roadmap/ai/useRoadmapAiAssistantSession.ts` (RoadmapAi* -> Ai*). These are
// the in-memory thread shapes the kit renders; the DB row is
// `AiMessage` in `@/services/ai-sessions.service`.
// =============================================================================

export type AiChatRole = "user" | "assistant";

/** @deprecated Read-only legacy field: attachments are no longer offered. */
export interface AiChatAttachment {
	id: string;
	name: string;
	size: number;
	type?: string;
}

export type AiActivityStepStatus = "running" | "success" | "error";
export type AiActivityDetailMode = "verbose" | "structured";
export type AiActivityPresentationMode = "curated" | "friendly_minimal";

export interface AiActivityStepTitleList {
	items: string[];
	shownCount: number;
	totalCount: number;
	hasMore: boolean;
}

export interface AiActivityStep {
	seq: number;
	ts: string;
	event: string;
	title: string;
	status: AiActivityStepStatus;
	summary: string;
	details?: Record<string, unknown>;
	titleList?: AiActivityStepTitleList;
	/** Raw agent tool name (e.g. resolve_node_reference) shown as a chip next
	 * to the friendly title so users can see exactly which tool ran. */
	toolName?: string;
}

export interface AiActivityTimeline {
	traceId: string;
	startedAt?: string;
	completedAt?: string;
	elapsedMs?: number;
	done: boolean;
	detailMode: AiActivityDetailMode;
	presentationMode?: AiActivityPresentationMode;
	steps: AiActivityStep[];
}

export type AiCommitLifecycleState = "committing" | "committed" | "failed";

export type AiCommitImpactedItemKind = "created" | "modified" | "deleted";

export interface AiCommitImpactedItem {
	nodeId: string;
	nodeType: "roadmap" | "epic" | "feature" | "task" | "milestone";
	title?: string;
	kind: AiCommitImpactedItemKind;
	changeType?: string;
}

/** Legacy single-roadmap commit card state (pre-run persisted rows). */
export interface AiCommitLifecycle {
	state: AiCommitLifecycleState;
	impactedItems: AiCommitImpactedItem[];
	updatedAt: string;
	/** Why the commit failed (state === "failed"); shown under the status row. */
	errorMessage?: string;
}

// -----------------------------------------------------------------------------
// Entity @-mentions — the persisted model. `aiMentions.ts` re-exports these
// and owns the candidate/rendering helpers.
// -----------------------------------------------------------------------------

export type AiMentionKind = AgentContextRefKind;

/** What the composer records on select. */
export interface AiMentionPick {
	kind: AiMentionKind;
	id: string;
	label: string;
	/** Display-only (untrusted) deep-link hints; never sent to the agent. */
	roadmapId?: string;
	projectId?: string | null;
}

/** A pick anchored in the message text; persisted in `metadata.refs`. */
export interface AiMentionSpan extends AiMentionPick {
	offset: number;
	length: number;
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

export interface AiChatMessage {
	id: string;
	role: AiChatRole;
	content: string;
	timestamp: string;
	parseMode?: string;
	intentType?: AgentIntentType;
	responseMode?: AgentResponseMode;
	planProposal?: AgentPlanProposal;
	clarifier?: AgentClarifierCard;
	/** @deprecated Read-only legacy field; never written by the kit. */
	attachments?: AiChatAttachment[];
	activityTimeline?: AiActivityTimeline;
	/** Legacy single-roadmap commit state; new turns carry `commits`. */
	commitLifecycle?: AiCommitLifecycle;
	/** Entity mentions in a user turn (`metadata.refs`). */
	refs?: AiMentionSpan[];
	/** Per-roadmap commits of the run this assistant turn settled. */
	commits?: RunCommitView[];
	/** The run this assistant turn belongs to (`metadata.run.run_id`). */
	runId?: string;
}

// -----------------------------------------------------------------------------
// Transitional aliases (deleted in PR5 once nothing imports the old names).
// -----------------------------------------------------------------------------

/** @deprecated Use `AiChatRole`. */
export type RoadmapAiChatRole = AiChatRole;
/** @deprecated Use `AiChatAttachment`. */
export type RoadmapAiChatAttachment = AiChatAttachment;
/** @deprecated Use `AiActivityStepStatus`. */
export type RoadmapAiActivityStepStatus = AiActivityStepStatus;
/** @deprecated Use `AiActivityDetailMode`. */
export type RoadmapAiActivityDetailMode = AiActivityDetailMode;
/** @deprecated Use `AiActivityPresentationMode`. */
export type RoadmapAiActivityPresentationMode = AiActivityPresentationMode;
/** @deprecated Use `AiActivityStepTitleList`. */
export type RoadmapAiActivityStepTitleList = AiActivityStepTitleList;
/** @deprecated Use `AiActivityStep`. */
export type RoadmapAiActivityStep = AiActivityStep;
/** @deprecated Use `AiActivityTimeline`. */
export type RoadmapAiActivityTimeline = AiActivityTimeline;
/** @deprecated Use `AiCommitLifecycleState`. */
export type RoadmapAiCommitLifecycleState = AiCommitLifecycleState;
/** @deprecated Use `AiCommitImpactedItemKind`. */
export type RoadmapAiCommitImpactedItemKind = AiCommitImpactedItemKind;
/** @deprecated Use `AiCommitImpactedItem`. */
export type RoadmapAiCommitImpactedItem = AiCommitImpactedItem;
/** @deprecated Use `AiCommitLifecycle`. */
export type RoadmapAiCommitLifecycle = AiCommitLifecycle;
/** @deprecated Use `AiChatMessage`. */
export type RoadmapAiChatMessage = AiChatMessage;
