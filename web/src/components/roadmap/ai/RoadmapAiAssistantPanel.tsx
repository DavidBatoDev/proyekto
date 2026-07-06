import {
	cloneElement,
	isValidElement,
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	Bot,
	Check,
	ChevronDown,
	Loader2,
	Paperclip,
	Send,
	TriangleAlert,
	X,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { projectKeys } from "@/queries/project";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import { featureFlags } from "@/config/featureFlags";
import { isRealtimeConfigured, RealtimeRoom } from "@/lib/realtime";
import roadmapAgentService, {
	type AgentOperation,
	type AgentTraceEvent,
	type AgentTraceEventsResponse,
	RoadmapAgentServiceError,
	isAgentTimeoutError,
} from "@/services/roadmap-agent.service";
import { useUser } from "@/stores/authStore";
import { roadmapAiSessionsService } from "@/services/roadmap-ai-sessions.service";
import { useToast } from "@/hooks/useToast";
import { RoadmapAiActivityTimelineView } from "./RoadmapAiActivityTimeline";
import {
	buildCuratedToolRequestedMessage,
	buildCuratedToolResultMessage,
	buildFriendlyMinimalToolLabel,
	extractTraceToolName,
} from "./roadmapAiToolMessaging";
import {
	useRoadmapAiAssistantSession,
	type RoadmapAiActivityTimeline,
	type RoadmapAiActivityStep,
	type RoadmapAiActivityDetailMode,
	type RoadmapAiActivityPresentationMode,
	type RoadmapAiChatAttachment,
	type RoadmapAiChatMessage,
	type RoadmapAiCommitLifecycle,
	type RoadmapAiCommitImpactedItem,
	type RoadmapAiCommitImpactedItemKind,
} from "./useRoadmapAiAssistantSession";
import { RoadmapAiClarifierCard } from "./RoadmapAiClarifierCard";
import { RoadmapAiPlanProposalCard } from "./RoadmapAiPlanProposalCard";
import { RoadmapAiPlanQuestionCard } from "./RoadmapAiPlanQuestionCard";
import { RoadmapAiThreadList } from "./RoadmapAiThreadList";
import {
	useRoadmapAiThreadsStore,
	useActiveRoadmapAiThread,
} from "@/stores/roadmapAiThreadsStore";
import {
	useCreateRoadmapAiSession,
	useRoadmapAiSessionsList,
} from "@/hooks/useRoadmapAiSessions";

interface RoadmapAiAssistantPanelProps {
	projectId: string;
	roadmapId: string;
	baseRevision?: number;
	roadmapSnapshot?: Roadmap | null;
	epicsSnapshot?: RoadmapEpic[];
	isVisible?: boolean;
	/**
	 * One-shot message auto-sent as the first turn once the panel is visible
	 * and the sessions list has loaded (homepage hero handoff).
	 */
	initialMessage?: string | null;
	/** Called after `initialMessage` has been dispatched exactly once. */
	onInitialMessageConsumed?: () => void;
}

const buildAssistantMessage = (
	content: string,
	parseMode: string,
	options?: {
		intentType?:
			| "smalltalk"
			| "general_question"
			| "roadmap_query"
			| "roadmap_plan"
			| "roadmap_edit"
			| "confirm_action"
			| "question"
			| "unclear";
		responseMode?: "chat" | "edit_plan" | "plan_proposal";
		planProposal?:
			| import("@/services/roadmap-agent.service").AgentPlanProposal
			| null;
		clarifier?:
			| import("@/services/roadmap-agent.service").AgentClarifierCard
			| null;
		commitLifecycle?: RoadmapAiCommitLifecycle;
	},
): RoadmapAiChatMessage => ({
	id: crypto.randomUUID(),
	role: "assistant",
	content,
	timestamp: new Date().toISOString(),
	parseMode,
	intentType: options?.intentType,
	responseMode: options?.responseMode,
	planProposal: options?.planProposal ?? undefined,
	clarifier: options?.clarifier ?? undefined,
	commitLifecycle: options?.commitLifecycle,
});

const BRACKET_TAG_PATTERN = /\[([^\[\]\n]{1,120})\]/g;

const renderBracketTagText = (text: string): ReactNode => {
	BRACKET_TAG_PATTERN.lastIndex = 0;
	if (!BRACKET_TAG_PATTERN.test(text)) return text;
	BRACKET_TAG_PATTERN.lastIndex = 0;

	const parts: ReactNode[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = BRACKET_TAG_PATTERN.exec(text)) !== null) {
		const [fullMatch, label] = match;
		const start = match.index;
		const end = start + fullMatch.length;

		if (start > lastIndex) {
			parts.push(text.slice(lastIndex, start));
		}

		parts.push(
			<span
				key={`assistant-tag-${start}-${end}`}
				className="mx-0.5 inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-700"
			>
				{label}
			</span>,
		);

		lastIndex = end;
	}

	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return parts;
};

const renderBracketTagsInNode = (node: ReactNode): ReactNode => {
	if (typeof node === "string") return renderBracketTagText(node);
	if (Array.isArray(node)) {
		return node.map((child) => renderBracketTagsInNode(child));
	}
	if (isValidElement<{ children?: ReactNode }>(node)) {
		if (node.props.children === undefined) return node;
		return cloneElement(
			node,
			undefined,
			renderBracketTagsInNode(node.props.children),
		);
	}
	return node;
};

interface PendingAttachment {
	id: string;
	file: File;
}

const formatAttachmentSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KB`;
	const mb = kb / 1024;
	return `${mb.toFixed(1)} MB`;
};

const TRACE_POLL_INTERVAL_MS = 1000;
// While the send is in flight, poll faster so a short assistant_delta burst
// (a full answer can stream in under a second) isn't missed between polls;
// faster still once deltas are actually arriving. The endpoint is a cheap
// in-memory read on the agent.
const TRACE_POLL_ACTIVE_INTERVAL_MS = 500;
const TRACE_POLL_STREAMING_INTERVAL_MS = 300;
const TRACE_POLL_LIMIT = 25;
const TRACE_POLL_TIMEOUT_MS = 90_000;
const TRACE_NOT_READY_GRACE_MS = 10_000;
const PROGRESS_DETAIL_MODE: RoadmapAiActivityDetailMode = "structured";
const DEFAULT_PROGRESS_PRESENTATION_MODE: RoadmapAiActivityPresentationMode =
	"curated";

export const parseProgressPresentationMode = (
	value: unknown,
): RoadmapAiActivityPresentationMode => {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/-/g, "_");
	if (normalized === "friendly_minimal") return "friendly_minimal";
	if (normalized === "curated") return "curated";
	return DEFAULT_PROGRESS_PRESENTATION_MODE;
};

export const PROGRESS_PRESENTATION_MODE = parseProgressPresentationMode(
	import.meta.env.VITE_AI_PROGRESS_PRESENTATION_MODE,
);

interface PollLoopState {
	traceId: string;
	sessionId: string;
	afterSeq: number;
	startedAtMs: number;
	cancelled: boolean;
	timerId: number | null;
	pollingFailed: boolean;
	// assistant_delta seqs already appended to the streaming preview. Both
	// polling and realtime push feed the preview; this prevents the same
	// chunk from being appended twice when their windows overlap.
	processedDeltaSeqs: Set<number>;
}

const SHARED_HIDDEN_ACTIVITY_EVENTS = new Set<string>([
	"message_received",
	"actor_context_loaded",
	"intent_classified",
	"route_selected",
	"session_staged_state",
	"message_completed",
	"provider_success",
	// assistant_delta feeds the streaming preview bubble, not the timeline.
	"assistant_delta",
	// provider_attempt stays VISIBLE ("Planning the next steps"): requests
	// that call no read tools (plan drafts, direct answers) would otherwise
	// show an empty "Gathering activity..." timeline for the whole run.
]);

const FRIENDLY_MINIMAL_EXTRA_HIDDEN_ACTIVITY_EVENTS = new Set<string>([
	// Curated mode shows model turns as "Planning the next steps";
	// friendly_minimal keeps only tool steps.
	"provider_attempt",
]);

const toRecord = (value: unknown): Record<string, unknown> | null => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
};

const toStringValue = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
};

const COMMIT_IMPACT_KIND_ORDER: RoadmapAiCommitImpactedItemKind[] = [
	"created",
	"modified",
	"deleted",
];

const COMMIT_IMPACT_KIND_PRIORITY: Record<
	RoadmapAiCommitImpactedItemKind,
	number
> = {
	created: 2,
	modified: 1,
	deleted: 3,
};

const COMMIT_IMPACT_KIND_LABEL: Record<
	RoadmapAiCommitImpactedItemKind,
	string
> = {
	created: "Created",
	modified: "Modified",
	deleted: "Deleted",
};

const isRoadmapNodeType = (
	value: unknown,
): value is RoadmapAiCommitImpactedItem["nodeType"] => {
	return (
		value === "roadmap" ||
		value === "epic" ||
		value === "feature" ||
		value === "task" ||
		value === "milestone"
	);
};

const normalizeChangeType = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toUpperCase();
	return normalized || null;
};

const mapChangeTypeToImpactKind = (
	changeType: string | null,
): RoadmapAiCommitImpactedItemKind => {
	if (changeType === "NODE_ADDED") return "created";
	if (changeType === "NODE_REMOVED") return "deleted";
	return "modified";
};

export const parseCommitImpactedItemsFromOperations = (
	operations: AgentOperation[] | undefined,
): RoadmapAiCommitImpactedItem[] => {
	if (!Array.isArray(operations)) return [];

	const parsed = operations.flatMap((operation) => {
		const op = toStringValue(operation.op)?.toLowerCase();
		if (!op) return [];

		let nodeTypeCandidate = toStringValue(operation.node_type)?.toLowerCase();
		if (!nodeTypeCandidate) {
			if (op === "add_epic") nodeTypeCandidate = "epic";
			if (op === "add_feature") nodeTypeCandidate = "feature";
			if (op === "add_task") nodeTypeCandidate = "task";
		}
		if (!isRoadmapNodeType(nodeTypeCandidate)) return [];

		const operationData = toRecord(operation.data);
		const operationPatch = toRecord(operation.patch);

		// Bulk ops (update_node / mark_status / shift_dates / delete_node /
		// move_node with targets[]) address N nodes with one operation — emit
		// one impacted item per target so the commit preview reflects every
		// affected node, not just the first.
		const rawTargets = Array.isArray(operation.targets)
			? operation.targets
					.map((entry) => toStringValue(entry))
					.filter((entry): entry is string => Boolean(entry))
			: [];
		const singleNodeId =
			toStringValue(operation.node_id) || toStringValue(operationData?.id);
		const nodeIds =
			rawTargets.length > 0 ? rawTargets : singleNodeId ? [singleNodeId] : [];
		if (nodeIds.length === 0) return [];

		let kind: RoadmapAiCommitImpactedItemKind = "modified";
		if (op === "add_epic" || op === "add_feature" || op === "add_task") {
			kind = "created";
		} else if (op === "delete_node") {
			kind = "deleted";
		}

		let changeType: string | undefined;
		if (op === "add_epic" || op === "add_feature" || op === "add_task") {
			changeType = "NODE_ADDED";
		} else if (op === "delete_node") {
			changeType = "NODE_REMOVED";
		} else if (op === "move_node") {
			changeType = "NODE_MOVED";
		} else if (op === "mark_status") {
			changeType = "STATUS_CHANGED";
		} else if (op === "shift_dates") {
			changeType = "DATE_CHANGED";
		} else if (op === "update_node") {
			changeType = "NODE_UPDATED";
		}

		const title = pickCommitItemTitle(operationPatch, operationData);
		return nodeIds.map((nodeId) => ({
			nodeId,
			nodeType: nodeTypeCandidate,
			title,
			kind,
			changeType,
		}));
	});

	return mergeCommitImpactedItems(parsed);
};

const pickCommitItemTitle = (...sources: unknown[]): string | undefined => {
	for (const source of sources) {
		if (!source || typeof source !== "object" || Array.isArray(source)) {
			continue;
		}
		const record = source as Record<string, unknown>;
		const candidate =
			toStringValue(record.title) ||
			toStringValue(record.name) ||
			toStringValue(record.node_title);
		if (candidate) return candidate;
	}
	return undefined;
};

const mergeCommitImpactedItems = (
	...groups: Array<RoadmapAiCommitImpactedItem[] | undefined>
): RoadmapAiCommitImpactedItem[] => {
	const merged = new Map<string, RoadmapAiCommitImpactedItem>();
	for (const group of groups) {
		if (!Array.isArray(group)) continue;
		for (const item of group) {
			if (!item?.nodeId || !isRoadmapNodeType(item.nodeType)) continue;
			const key = `${item.nodeType}:${item.nodeId}`;
			const existing = merged.get(key);
			if (!existing) {
				merged.set(key, item);
				continue;
			}

			const existingPriority = COMMIT_IMPACT_KIND_PRIORITY[existing.kind] ?? 0;
			const nextPriority = COMMIT_IMPACT_KIND_PRIORITY[item.kind] ?? 0;
			if (nextPriority > existingPriority) {
				merged.set(key, {
					...existing,
					...item,
					title: item.title || existing.title,
					changeType: item.changeType || existing.changeType,
				});
				continue;
			}

			if (!existing.title && item.title) {
				merged.set(key, {
					...existing,
					title: item.title,
				});
			}
		}
	}

	return [...merged.values()];
};

export const parseCommitImpactedItemsFromTraceDetails = (
	details: Record<string, unknown> | undefined,
): RoadmapAiCommitImpactedItem[] => {
	const rawItems = details?.impacted_items;
	if (!Array.isArray(rawItems)) return [];

	const parsed = rawItems.flatMap((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			return [];
		}
		const record = entry as Record<string, unknown>;
		const nodeId =
			toStringValue(record.node_id) || toStringValue(record.nodeId);
		const nodeTypeCandidate =
			toStringValue(record.node_type) || toStringValue(record.nodeType);
		const nodeType = nodeTypeCandidate?.toLowerCase();
		if (!nodeId || !isRoadmapNodeType(nodeType)) {
			return [];
		}

		const changeType =
			normalizeChangeType(record.change_type) ||
			normalizeChangeType(record.changeType);
		const impactCandidate =
			toStringValue(record.impact)?.toLowerCase() ||
			toStringValue(record.kind)?.toLowerCase();
		const kind: RoadmapAiCommitImpactedItemKind =
			impactCandidate === "created" ||
			impactCandidate === "modified" ||
			impactCandidate === "deleted"
				? impactCandidate
				: mapChangeTypeToImpactKind(changeType);

		return [
			{
				nodeId,
				nodeType,
				title: pickCommitItemTitle(record),
				kind,
				changeType: changeType ?? undefined,
			},
		];
	});

	return mergeCommitImpactedItems(parsed);
};

const resolveCommitLifecycleFromTimeline = (
	timeline: RoadmapAiActivityTimeline,
): RoadmapAiCommitLifecycle | null => {
	const completionStep = [...timeline.steps]
		.reverse()
		.find(
			(step) =>
				step.event === "auto_commit_async_completed" ||
				step.event === "auto_commit_async_failed",
		);

	if (completionStep?.event === "auto_commit_async_failed") {
		return {
			state: "failed",
			impactedItems: [],
			updatedAt: completionStep.ts,
		};
	}

	if (completionStep?.event === "auto_commit_async_completed") {
		return {
			state: "committed",
			impactedItems: parseCommitImpactedItemsFromTraceDetails(
				completionStep.details,
			),
			updatedAt: completionStep.ts,
		};
	}

	// When the server told us auto-commit was enqueued but we haven't yet
	// seen a terminal auto_commit_* event, keep the UI in "committing" so
	// the user doesn't see a spurious "did not finish" toast while the
	// backend is still working. Slow commits (10s+ on Vercel cold starts)
	// legitimately race past the poll deadline; the caller will reconcile
	// against the roadmap itself once the terminal event eventually lands.
	const messageCompletedStep = [...timeline.steps]
		.reverse()
		.find((step) => step.event === "message_completed");
	const autoCommitEnqueued = Boolean(
		messageCompletedStep?.details &&
			(messageCompletedStep.details as { auto_commit_async_enqueued?: unknown })
				.auto_commit_async_enqueued,
	);
	if (autoCommitEnqueued) {
		return {
			state: "committing",
			impactedItems: [],
			updatedAt:
				messageCompletedStep?.ts ||
				timeline.completedAt ||
				new Date().toISOString(),
		};
	}

	return null;
};

const groupCommitImpactedItems = (
	items: RoadmapAiCommitImpactedItem[],
): Record<RoadmapAiCommitImpactedItemKind, RoadmapAiCommitImpactedItem[]> => {
	const grouped: Record<
		RoadmapAiCommitImpactedItemKind,
		RoadmapAiCommitImpactedItem[]
	> = {
		created: [],
		modified: [],
		deleted: [],
	};

	for (const item of items) {
		grouped[item.kind].push(item);
	}

	for (const kind of COMMIT_IMPACT_KIND_ORDER) {
		grouped[kind].sort((a, b) => {
			const aTitle = (a.title || "").toLowerCase();
			const bTitle = (b.title || "").toLowerCase();
			if (aTitle && bTitle && aTitle !== bTitle) {
				return aTitle.localeCompare(bTitle);
			}
			if (a.nodeType !== b.nodeType) {
				return a.nodeType.localeCompare(b.nodeType);
			}
			return a.nodeId.localeCompare(b.nodeId);
		});
	}

	return grouped;
};

const getCommitLifecycleLabel = (
	state: RoadmapAiCommitLifecycle["state"],
): string => {
	if (state === "committed") return "Committed changes";
	if (state === "failed") return "Commit did not complete";
	return "Committing changes";
};

const parseCountFromUnknown = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.max(0, Math.floor(value));
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return Math.max(0, Math.floor(parsed));
		}
	}
	return null;
};

const parseCountFromText = (text: string, key: string): number | null => {
	const escapedKey = key.replace("_", "[_\\s]");
	const match = text.match(new RegExp(`${escapedKey}\\s*[:=]\\s*(\\d+)`, "i"));
	if (!match?.[1]) return null;
	return Number.parseInt(match[1], 10);
};

const isActivityEventHidden = (
	event: string,
	presentationMode: RoadmapAiActivityPresentationMode,
): boolean => {
	if (SHARED_HIDDEN_ACTIVITY_EVENTS.has(event)) return true;
	if (presentationMode === "friendly_minimal") {
		return FRIENDLY_MINIMAL_EXTRA_HIDDEN_ACTIVITY_EVENTS.has(event);
	}
	return false;
};

const extractResultCounts = (step: {
	summary: string;
	details?: Record<string, unknown>;
}): {
	tasksCount: number | null;
	matchesCount: number | null;
	operationsCount: number | null;
	childrenCount: number | null;
} => {
	const resultSummary = toRecord(step.details?.result_summary);
	const tasksCount =
		parseCountFromUnknown(resultSummary?.tasks_count) ??
		parseCountFromText(step.summary, "tasks_count");
	const matchesCount =
		parseCountFromUnknown(resultSummary?.matches_count) ??
		parseCountFromText(step.summary, "matches_count");
	const operationsCount =
		parseCountFromUnknown(resultSummary?.operations_count) ??
		parseCountFromText(step.summary, "operations_count");
	const childrenCount =
		parseCountFromUnknown(resultSummary?.children_count) ??
		parseCountFromText(step.summary, "children_count");

	return {
		tasksCount,
		matchesCount,
		operationsCount,
		childrenCount,
	};
};

const buildFriendlyResultSummary = (counts: {
	tasksCount: number | null;
	matchesCount: number | null;
	operationsCount: number | null;
	childrenCount: number | null;
}): string => {
	const parts: string[] = [];
	if (counts.tasksCount != null) {
		parts.push(`Processed ${counts.tasksCount} tasks`);
	}
	if (counts.matchesCount != null) {
		parts.push(`Found ${counts.matchesCount} matches`);
	}
	if (counts.operationsCount != null) {
		parts.push(`Prepared ${counts.operationsCount} changes`);
	}
	if (counts.childrenCount != null) {
		parts.push(`Found ${counts.childrenCount} related items`);
	}
	if (parts.length === 0) {
		return "Completed this step.";
	}
	return `${parts.join(". ")}.`;
};

type RawActivityStep = {
	seq: number;
	ts: string;
	event: string;
	title: string;
	status: "running" | "success" | "error";
	summary: string;
	details?: Record<string, unknown>;
	titleList?: RoadmapAiActivityStep["titleList"];
};

const getIntentSummary = (rawStep: RawActivityStep): string => {
	const details = toRecord(rawStep.details);
	const intentType =
		typeof details?.intent_type === "string"
			? details.intent_type.trim().toLowerCase()
			: "";
	if (intentType === "roadmap_edit") {
		return "I understood this as a roadmap edit request and started preparing concrete changes.";
	}
	if (intentType === "roadmap_query") {
		return "I understood this as a roadmap question and started gathering the right context.";
	}
	return "I am interpreting your request so I can choose the right execution path.";
};

const getRouteSummary = (rawStep: RawActivityStep): string => {
	const details = toRecord(rawStep.details);
	const responseMode =
		typeof details?.response_mode === "string"
			? details.response_mode.trim().toLowerCase()
			: "";
	if (responseMode === "edit_plan") {
		return "I selected the edit workflow so I can prepare a safe set of roadmap changes.";
	}
	if (responseMode === "chat") {
		return "I selected a direct response path and am preparing the answer.";
	}
	return "I selected the best available path to handle your request safely.";
};

const getProviderAttemptSummary = (rawStep: RawActivityStep): string => {
	const details = toRecord(rawStep.details);
	const phase =
		typeof details?.phase === "string"
			? details.phase.trim().toLowerCase()
			: "";
	if (phase === "edit_plan") {
		return "I am planning the roadmap updates now and validating each step before execution.";
	}
	if (phase === "chat") {
		return "I am composing the response and checking it against your request context.";
	}
	return "I am working through the next planning step for your request.";
};

const normalizeActivityStep = (
	rawStep: RawActivityStep,
	presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityStep | null => {
	const normalizedEvent = String(rawStep.event || "")
		.trim()
		.toLowerCase();
	if (!normalizedEvent) return null;
	if (isActivityEventHidden(normalizedEvent, presentationMode)) {
		return null;
	}
	const baseStep = {
		seq: rawStep.seq,
		ts: rawStep.ts,
		event: normalizedEvent,
		status: rawStep.status,
		details: rawStep.details,
		titleList: rawStep.titleList,
	} as const;

	if (normalizedEvent === "intent_classified") {
		return {
			...baseStep,
			title: "Understanding your request",
			summary: getIntentSummary(rawStep),
		};
	}

	if (normalizedEvent === "route_selected") {
		return {
			...baseStep,
			title: "Choosing an approach",
			summary: getRouteSummary(rawStep),
		};
	}

	if (normalizedEvent === "provider_attempt") {
		return {
			...baseStep,
			status: "running",
			title: "Planning the next steps",
			summary: getProviderAttemptSummary(rawStep),
		};
	}

	// Model-authored reasoning-summary lines (Linear/Cursor-style "thoughts").
	// Visible in both presentation modes: in friendly_minimal, where
	// provider_attempt is hidden, these are the between-tools narration.
	if (normalizedEvent === "assistant_thought") {
		const details = toRecord(rawStep.details);
		const thoughtText = toStringValue(details?.text);
		return {
			...baseStep,
			status: "success",
			title: "Thinking",
			summary:
				thoughtText || rawStep.summary || "Thinking through the next step.",
		};
	}

	if (normalizedEvent === "planner_summary") {
		const details = toRecord(rawStep.details);
		const summaryText = toStringValue(details?.summary_text);
		return {
			...baseStep,
			status: rawStep.status === "error" ? "error" : "success",
			title:
				presentationMode === "curated"
					? "Gearing up your plan"
					: "Planning summary",
			summary:
				summaryText ||
				(presentationMode === "curated"
					? "I prepared a concise planning summary before applying your roadmap changes."
					: "Prepared a planning summary."),
		};
	}

	if (normalizedEvent === "provider_failure") {
		return {
			...baseStep,
			status: "error",
			title:
				presentationMode === "curated"
					? "Recovering from a temporary issue"
					: "Temporary processing issue",
			summary:
				presentationMode === "curated"
					? "I hit a temporary issue while planning, then switched to a safer recovery path to keep your request moving."
					: "We hit a temporary issue while handling your request.",
		};
	}

	if (normalizedEvent === "tool_call_requested") {
		const toolName = extractTraceToolName(rawStep);
		if (presentationMode === "curated") {
			const toolMessage = buildCuratedToolRequestedMessage(toolName, rawStep);
			return {
				...baseStep,
				title: toolMessage.title,
				summary: toolMessage.summary,
				...(toolName ? { toolName } : {}),
			};
		}
		const label = buildFriendlyMinimalToolLabel(toolName);
		return {
			...baseStep,
			title: label.requested,
			summary: "Working on this step now.",
			...(toolName ? { toolName } : {}),
		};
	}

	if (normalizedEvent === "tool_call_result") {
		const toolName = extractTraceToolName(rawStep);
		if (rawStep.status === "error") {
			const label = buildFriendlyMinimalToolLabel(toolName);
			return {
				...baseStep,
				status: "error",
				title: label.requested,
				summary: "A step failed; retrying.",
				...(toolName ? { toolName } : {}),
			};
		}
		if (presentationMode === "curated") {
			const toolMessage = buildCuratedToolResultMessage(toolName, rawStep);
			return {
				...baseStep,
				title: toolMessage.title,
				summary: toolMessage.summary,
				titleList: toolMessage.titleList,
				...(toolName ? { toolName } : {}),
			};
		}
		const label = buildFriendlyMinimalToolLabel(toolName);
		return {
			...baseStep,
			title: label.completed,
			summary: buildFriendlyResultSummary(extractResultCounts(rawStep)),
			...(toolName ? { toolName } : {}),
		};
	}

	if (normalizedEvent === "plan_generated") {
		const operationsCount =
			parseCountFromUnknown(rawStep.details?.operations_count) ??
			parseCountFromText(rawStep.summary, "operations_count");
		return {
			...baseStep,
			title:
				presentationMode === "curated"
					? "Finalizing your change plan"
					: "Preparing your roadmap changes",
			summary:
				presentationMode === "curated"
					? operationsCount != null
						? `I prepared ${operationsCount} roadmap changes and validated the plan before applying.`
						: "I finalized your roadmap change plan and prepared it for application."
					: operationsCount != null
						? `Prepared ${operationsCount} changes.`
						: "Prepared your roadmap changes.",
		};
	}

	if (normalizedEvent === "auto_commit_async_completed") {
		return {
			...baseStep,
			status: "success",
			title: "Applied your changes",
			summary:
				presentationMode === "curated"
					? "I applied your roadmap changes successfully and completed this run."
					: "Your roadmap changes were applied successfully.",
		};
	}

	if (normalizedEvent === "auto_commit_async_failed") {
		const details = toRecord(rawStep.details);
		const autoCommitErrorMessage = toStringValue(
			details?.auto_commit_error_message,
		);
		const invalidOperation = toRecord(details?.auto_commit_invalid_operation);
		const invalidReason = toStringValue(invalidOperation?.reason);
		const hasStatusValidationIssue =
			(autoCommitErrorMessage ?? "")
				.toLowerCase()
				.includes("validation error") &&
			(invalidReason === "mark_status.status_invalid" ||
				autoCommitErrorMessage?.toLowerCase().includes("status"));
		return {
			...baseStep,
			status: "error",
			title: "Could not apply changes automatically",
			summary:
				presentationMode === "curated"
					? hasStatusValidationIssue
						? "Your change plan is ready, but one or more updates used an invalid status value. Use one of: todo, in progress, in review, done, or blocked."
						: "Your change plan is ready, but automatic apply did not finish. You can still review and apply it manually."
					: "Your changes are ready, but auto-apply did not complete.",
		};
	}

	return null;
};

export const mergeTimelineSteps = (
	existingSteps: RoadmapAiActivityStep[],
	incomingEvents: AgentTraceEvent[],
	presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityStep[] => {
	const deduped = new Map<number, RoadmapAiActivityStep>();
	for (const step of existingSteps) {
		const normalized = normalizeActivityStep(
			{
				seq: step.seq,
				ts: step.ts,
				event: step.event,
				title: step.title,
				status: step.status,
				summary: step.summary,
				details: step.details,
				titleList: step.titleList,
			},
			presentationMode,
		);
		if (normalized) {
			deduped.set(normalized.seq, normalized);
		}
	}
	for (const event of incomingEvents) {
		const normalized = normalizeActivityStep(
			{
				seq: event.seq,
				ts: event.ts,
				event: event.event,
				title: event.title,
				status: event.status,
				summary: event.summary,
				details: event.details,
			},
			presentationMode,
		);
		if (normalized) {
			deduped.set(normalized.seq, normalized);
		}
	}
	return [...deduped.values()].sort((a, b) => a.seq - b.seq);
};

export const toTimelineFromTraceResponse = (
	detailMode: RoadmapAiActivityDetailMode,
	traceId: string,
	response: AgentTraceEventsResponse,
	previousTimeline?: RoadmapAiActivityTimeline | null,
	presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityTimeline => {
	const messageCompletedElapsedMs = [...response.events].reverse().find(
		(event) =>
			String(event.event || "")
				.trim()
				.toLowerCase() === "message_completed",
	)?.details?.elapsed_ms;
	const normalizedMessageCompletedElapsedMs = parseCountFromUnknown(
		messageCompletedElapsedMs,
	);

	return {
		traceId,
		startedAt: response.started_at || previousTimeline?.startedAt,
		completedAt: response.completed_at || previousTimeline?.completedAt,
		// Keep elapsed time anchored to message completion so auto-commit time is excluded.
		elapsedMs:
			normalizedMessageCompletedElapsedMs ??
			previousTimeline?.elapsedMs ??
			(typeof response.elapsed_ms === "number"
				? response.elapsed_ms
				: undefined),
		done: response.done,
		detailMode,
		presentationMode,
		steps: mergeTimelineSteps(
			previousTimeline?.steps ?? [],
			response.events,
			presentationMode,
		),
	};
};

// Filter to assistant_delta events not yet applied to the streaming preview,
// marking them as seen. Poll and realtime push share one seen-set per loop, so
// the same chunk arriving on both transports is appended exactly once.
export const collectUnseenDeltaEvents = (
	events: AgentTraceEvent[],
	processedDeltaSeqs: Set<number>,
): AgentTraceEvent[] => {
	const fresh: AgentTraceEvent[] = [];
	for (const event of events) {
		if (event.event !== "assistant_delta") continue;
		if (processedDeltaSeqs.has(event.seq)) continue;
		processedDeltaSeqs.add(event.seq);
		fresh.push(event);
	}
	return fresh;
};

export const normalizeTimelineForDisplay = (
	timeline?: RoadmapAiActivityTimeline | null,
	presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityTimeline | null => {
	if (!timeline) return null;
	const normalizedSteps = timeline.steps
		.map((step) =>
			normalizeActivityStep(
				{
					seq: step.seq,
					ts: step.ts,
					event: step.event,
					title: step.title,
					status: step.status,
					summary: step.summary,
					details: step.details,
					titleList: step.titleList,
				},
				presentationMode,
			),
		)
		.filter((step): step is RoadmapAiActivityStep => step != null);
	return {
		...timeline,
		detailMode: PROGRESS_DETAIL_MODE,
		presentationMode,
		steps: normalizedSteps,
	};
};

const computeElapsedMs = (
	startedAt?: string,
	completedAt?: string,
): number | undefined => {
	if (!startedAt || !completedAt) return undefined;
	const startedMs = Date.parse(startedAt);
	const completedMs = Date.parse(completedAt);
	if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) {
		return undefined;
	}
	return Math.max(0, Math.round(completedMs - startedMs));
};

export const ensureTimelineCompleted = (
	timeline: RoadmapAiActivityTimeline,
	completedAtIso = new Date().toISOString(),
): RoadmapAiActivityTimeline => {
	const completedAt = timeline.completedAt || completedAtIso;
	return {
		...timeline,
		done: true,
		completedAt,
		elapsedMs:
			typeof timeline.elapsedMs === "number"
				? timeline.elapsedMs
				: computeElapsedMs(timeline.startedAt, completedAt),
	};
};

export const getDefaultTimelineExpanded = (
	timelineDone: boolean,
	explicitValue?: boolean,
): boolean => {
	if (typeof explicitValue === "boolean") {
		return explicitValue;
	}
	return !timelineDone;
};

export const shouldRenderThinkingFallback = (
	isSending: boolean,
	hasLiveActivity: boolean,
	tracePollingFailed: boolean,
): boolean => isSending && (!hasLiveActivity || tracePollingFailed);

/**
 * Gate for the hero-handoff auto-send: dispatch the pending initial message
 * only when the panel is visible, no turn is in flight, the sessions list has
 * resolved (so thread hydration can't race the send), and the once-latch has
 * not fired yet. Pure so the exactly-once behavior is unit-testable.
 */
export const shouldAutoSendInitialMessage = (state: {
	isVisible: boolean;
	initialMessage: string | null | undefined;
	isSending: boolean;
	threadsListReady: boolean;
	hasAutoSentInitial: boolean;
}): boolean =>
	state.isVisible &&
	Boolean(state.initialMessage && state.initialMessage.trim().length > 0) &&
	!state.isSending &&
	state.threadsListReady &&
	!state.hasAutoSentInitial;

const isTraceNotReadyError = (error: unknown): boolean => {
	if (error instanceof RoadmapAgentServiceError) {
		return error.statusCode === 404;
	}
	if (error instanceof Error) {
		return /trace_events_not_found|404/i.test(error.message);
	}
	return false;
};

function SkeletonBlock({
	className,
	style,
}: {
	className: string;
	style?: CSSProperties;
}) {
	return <div className={`ai-shimmer rounded-md ${className}`} style={style} />;
}

const SKELETON_ROWS: Array<{ role: "user" | "assistant"; lines: number[] }> = [
	{ role: "assistant", lines: [75, 55, 40] },
	{ role: "user", lines: [60] },
	{ role: "assistant", lines: [85, 65] },
	{ role: "user", lines: [50] },
	{ role: "assistant", lines: [80, 60, 45, 30] },
];

function ThreadHistorySkeleton() {
	return (
		<div className="space-y-3">
			{SKELETON_ROWS.map((row, i) =>
				row.role === "user" ? (
					<div key={i} className="ml-8 mr-0">
						<div className="ai-gradient-soft rounded-lg px-3.5 py-2.5 border border-blue-100 space-y-2">
							<SkeletonBlock
								className="h-2.5"
								style={{ width: `${row.lines[0]}%` }}
							/>
						</div>
					</div>
				) : (
					<div key={i} className="ml-0 mr-4 px-0 py-1.5 space-y-2">
						<div className="flex items-center gap-1.5 mb-1">
							<SkeletonBlock className="h-2 w-12 bg-blue-200/60" />
						</div>
						{row.lines.map((w, j) => (
							<SkeletonBlock
								key={j}
								className="h-2.5"
								style={{ width: `${w}%` }}
							/>
						))}
					</div>
				),
			)}
		</div>
	);
}

export function RoadmapAiAssistantPanel({
	projectId,
	roadmapId,
	baseRevision,
	isVisible = true,
	initialMessage,
	onInitialMessageConsumed,
}: RoadmapAiAssistantPanelProps) {
	const queryClient = useQueryClient();
	const activeThreadId = useActiveRoadmapAiThread(roadmapId);
	const setActiveThread = useRoadmapAiThreadsStore((s) => s.setActiveThread);
	// A thread we just created via "New thread" that may not be in the cached
	// list yet (the backend caches the authed sessions GET, so the post-create
	// refetch can briefly return a stale list). The reconcile effect must not
	// evict it, or the UI bounces back to the previously-active thread.
	const justCreatedThreadRef = useRef<string | null>(null);
	const {
		messages,
		isLoading: isThreadLoading,
		appendMessage,
		updateMessage,
		markThreadHydrated,
		persistTurn,
		rehydrateAgentSession,
	} = useRoadmapAiAssistantSession(roadmapId, activeThreadId);
	const createAiSession = useCreateRoadmapAiSession(roadmapId);
	const threadsList = useRoadmapAiSessionsList(roadmapId, { archived: false });
	const [isThreadMenuOpen, setIsThreadMenuOpen] = useState(false);
	const threadMenuTriggerRef = useRef<HTMLButtonElement>(null);
	const agentSessionsInitializedRef = useRef<Set<string>>(new Set());
	const toast = useToast();
	const [input, setInput] = useState("");
	const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
	const [isSending, setIsSending] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [liveActivity, setLiveActivity] =
		useState<RoadmapAiActivityTimeline | null>(null);
	const [liveActivityExpanded, setLiveActivityExpanded] = useState(true);
	const [liveActivityHostMessageId, setLiveActivityHostMessageId] = useState<
		string | null
	>(null);
	const [tracePollingFailed, setTracePollingFailed] = useState(false);
	// Live preview of the assistant's streamed text: accumulated from
	// assistant_delta trace events while the send POST is in flight. The final
	// message from the POST always replaces it.
	const [streamingPreview, setStreamingPreview] = useState<{
		traceId: string;
		turn: number;
		text: string;
	} | null>(null);
	const [activityExpandedByMessageId, setActivityExpandedByMessageId] =
		useState<Record<string, boolean>>({});
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const messagesEndRef = useRef<HTMLDivElement | null>(null);
	const pollLoopRef = useRef<PollLoopState | null>(null);
	const liveActivityRef = useRef<RoadmapAiActivityTimeline | null>(null);
	const autoCommitRefreshSeqByTraceRef = useRef<Record<string, number>>({});

	const currentUser = useUser();
	const canvasViewMode = useRoadmapStore((state) => state.canvasViewMode);
	const loadRoadmap = useRoadmapStore((state) => state.loadRoadmap);
	const applyAiCommitImpactedItems = useRoadmapStore(
		(state) => state.applyAiCommitImpactedItems,
	);
	const roadmapLinkView =
		canvasViewMode === "milestones" ? "timelineView" : "roadmapView";

	// Background reconcile of the full roadmap (features/tasks/positions). The
	// visible change is applied optimistically from the commit summary, so this
	// is allowed to be slow — never block the UI on it. GET /full can take many
	// seconds right after a commit (write contention); awaiting it here is what
	// made committed nodes appear ~20s late.
	const refreshRoadmapAfterAutoCommit = async () => {
		await loadRoadmap(roadmapId, { force: true });
		void queryClient.invalidateQueries({
			queryKey: projectKeys.roadmapFull(roadmapId),
			exact: true,
		});
	};

	const maybeRefreshRoadmapFromTraceEvents = async (
		traceId: string,
		events: AgentTraceEvent[],
	) => {
		const completionSeq = events
			.filter((event) => event.event === "auto_commit_async_completed")
			.reduce<number | null>(
				(max, event) => (max == null || event.seq > max ? event.seq : max),
				null,
			);
		if (completionSeq == null) return;

		const alreadyRefreshedSeq =
			autoCommitRefreshSeqByTraceRef.current[traceId] ?? 0;
		if (completionSeq <= alreadyRefreshedSeq) return;
		autoCommitRefreshSeqByTraceRef.current[traceId] = completionSeq;

		try {
			await refreshRoadmapAfterAutoCommit();
		} catch (error) {
			console.warn(
				"[RoadmapAiAssistantPanel] roadmap_refresh_after_auto_commit_failed",
				{
					trace_id: traceId,
					roadmap_id: roadmapId,
					error: error instanceof Error ? error.message : String(error),
				},
			);
		}
	};

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, [
		messages.length,
		isSending,
		liveActivity?.steps.length,
		streamingPreview?.text.length,
	]);

	useEffect(() => {
		if (!composerRef.current) return;
		composerRef.current.style.height = "0px";
		const nextHeight = Math.min(composerRef.current.scrollHeight, 160);
		composerRef.current.style.height = `${nextHeight}px`;
	}, [input]);

	useEffect(() => {
		liveActivityRef.current = liveActivity;
	}, [liveActivity]);

	useEffect(() => {
		return () => {
			const currentLoop = pollLoopRef.current;
			if (currentLoop?.timerId != null) {
				window.clearTimeout(currentLoop.timerId);
			}
			if (currentLoop) {
				currentLoop.cancelled = true;
			}
		};
	}, []);

	// Reset ephemeral UI state when the active thread changes, so live trace
	// events, toasts, and pending artifacts from the previous thread don't
	// leak into the new one. Also abort any in-flight poll loop.
	useEffect(() => {
		const currentLoop = pollLoopRef.current;
		if (currentLoop?.timerId != null) {
			window.clearTimeout(currentLoop.timerId);
		}
		if (currentLoop) {
			currentLoop.cancelled = true;
		}
		pollLoopRef.current = null;
		setLiveActivity(null);
		setLiveActivityExpanded(true);
		setLiveActivityHostMessageId(null);
		setErrorMessage(null);
		setTracePollingFailed(false);
		setActivityExpandedByMessageId({});
		autoCommitRefreshSeqByTraceRef.current = {};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeThreadId]);

	// Auto-select the most recent active thread on mount if none is selected —
	// the pop menu can still flip between threads later. Also reconciles a
	// stale persisted `activeThreadId` (from localStorage) against the current
	// server list so we don't hydrate a thread the user doesn't own anymore.
	useEffect(() => {
		const threads = threadsList.data;
		if (!threads) return;
		// While the list is refetching (e.g. immediately after createAiSession
		// invalidates the query), the cached data is stale. Skip reconciliation
		// so an explicitly-set activeThreadId (from handleCreateNewThread) isn't
		// overwritten by "ID not found in stale list → reset to first thread".
		if (threadsList.isFetching) return;
		if (activeThreadId) {
			const stillExists = threads.some((t) => t.id === activeThreadId);
			if (stillExists) {
				justCreatedThreadRef.current = null;
				return;
			}
			// Don't evict a thread we just created that hasn't appeared in the
			// (possibly stale/cached) list yet -- otherwise the UI bounces back to
			// the previous thread immediately after switching. Cleared above once
			// the thread shows up in the list.
			if (justCreatedThreadRef.current === activeThreadId) return;
			if (threads.length > 0) {
				setActiveThread(roadmapId, threads[0].id);
			} else {
				setActiveThread(roadmapId, null);
			}
			return;
		}
		if (threads.length === 0) return;
		setActiveThread(roadmapId, threads[0].id);
	}, [
		activeThreadId,
		threadsList.data,
		threadsList.isFetching,
		roadmapId,
		setActiveThread,
	]);

	// Returns the active thread id, creating a brand-new DB row + agent Redis
	// session if none exists. On Redis-TTL expiry of an existing thread, the
	// send-message path rehydrates via `rehydrateAgentSession` on 404 rather
	// than calling this.
	const ensureThread = async (): Promise<string> => {
		if (activeThreadId) {
			// Guarantee the agent has a Redis session for this thread — first hit
			// after a cold browser load, the DB row exists but Redis may not.
			// Pass the durable agent-state snapshot so a cold create is a restore
			// (pending plan/undo/recents survive); when Redis is still live the
			// agent's no-clobber guard makes this a no-op.
			if (!agentSessionsInitializedRef.current.has(activeThreadId)) {
				try {
					let agentState: Record<string, unknown> | undefined;
					try {
						const row = await roadmapAiSessionsService.getById(
							roadmapId,
							activeThreadId,
						);
						const candidate = (row.metadata as Record<string, unknown> | null)
							?.agent_state;
						if (candidate && typeof candidate === "object") {
							agentState = candidate as Record<string, unknown>;
						}
					} catch {
						/* snapshot fetch is best-effort */
					}
					await roadmapAgentService.createSession({
						session_id: activeThreadId,
						roadmap_id: roadmapId,
						base_revision: baseRevision,
						metadata: agentState,
					});
					agentSessionsInitializedRef.current.add(activeThreadId);
				} catch (err) {
					// Non-fatal — the send call below will surface any real error.
					console.warn(
						"[RoadmapAiAssistantPanel] agent createSession precheck failed",
						err,
					);
				}
			}
			return activeThreadId;
		}
		const dbRow = await createAiSession.mutateAsync({});
		await roadmapAgentService.createSession({
			session_id: dbRow.id,
			roadmap_id: roadmapId,
			base_revision: baseRevision,
		});
		agentSessionsInitializedRef.current.add(dbRow.id);
		// Mark hydrated BEFORE setActiveThread so the hook's hydration effect
		// short-circuits on its first run with the new threadId. Otherwise the
		// effect fetches an empty DB result and overwrites the user message that
		// handleSend is about to append.
		markThreadHydrated(dbRow.id);
		setActiveThread(roadmapId, dbRow.id);
		return dbRow.id;
	};

	// Detect 404-from-agent (Redis miss) and recreate the session with the
	// last N messages from the DB so the planner has context before retry.
	const rehydrateAndRetry = async <T,>(
		threadId: string,
		seedMessages: Array<{ role: string; content: string }>,
		op: () => Promise<T>,
	): Promise<T> => {
		try {
			return await op();
		} catch (err) {
			const isNotFound =
				err instanceof RoadmapAgentServiceError && err.statusCode === 404;
			if (!isNotFound) throw err;
			await rehydrateAgentSession(seedMessages, { roadmapId, baseRevision });
			agentSessionsInitializedRef.current.add(threadId);
			return op();
		}
	};

	// Accumulate streamed assistant text (chunk events, already in seq order).
	// A higher `turn` supersedes earlier partial text — a new model call is
	// writing now. Shared by the poll loop and the realtime push handler;
	// returns how many previously-unseen chunks were applied.
	const applyStreamingDeltaEvents = (
		loop: PollLoopState,
		events: AgentTraceEvent[],
	): number => {
		const deltaEvents = collectUnseenDeltaEvents(
			events,
			loop.processedDeltaSeqs,
		);
		if (deltaEvents.length === 0) return 0;
		setStreamingPreview((prev) => {
			let text = prev && prev.traceId === loop.traceId ? prev.text : "";
			let turn = prev && prev.traceId === loop.traceId ? prev.turn : 0;
			for (const event of deltaEvents) {
				const details = (event.details ?? {}) as {
					text?: unknown;
					turn?: unknown;
				};
				const chunk = typeof details.text === "string" ? details.text : "";
				const eventTurn =
					typeof details.turn === "number" ? details.turn : turn;
				if (eventTurn > turn) {
					text = "";
					turn = eventTurn;
				}
				text += chunk;
			}
			return { traceId: loop.traceId, turn, text };
		});
		return deltaEvents.length;
	};

	const progressDetailMode: RoadmapAiActivityDetailMode = PROGRESS_DETAIL_MODE;
	const progressPresentationMode: RoadmapAiActivityPresentationMode =
		PROGRESS_PRESENTATION_MODE;

	const stopActivePollLoop = () => {
		setStreamingPreview(null);
		const loop = pollLoopRef.current;
		if (!loop) return;
		loop.cancelled = true;
		if (loop.timerId != null) {
			window.clearTimeout(loop.timerId);
		}
		pollLoopRef.current = null;
	};

	const pollTraceEvents = async (loop: PollLoopState): Promise<void> => {
		if (loop.cancelled) return;
		if (Date.now() - loop.startedAtMs > TRACE_POLL_TIMEOUT_MS) {
			loop.pollingFailed = true;
			setTracePollingFailed(true);
			return;
		}

		try {
			const response = await roadmapAgentService.getTraceEvents(
				loop.sessionId,
				loop.traceId,
				{
					afterSeq: loop.afterSeq,
					limit: TRACE_POLL_LIMIT,
					detail: progressDetailMode,
				},
			);
			if (loop.cancelled) return;
			loop.afterSeq = Math.max(loop.afterSeq, response.next_seq);
			setLiveActivity((prev) =>
				toTimelineFromTraceResponse(
					progressDetailMode,
					loop.traceId,
					response,
					prev,
					progressPresentationMode,
				),
			);
			const freshDeltaCount = applyStreamingDeltaEvents(loop, response.events);
			await maybeRefreshRoadmapFromTraceEvents(loop.traceId, response.events);
			if (response.done) {
				return;
			}
			loop.timerId = window.setTimeout(
				() => {
					void pollTraceEvents(loop);
				},
				freshDeltaCount > 0
					? TRACE_POLL_STREAMING_INTERVAL_MS
					: TRACE_POLL_ACTIVE_INTERVAL_MS,
			);
		} catch (error) {
			if (loop.cancelled) return;
			const elapsedSinceStartMs = Date.now() - loop.startedAtMs;
			if (
				isTraceNotReadyError(error) &&
				elapsedSinceStartMs < TRACE_NOT_READY_GRACE_MS
			) {
				loop.timerId = window.setTimeout(() => {
					void pollTraceEvents(loop);
				}, TRACE_POLL_INTERVAL_MS);
				return;
			}
			loop.pollingFailed = true;
			setTracePollingFailed(true);
			console.warn("[RoadmapAiAssistantPanel] trace_poll_failed", {
				session_id: loop.sessionId,
				trace_id: loop.traceId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const startTracePolling = (activeSessionId: string, traceId: string) => {
		stopActivePollLoop();
		const startedAt = new Date().toISOString();
		const loop: PollLoopState = {
			traceId,
			sessionId: activeSessionId,
			afterSeq: 0,
			startedAtMs: Date.now(),
			cancelled: false,
			timerId: null,
			pollingFailed: false,
			processedDeltaSeqs: new Set<number>(),
		};
		pollLoopRef.current = loop;
		setTracePollingFailed(false);
		setLiveActivityExpanded(true);
		setLiveActivityHostMessageId(null);
		setLiveActivity({
			traceId,
			startedAt,
			done: false,
			detailMode: progressDetailMode,
			presentationMode: progressPresentationMode,
			steps: [],
		});
		void pollTraceEvents(loop);
	};

	// Realtime-pushed trace events (agent → DO worker → `user:{id}` room):
	// merged through the same seq-deduped path as polling, so push and poll
	// coexist idempotently. Push is purely a latency reduction — it never
	// advances loop.afterSeq, never finalizes on `done`, and never triggers
	// the auto-commit roadmap refresh; polling stays the authoritative
	// cursor, so a dropped publish costs latency, not events.
	const applyPushedTraceEvents = (payload: unknown) => {
		const loop = pollLoopRef.current;
		if (!loop || loop.cancelled) return;
		const record = toRecord(payload);
		if (!record) return;
		if (toStringValue(record.trace_id) !== loop.traceId) return;
		const events = Array.isArray(record.events)
			? (record.events as AgentTraceEvent[])
			: [];
		if (events.length === 0) return;
		const startedAt = toStringValue(record.started_at);
		setLiveActivity((prev) =>
			toTimelineFromTraceResponse(
				progressDetailMode,
				loop.traceId,
				{
					trace_id: loop.traceId,
					events,
					next_seq: loop.afterSeq,
					done: prev?.done ?? false,
					...(startedAt ? { started_at: startedAt } : {}),
				} as AgentTraceEventsResponse,
				prev,
				progressPresentationMode,
			),
		);
		applyStreamingDeltaEvents(loop, events);
	};
	const applyPushedTraceEventsRef = useRef(applyPushedTraceEvents);
	applyPushedTraceEventsRef.current = applyPushedTraceEvents;

	useEffect(() => {
		if (!featureFlags.realtimeAiTracePush) return;
		if (!isRealtimeConfigured()) return;
		const userId = currentUser?.id;
		if (!userId) return;
		const room = new RealtimeRoom(`user:${userId}`);
		room.on("ai_trace_event", (payload: unknown) => {
			applyPushedTraceEventsRef.current(payload);
		});
		room.connect();
		return () => {
			room.close();
		};
	}, [currentUser?.id]);

	const finalizeTraceTimeline = (
		assistantMessageId: string,
		traceId: string,
	) => {
		const loop = pollLoopRef.current;
		if (!loop || loop.traceId !== traceId) {
			const existingTimeline = liveActivityRef.current;
			if (existingTimeline && existingTimeline.traceId === traceId) {
				const completedTimeline = ensureTimelineCompleted(existingTimeline);
				updateMessage(assistantMessageId, (message) => {
					const resolvedCommitLifecycleRaw =
						resolveCommitLifecycleFromTimeline(completedTimeline);
					const resolvedCommitLifecycle =
						resolvedCommitLifecycleRaw?.state === "committed" &&
						resolvedCommitLifecycleRaw.impactedItems.length === 0 &&
						(message.commitLifecycle?.impactedItems.length ?? 0) > 0
							? {
									...resolvedCommitLifecycleRaw,
									impactedItems: message.commitLifecycle?.impactedItems ?? [],
								}
							: resolvedCommitLifecycleRaw;
					const fallbackCommitLifecycle =
						!resolvedCommitLifecycle &&
						message.commitLifecycle?.state === "committing"
							? {
									...message.commitLifecycle,
									state: "failed" as const,
									updatedAt:
										completedTimeline.completedAt || new Date().toISOString(),
								}
							: message.commitLifecycle;
					return {
						...message,
						activityTimeline: completedTimeline,
						commitLifecycle: resolvedCommitLifecycle ?? fallbackCommitLifecycle,
					};
				});
				setActivityExpandedByMessageId((prev) => ({
					...prev,
					[assistantMessageId]: false,
				}));
			}
			setLiveActivity(null);
			setLiveActivityExpanded(false);
			setLiveActivityHostMessageId(null);
			return;
		}

		const finish = async () => {
			// 30s accommodates slow Vercel cold-start commits (observed 10-15s).
			// The backend sets `trace.done=true` on auto_commit_async_completed
			// or auto_commit_async_failed, so we usually break well before this
			// deadline. When we do hit it, `resolveCommitLifecycleFromTimeline`
			// keeps the UI in "committing" (not "failed") for enqueued-but-not-yet-
			// completed commits — avoids a false-negative toast.
			const deadline = Date.now() + 30_000;
			// Track the latest computed timeline locally so the finalize block
			// below doesn't depend on `liveActivityRef.current` being synced.
			// The ref is updated via a useEffect after render, so when the loop
			// breaks synchronously on `response.done`, the ref still holds the
			// previous iteration's timeline — missing the just-arrived
			// auto_commit_async_completed event. That stale read triggers the
			// `commitLifecycle: 'failed'` fallback even when the commit actually
			// succeeded.
			let latestTimeline: RoadmapAiActivityTimeline | null =
				liveActivityRef.current;
			while (!loop.cancelled && Date.now() < deadline) {
				if (loop.pollingFailed) break;
				try {
					const response = await roadmapAgentService.getTraceEvents(
						loop.sessionId,
						loop.traceId,
						{
							afterSeq: loop.afterSeq,
							limit: TRACE_POLL_LIMIT,
							detail: progressDetailMode,
						},
					);
					if (loop.cancelled) return;
					loop.afterSeq = Math.max(loop.afterSeq, response.next_seq);
					setLiveActivity((prev) => {
						const next = toTimelineFromTraceResponse(
							progressDetailMode,
							loop.traceId,
							response,
							prev,
							progressPresentationMode,
						);
						latestTimeline = next;
						return next;
					});
					await maybeRefreshRoadmapFromTraceEvents(
						loop.traceId,
						response.events,
					);
					if (response.done) break;
				} catch (error) {
					if (
						isTraceNotReadyError(error) &&
						Date.now() - loop.startedAtMs < TRACE_NOT_READY_GRACE_MS
					) {
						await new Promise<void>((resolve) => {
							window.setTimeout(resolve, TRACE_POLL_INTERVAL_MS);
						});
						continue;
					}
					loop.pollingFailed = true;
					setTracePollingFailed(true);
					break;
				}
				await new Promise<void>((resolve) => {
					window.setTimeout(resolve, TRACE_POLL_INTERVAL_MS);
				});
			}

			if (loop.timerId != null) {
				window.clearTimeout(loop.timerId);
			}
			loop.cancelled = true;
			if (pollLoopRef.current === loop) {
				pollLoopRef.current = null;
			}

			const timeline = latestTimeline ?? liveActivityRef.current;
			if (
				timeline &&
				timeline.traceId === traceId &&
				timeline.steps.length > 0
			) {
				const completedTimeline = ensureTimelineCompleted(timeline);
				updateMessage(assistantMessageId, (message) => {
					const resolvedCommitLifecycleRaw =
						resolveCommitLifecycleFromTimeline(completedTimeline);
					const resolvedCommitLifecycle =
						resolvedCommitLifecycleRaw?.state === "committed" &&
						resolvedCommitLifecycleRaw.impactedItems.length === 0 &&
						(message.commitLifecycle?.impactedItems.length ?? 0) > 0
							? {
									...resolvedCommitLifecycleRaw,
									impactedItems: message.commitLifecycle?.impactedItems ?? [],
								}
							: resolvedCommitLifecycleRaw;
					const fallbackCommitLifecycle =
						!resolvedCommitLifecycle &&
						message.commitLifecycle?.state === "committing"
							? {
									...message.commitLifecycle,
									state: "failed" as const,
									updatedAt:
										completedTimeline.completedAt || new Date().toISOString(),
								}
							: message.commitLifecycle;
					return {
						...message,
						activityTimeline: completedTimeline,
						commitLifecycle: resolvedCommitLifecycle ?? fallbackCommitLifecycle,
					};
				});
				setActivityExpandedByMessageId((prev) => ({
					...prev,
					[assistantMessageId]: false,
				}));
			}
			setLiveActivity(null);
			setLiveActivityExpanded(false);
			setLiveActivityHostMessageId(null);
		};

		void finish();
	};

	const pendingAutoSubmitRef = useRef<string | null>(null);
	// Optional display override for programmatic sends: when the wire payload
	// is a structured sentinel (e.g. `__plan_decision__\n{...}`), we still want
	// the chat bubble + DB persistence to carry the friendly human label
	// instead of leaking the raw JSON. Cleared alongside the auto-submit ref.
	const pendingAutoSubmitDisplayRef = useRef<string | null>(null);

	const handleSend = async () => {
		const trimmedMessage = input.trim();
		if ((!trimmedMessage && attachments.length === 0) || isSending) return;

		const attachmentMetadata: RoadmapAiChatAttachment[] = attachments.map(
			({ id, file }) => ({
				id,
				name: file.name,
				size: file.size,
				type: file.type || undefined,
			}),
		);

		const attachmentContext =
			attachmentMetadata.length > 0
				? `\n\nAttached files:\n${attachmentMetadata
						.map(
							(file) => `- ${file.name} (${formatAttachmentSize(file.size)})`,
						)
						.join("\n")}`
				: "";
		const agentMessage = `${trimmedMessage || "Please review the attached files."}${attachmentContext}`;
		// Structured sends (e.g. `__plan_decision__\n{...}`) set a display label
		// via submitProgrammaticMessage so the chat bubble + DB history carry the
		// human-readable version. Plain-text sends fall back to the wire payload,
		// same as before.
		const displayOverride = pendingAutoSubmitDisplayRef.current;
		pendingAutoSubmitDisplayRef.current = null;
		const userFacingContent =
			displayOverride ?? (trimmedMessage || "Attached files");

		setInput("");
		setAttachments([]);
		if (fileInputRef.current) fileInputRef.current.value = "";
		setErrorMessage(null);

		setIsSending(true);
		setTracePollingFailed(false);
		let activeSessionId: string | null = null;
		let traceId: string | null = null;
		let assistantId: string | null = null;
		try {
			// ensureThread must run first — if there is no activeThreadId yet (first
			// message), it creates the DB row and calls setActiveThread so the hook's
			// threadId is non-null before appendMessage fires. Calling appendMessage
			// before this resolves silently drops the message (threadId === null
			// hits the early return in useRoadmapAiAssistantSession).
			activeSessionId = await ensureThread();
			appendMessage({
				id: crypto.randomUUID(),
				role: "user",
				content: userFacingContent,
				timestamp: new Date().toISOString(),
				attachments: attachmentMetadata,
			});
			traceId = crypto.randomUUID();
			// Persist the user turn BEFORE calling the agent so it survives an
			// agent failure (matches ChatGPT retry UX). The response includes the
			// last N messages we can replay if the agent's Redis session expired.
			// Note: we persist the friendly text (not the sentinel) so reloading
			// history doesn't show raw JSON, and agent session rehydration replays
			// the same human-readable turn the UI already shows.
			const { seed_messages: seedMessagesForRetry } = await persistTurn(
				"user",
				userFacingContent,
			);
			startTracePolling(activeSessionId, traceId);

			const boundSessionId = activeSessionId;
			const response = await rehydrateAndRetry(
				boundSessionId,
				seedMessagesForRetry,
				() =>
					roadmapAgentService.sendMessage(
						boundSessionId,
						{
							message: agentMessage,
						},
						{
							traceId: traceId ?? undefined,
						},
					),
			);
			const effectiveTraceId = response.debug_trace_id || traceId;
			if (effectiveTraceId !== traceId) {
				traceId = effectiveTraceId;
				startTracePolling(activeSessionId, effectiveTraceId);
			}

			setLiveActivity((prev) => {
				if (!prev) return prev;
				if (prev.traceId !== traceId) return prev;
				return ensureTimelineCompleted(prev);
			});

			assistantId = crypto.randomUUID();
			setLiveActivityHostMessageId(assistantId);
			const shouldTrackCommitLifecycle =
				response.response_mode === "edit_plan" &&
				((response.staged_operations_count ?? 0) > 0 ||
					(response.operations?.length ?? 0) > 0);
			const initialCommitImpactedItems = parseCommitImpactedItemsFromOperations(
				response.operations,
			);
			appendMessage({
				...buildAssistantMessage(
					response.assistant_message || "I analyzed your request.",
					response.parse_mode || "agent_response",
					{
						intentType: response.intent_type,
						responseMode: response.response_mode,
						planProposal: response.plan_proposal ?? undefined,
						clarifier: response.clarifier ?? undefined,
						commitLifecycle: shouldTrackCommitLifecycle
							? {
									state: "committing",
									impactedItems: initialCommitImpactedItems,
									updatedAt: new Date().toISOString(),
								}
							: undefined,
					},
				),
				id: assistantId,
			});

			// Persist the assistant turn to the DB. Fire-and-forget so slow
			// Supabase writes never block artifact hydration or the live trace.
			// Artifact snapshots evolve after this point via updateMessage (live
			// trace, commit lifecycle), but those updates are ephemeral UI state
			// and don't round-trip to the DB — past threads still render fine
			// since the assistant text + intent + response_mode are persisted.
			void persistTurn("assistant", response.assistant_message || "", {
				intentType: response.intent_type,
				responseMode: response.response_mode,
				parseMode: response.parse_mode || "agent_response",
				tokens: undefined,
				metadata: (() => {
					const meta: Record<string, unknown> = {};
					if (response.plan_proposal) {
						meta.plan_proposal = response.plan_proposal as unknown as Record<
							string,
							unknown
						>;
					}
					if (response.clarifier) {
						meta.clarifier = response.clarifier as unknown as Record<
							string,
							unknown
						>;
					}
					return Object.keys(meta).length > 0 ? meta : undefined;
				})(),
			}).catch((err) => {
				console.warn(
					"[RoadmapAiAssistantPanel] assistant message persistence failed",
					err,
				);
			});

			// A synchronous commit landed: update the "Committed changes"
			// confirmation and apply the change to the live roadmap *optimistically*
			// from the commit summary, so the canvas/sidebar reflect it immediately.
			// The full reload (refreshRoadmapAfterAutoCommit) only reconciles details
			// in the background — it must not gate the visible update because GET
			// /full can take many seconds right after a commit.
			const commitSummary = response.commit_summary;
			if (commitSummary?.committed) {
				const impactedItems = parseCommitImpactedItemsFromTraceDetails({
					impacted_items: commitSummary.impacted_items ?? [],
				});
				updateMessage(assistantId, (message) => ({
					...message,
					commitLifecycle: {
						state: "committed",
						impactedItems:
							impactedItems.length > 0
								? impactedItems
								: (message.commitLifecycle?.impactedItems ?? []),
						updatedAt: new Date().toISOString(),
					},
				}));
				// Instant: insert/remove the committed nodes locally.
				applyAiCommitImpactedItems(
					response.operations ?? [],
					commitSummary.impacted_items ?? [],
				);
				// Background: reconcile full detail; never block the UI on it.
				void refreshRoadmapAfterAutoCommit().catch((refreshError) => {
					console.warn(
						"[RoadmapAiAssistantPanel] roadmap_refresh_after_commit_failed",
						{
							trace_id: response.debug_trace_id || null,
							session_id: activeSessionId,
							roadmap_id: roadmapId,
							error:
								refreshError instanceof Error
									? refreshError.message
									: String(refreshError),
						},
					);
				});
			} else if (commitSummary && !commitSummary.committed) {
				// The sync commit failed. The agent already discarded the staged ops,
				// so the deterministic UX is a failed card with the backend's reason —
				// the user re-asks with a fix; nothing is left dangling server-side.
				updateMessage(assistantId, (message) => ({
					...message,
					commitLifecycle: {
						state: "failed",
						impactedItems: message.commitLifecycle?.impactedItems ?? [],
						updatedAt: new Date().toISOString(),
						errorMessage: commitSummary.error_message ?? undefined,
					},
				}));
			}
		} catch (error) {
			const timeoutError = isAgentTimeoutError(error);
			const timeoutMessage =
				"AI response is taking longer than expected. Please wait or retry.";
			const readableError =
				error instanceof Error
					? error.message
					: "Failed to reach AI agent service.";
			const userFacingMessage = timeoutError ? timeoutMessage : readableError;
			setErrorMessage(userFacingMessage);
			if (timeoutError) {
				console.warn("[RoadmapAiAssistantPanel] send_message_timeout", {
					session_id: activeSessionId,
					roadmap_id: roadmapId,
					error: readableError,
					trace_id: traceId,
				});
			}
			appendMessage(
				buildAssistantMessage(
					timeoutError
						? timeoutMessage
						: "I couldn't complete that request. Please try again.",
					"agent_error",
				),
			);
			stopActivePollLoop();
			setLiveActivity(null);
			setLiveActivityExpanded(false);
			setLiveActivityHostMessageId(null);
		} finally {
			setIsSending(false);
			// The final assistant message (or error bubble) replaces the
			// streamed preview.
			setStreamingPreview(null);
			if (assistantId && traceId) {
				finalizeTraceTimeline(assistantId, traceId);
			}
		}
	};

	// When onApplyPlan/onDiscardPlan fills the input with a canonical string,
	// this effect auto-dispatches handleSend once React has flushed the state
	// update. The ref gates the auto-submit so user typing can't accidentally
	// trigger it.
	useEffect(() => {
		if (
			pendingAutoSubmitRef.current !== null &&
			input === pendingAutoSubmitRef.current &&
			!isSending
		) {
			pendingAutoSubmitRef.current = null;
			void handleSend();
		}
	}, [input, isSending]);

	const submitProgrammaticMessage = (
		content: string,
		options?: { displayLabel?: string },
	) => {
		if (isSending) return;
		pendingAutoSubmitRef.current = content;
		pendingAutoSubmitDisplayRef.current = options?.displayLabel ?? null;
		setInput(content);
	};

	// One-shot auto-send for the homepage hero handoff: the parent passes the
	// pending prompt via `initialMessage` after opening the panel. Latched by
	// `hasAutoSentInitialRef` (plus the parent's consume callback and the
	// upstream sessionStorage read-and-clear) so the turn can never dispatch
	// twice. Waits for the sessions list so thread hydration can't race the
	// send — for a fresh roadmap the list resolves empty and handleSend's
	// ensureThread creates the DB row + agent session.
	const hasAutoSentInitialRef = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: submitProgrammaticMessage/onInitialMessageConsumed are recreated every render; the ref latch makes reruns no-ops — same pattern as the auto-dispatch effect above.
	useEffect(() => {
		if (!initialMessage) return;
		if (
			!shouldAutoSendInitialMessage({
				isVisible,
				initialMessage,
				isSending,
				threadsListReady: threadsList.isSuccess,
				hasAutoSentInitial: hasAutoSentInitialRef.current,
			})
		) {
			return;
		}
		hasAutoSentInitialRef.current = true;
		submitProgrammaticMessage(initialMessage);
		onInitialMessageConsumed?.();
	}, [isVisible, initialMessage, isSending, threadsList.isSuccess]);

	const isMessageActivityExpanded = (
		messageId: string,
		timeline: RoadmapAiActivityTimeline,
	): boolean => {
		return getDefaultTimelineExpanded(
			timeline.done,
			activityExpandedByMessageId[messageId],
		);
	};

	const toggleMessageActivity = (
		messageId: string,
		timeline: RoadmapAiActivityTimeline,
	) => {
		setActivityExpandedByMessageId((prev) => {
			const current =
				typeof prev[messageId] === "boolean" ? prev[messageId] : !timeline.done;
			return {
				...prev,
				[messageId]: !current,
			};
		});
	};

	const handleComposerKeyDown = (
		event: React.KeyboardEvent<HTMLTextAreaElement>,
	) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void handleSend();
		}
	};

	const handleAddAttachment = (event: React.ChangeEvent<HTMLInputElement>) => {
		const selectedFiles = Array.from(event.target.files || []);
		if (selectedFiles.length === 0) return;

		setAttachments((prev) => {
			const existingKeys = new Set(
				prev.map((entry) => `${entry.file.name}:${entry.file.size}`),
			);
			const next = [...prev];
			for (const file of selectedFiles) {
				const key = `${file.name}:${file.size}`;
				if (existingKeys.has(key)) continue;
				existingKeys.add(key);
				next.push({ id: crypto.randomUUID(), file });
			}
			return next;
		});
	};

	const removeAttachment = (attachmentId: string) => {
		setAttachments((prev) => prev.filter((entry) => entry.id !== attachmentId));
	};

	const displayLiveTimeline = normalizeTimelineForDisplay(
		liveActivity,
		progressPresentationMode,
	);
	const isLiveTimelineAnchoredInMessage = Boolean(
		displayLiveTimeline &&
			liveActivityHostMessageId &&
			messages.some((message) => message.id === liveActivityHostMessageId),
	);

	if (!isVisible) {
		return null;
	}

	const activeThreadLabel = (() => {
		if (!activeThreadId) return "New thread";
		const thread = threadsList.data?.find((t) => t.id === activeThreadId);
		const title = thread?.title?.trim();
		return title && title.length > 0 ? title : "Untitled";
	})();

	const handleSelectThread = (threadId: string) => {
		if (threadId === activeThreadId) return;
		setActiveThread(roadmapId, threadId);
	};

	const handleCreateNewThread = async () => {
		try {
			const row = await createAiSession.mutateAsync({});
			// Switch to the new thread the moment its DB row exists. The redirect
			// must NOT block on the agent's Redis-session warm-up: at
			// min-instances=0 the agent can cold-start (or fail), and awaiting it
			// here would hang the UI on a blank new thread with no error -- which is
			// exactly the "New thread does nothing" bug. The send path
			// (ensureThread) lazily creates/rehydrates the agent session on the
			// first message anyway (no-clobber guard), so warming it now is
			// best-effort.
			justCreatedThreadRef.current = row.id;
			markThreadHydrated(row.id);
			setActiveThread(roadmapId, row.id);
			void roadmapAgentService
				.createSession({
					session_id: row.id,
					roadmap_id: roadmapId,
					base_revision: baseRevision,
				})
				.then(() => {
					agentSessionsInitializedRef.current.add(row.id);
				})
				.catch((err) => {
					console.warn(
						"[RoadmapAiAssistantPanel] agent createSession warm-up failed",
						err,
					);
				});
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to create new thread.";
			toast.error(message);
		}
	};

	return (
		<section
			className="h-full w-full bg-white border-l border-gray-200 overflow-hidden flex flex-col"
			aria-label="AI Assistant Panel"
		>
			<div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 bg-white">
				<div className="flex items-center gap-2 min-w-0">
					<Bot size={14} className="text-blue-500 shrink-0" />
					<span className="text-xs font-semibold text-gray-800">
						AI Assistant
					</span>
				</div>
				<div className="relative">
					<button
						ref={threadMenuTriggerRef}
						type="button"
						onClick={() => setIsThreadMenuOpen((prev) => !prev)}
						className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
						aria-haspopup="dialog"
						aria-expanded={isThreadMenuOpen}
					>
						<span className="max-w-[140px] truncate">{activeThreadLabel}</span>
						<ChevronDown size={12} />
					</button>
					<AnimatePresence>
						{isThreadMenuOpen && (
							<RoadmapAiThreadList
								roadmapId={roadmapId}
								activeThreadId={activeThreadId}
								anchorRef={threadMenuTriggerRef}
								onSelectThread={handleSelectThread}
								onCreateNewThread={handleCreateNewThread}
								onClose={() => setIsThreadMenuOpen(false)}
							/>
						)}
					</AnimatePresence>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-gray-50/40 relative [scrollbar-width:thin] [scrollbar-color:rgba(156,163,175,0.5)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[scrollbar-color:rgba(107,114,128,0.7)_transparent] hover:[&::-webkit-scrollbar-thumb]:bg-gray-500">
				{isThreadLoading ? (
					<ThreadHistorySkeleton />
				) : messages.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center text-center px-4">
						<Bot className="w-8 h-8 text-gray-400 mb-2" />
						<p className="text-sm text-gray-700 font-medium">
							Ask questions or request roadmap edits
						</p>
						<p className="text-xs text-gray-500 mt-1">
							Example: "add an epic for onboarding improvements"
						</p>
					</div>
				) : (
					messages.map((message) => {
						// A clarifier is only answerable while it is the newest message —
						// once the conversation moves on, its options are stale and
						// submitting one would send a confusing answer to the agent.
						const isLatestMessage =
							messages.length > 0 &&
							messages[messages.length - 1].id === message.id;
						const commitLifecycle = message.commitLifecycle;
						const groupedCommitItems = commitLifecycle
							? groupCommitImpactedItems(commitLifecycle.impactedItems)
							: null;
						const persistedActivityTimeline = normalizeTimelineForDisplay(
							message.activityTimeline,
							progressPresentationMode,
						);
						const isLiveTimelineHostMessage =
							message.role === "assistant" &&
							Boolean(displayLiveTimeline) &&
							message.id === liveActivityHostMessageId;
						const activityTimeline =
							isLiveTimelineHostMessage && displayLiveTimeline
								? displayLiveTimeline
								: persistedActivityTimeline;
						const shouldCollapseForCommitLifecycle =
							message.role === "assistant" && Boolean(commitLifecycle);
						return (
							<article
								key={message.id}
								className={
									message.role === "user"
										? "ai-gradient-bg rounded-xl px-3.5 py-2.5 border-0 text-white ml-8 mr-0 shadow-sm"
										: "px-0 py-1.5 border-0 bg-transparent ml-0 mr-4"
								}
							>
								{message.role === "user" && (
									<div className="flex items-center justify-between gap-2 mb-1.5">
										<span className="text-[11px] font-semibold text-white/90">
											You
										</span>
										<span className="text-[10px] text-white/60">
											{new Date(message.timestamp).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</div>
								)}
								{message.role === "assistant" && (
									<div className="flex items-center justify-between gap-2 mb-1 text-[10px] text-gray-500">
										<span>Assistant</span>
										<span>
											{new Date(message.timestamp).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</div>
								)}
								{message.role === "assistant" && activityTimeline && (
									<div className="mb-2">
										<RoadmapAiActivityTimelineView
											timeline={activityTimeline}
											expanded={
												shouldCollapseForCommitLifecycle
													? (activityExpandedByMessageId[message.id] ?? false)
													: isLiveTimelineHostMessage && !activityTimeline.done
														? true
														: isMessageActivityExpanded(
																message.id,
																activityTimeline,
															)
											}
											onToggle={() => {
												if (
													!shouldCollapseForCommitLifecycle &&
													isLiveTimelineHostMessage &&
													!activityTimeline.done
												) {
													return;
												}
												toggleMessageActivity(message.id, activityTimeline);
											}}
										/>
									</div>
								)}

								{message.content ? (
									<div
										className={
											message.role === "user"
												? "text-xs leading-relaxed text-white [&_a]:text-white [&_a]:underline"
												: "text-xs text-gray-800 leading-relaxed"
										}
									>
										<ReactMarkdown
											remarkPlugins={[remarkGfm]}
											components={{
												p: ({ children }) => (
													<p className="mb-2 last:mb-0 whitespace-pre-wrap">
														{renderBracketTagsInNode(children)}
													</p>
												),
												ul: ({ children }) => (
													<ul className="mb-2 list-disc pl-4 space-y-1">
														{renderBracketTagsInNode(children)}
													</ul>
												),
												ol: ({ children }) => (
													<ol className="mb-2 list-decimal pl-4 space-y-1">
														{renderBracketTagsInNode(children)}
													</ol>
												),
												code: ({ children }) => (
													<code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">
														{children}
													</code>
												),
											}}
										>
											{message.content}
										</ReactMarkdown>
									</div>
								) : null}

								{(message.attachments?.length ?? 0) > 0 && (
									<div className="mt-2 flex flex-wrap gap-1.5">
										{message.attachments?.map((attachment) => (
											<span
												key={attachment.id}
												className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-1 text-[10px] text-gray-600"
											>
												<Paperclip className="h-3 w-3" />
												<span className="max-w-[140px] truncate">
													{attachment.name}
												</span>
												<span className="text-gray-400">
													{formatAttachmentSize(attachment.size)}
												</span>
											</span>
										))}
									</div>
								)}

								{message.role === "assistant" && commitLifecycle && (
									<div className="mt-2 rounded-md border border-gray-200 bg-white px-2.5 py-2">
										<div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-700">
											{commitLifecycle.state === "committing" ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
											) : commitLifecycle.state === "committed" ? (
												<Check className="h-3.5 w-3.5 text-green-600" />
											) : (
												<TriangleAlert className="h-3.5 w-3.5 text-red-600" />
											)}
											<span>
												{getCommitLifecycleLabel(commitLifecycle.state)}
											</span>
										</div>

										{commitLifecycle.state === "failed" && (
											<p className="mt-1 text-[10px] text-red-700">
												{commitLifecycle.errorMessage ??
													"The edit could not be applied to the roadmap. Rephrase the request and try again."}
											</p>
										)}

										{commitLifecycle.state === "committed" &&
											groupedCommitItems &&
											commitLifecycle.impactedItems.length > 0 && (
												<div className="mt-1.5 space-y-1.5">
													{COMMIT_IMPACT_KIND_ORDER.map((kind) => {
														const items = groupedCommitItems[kind];
														if (!items.length) return null;
														return (
															<div key={`${message.id}-${kind}`}>
																<p className="text-[10px] font-medium text-gray-700">
																	{COMMIT_IMPACT_KIND_LABEL[kind]} (
																	{items.length})
																</p>
																<div className="mt-1 flex flex-wrap gap-1">
																	{items.map((item) => (
																		<Link
																			key={`${message.id}-${kind}-${item.nodeType}-${item.nodeId}`}
																			to="/project/$projectId/roadmap/$roadmapId"
																			params={{ projectId, roadmapId }}
																			search={{
																				nodeId: item.nodeId,
																				view: roadmapLinkView,
																			}}
																			className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 hover:bg-slate-200"
																		>
																			{item.title ||
																				`${item.nodeType} ${item.nodeId.slice(0, 8)}`}
																		</Link>
																	))}
																</div>
															</div>
														);
													})}
												</div>
											)}
									</div>
								)}

								{message.role === "assistant" &&
									message.clarifier &&
									!message.planProposal &&
									isLatestMessage && (
										<RoadmapAiClarifierCard
											card={message.clarifier}
											disabled={isSending}
											onSubmit={(answer) => {
												const lane = message.clarifier!.lane;
												const friendly =
													(answer as { custom_answer?: string | null })
														.custom_answer ||
													(answer as { selected_option?: string | null })
														.selected_option ||
													"Submitted answer.";
												submitProgrammaticMessage(
													`__clarifier_answer__\n${JSON.stringify({
														lane,
														...answer,
													})}`,
													{ displayLabel: friendly },
												);
											}}
										/>
									)}

								{message.role === "assistant" &&
									message.planProposal &&
									message.planProposal.status === "awaiting_answers" && (
										<RoadmapAiPlanQuestionCard
											plan={message.planProposal}
											disabled={isSending}
											onSubmit={(answers) => {
												// Batched submit: all answers for the current question
												// batch go in one sentinel. Legacy shape `{question_id,
												// ...}` still works for single-question clarifiers
												// because the pre-dispatcher's plan-answer ingest
												// accepts both `{answers: [...]}` and a bare dict.
												const answerSummary = answers
													.map((a) => {
														const value = a.custom_answer || a.selected_option;
														return value ? `• ${value}` : null;
													})
													.filter((entry): entry is string => entry !== null)
													.join("\n");
												submitProgrammaticMessage(
													`__plan_answers__\n${JSON.stringify({ answers })}`,
													{
														displayLabel:
															answerSummary.length > 0
																? `Submitted plan answers:\n${answerSummary}`
																: "Submitted plan answers.",
													},
												);
											}}
											onDiscard={() => {
												const planId = message.planProposal?.plan_id;
												if (planId) {
													submitProgrammaticMessage(
														`__plan_decision__\n${JSON.stringify({
															decision: "reject",
															plan_id: planId,
														})}`,
														{ displayLabel: "Cancel this plan." },
													);
												} else {
													submitProgrammaticMessage("Cancel this plan.");
												}
											}}
										/>
									)}

								{message.role === "assistant" &&
									message.planProposal &&
									message.planProposal.status !== "awaiting_answers" && (
										<RoadmapAiPlanProposalCard
											plan={message.planProposal}
											disabled={isSending}
											onApply={() => {
												// Structured decision bypasses the regex + classifier
												// path in the agent — deterministically fires the
												// plan-confirm bridge instead of relying on NLP to
												// interpret "Yes, apply this plan." The plain-text
												// fallback is kept only for clients that can't include
												// a plan_id.
												const planId = message.planProposal?.plan_id;
												if (planId) {
													submitProgrammaticMessage(
														`__plan_decision__\n${JSON.stringify({
															decision: "confirm",
															plan_id: planId,
														})}`,
														{ displayLabel: "Apply this plan." },
													);
												} else {
													submitProgrammaticMessage("Yes, apply this plan.");
												}
											}}
											onDiscard={() => {
												const planId = message.planProposal?.plan_id;
												if (planId) {
													submitProgrammaticMessage(
														`__plan_decision__\n${JSON.stringify({
															decision: "reject",
															plan_id: planId,
														})}`,
														{ displayLabel: "Cancel this plan." },
													);
												} else {
													submitProgrammaticMessage("Cancel this plan.");
												}
											}}
										/>
									)}
							</article>
						);
					})
				)}

				{isSending && streamingPreview && streamingPreview.text.trim() && (
					<article
						className="px-0 py-1.5 border-0 bg-transparent ml-0 mr-4"
						aria-live="polite"
					>
						<div className="mb-1 text-[10px] text-gray-500">Assistant</div>
						<div className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">
							{streamingPreview.text}
							<span className="ml-0.5 inline-block h-3 w-[2px] translate-y-[2px] animate-pulse bg-gray-500" />
						</div>
					</article>
				)}

				{displayLiveTimeline &&
				!tracePollingFailed &&
				!isLiveTimelineAnchoredInMessage ? (
					<div className="mr-4">
						<RoadmapAiActivityTimelineView
							timeline={displayLiveTimeline}
							expanded={displayLiveTimeline.done ? liveActivityExpanded : true}
							onToggle={() => {
								if (!displayLiveTimeline.done) return;
								setLiveActivityExpanded((prev) => !prev);
							}}
						/>
					</div>
				) : shouldRenderThinkingFallback(
						isSending,
						Boolean(liveActivity),
						tracePollingFailed,
					) ? (
					<div className="mr-4 text-xs text-gray-400 italic">Thinking...</div>
				) : null}

				<div ref={messagesEndRef} />
			</div>

			<footer className="border-t border-gray-200 bg-white px-3 py-3">
				{errorMessage && (
					<div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 flex items-start gap-1.5">
						<TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
						<span>{errorMessage}</span>
					</div>
				)}

				<div className="mb-2 flex items-center justify-between gap-2">
					<span className="text-[10px] text-gray-500">
						Agent endpoint:{" "}
						{import.meta.env.VITE_AGENT_API_URL || "http://localhost:8010"}
					</span>
				</div>

				{(attachments.length > 0 || !isSending) && (
					<div className="mb-2 flex flex-wrap gap-1.5">
						{attachments.map((attachment) => (
							<span
								key={attachment.id}
								className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-700"
							>
								<Paperclip className="h-3 w-3" />
								<span className="max-w-[130px] truncate">
									{attachment.file.name}
								</span>
								<span className="text-slate-400">
									{formatAttachmentSize(attachment.file.size)}
								</span>
								<button
									type="button"
									onClick={() => removeAttachment(attachment.id)}
									className="rounded-full p-0.5 hover:bg-slate-200"
									aria-label={`Remove ${attachment.file.name}`}
									disabled={isSending}
								>
									<X className="h-3 w-3" />
								</button>
							</span>
						))}
					</div>
				)}

				<div className="flex items-end gap-2">
					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="hidden"
						onChange={handleAddAttachment}
					/>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={isSending}
						className="h-10 w-10 rounded-xl border border-gray-300 text-gray-600 inline-flex items-center justify-center hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
						title="Add attachment"
						aria-label="Add attachment"
					>
						<Paperclip className="w-4 h-4" />
					</button>

					<textarea
						ref={composerRef}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={handleComposerKeyDown}
						placeholder="Chat or request roadmap edits..."
						className="flex-1 min-h-10 max-h-40 rounded-xl border border-gray-300 px-3 py-2 text-sm resize-none overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
						disabled={isSending}
						rows={1}
					/>
					<button
						type="button"
						onClick={() => void handleSend()}
						disabled={isSending || (!input.trim() && attachments.length === 0)}
						className="h-10 w-10 rounded-xl ai-gradient-bg text-white inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
						title="Send message"
					>
						<Send className="w-4 h-4" />
					</button>
				</div>
			</footer>
		</section>
	);
}
