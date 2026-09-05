import type {
	AgentOperation,
	AgentTraceEvent,
	AgentTraceEventsResponse,
} from "@/services/ai-agent.service";
import {
	buildCuratedToolRequestedMessage,
	buildCuratedToolResultMessage,
	buildFriendlyMinimalToolLabel,
	extractTraceToolName,
} from "./aiToolMessaging";
import type {
	AiActivityDetailMode,
	AiActivityPresentationMode,
	AiActivityStep,
	AiActivityTimeline,
	AiCommitImpactedItem,
	AiCommitImpactedItemKind,
	AiCommitLifecycle,
} from "./types";

// =============================================================================
// Progress + trace-timeline logic for the shared AI kit. Lifted verbatim from
// `roadmap/ai/RoadmapAiAssistantPanel.tsx` (the pure, unit-tested half of the
// old panel): poll cadence constants, event describers, timeline normalizers,
// commit impact parsing. Pure module — no React, no stores.
//
// Run-era changes: the hidden set gains the run bookkeeping events, the
// describers gain `commit_started` / `commit_completed` / `commit_failed` /
// `verify_completed` copy (with `details.roadmap_title`), and the retired
// `auto_commit_async_*` events are gone (the agent no longer emits them).
// =============================================================================

// Poll cadence. The run controller owns the loop (and the per-leg deadline);
// `chooseNextPollDelayMs` below is the one place these are combined.
export const TRACE_POLL_INTERVAL_MS = 1000;
// While the send is in flight, poll faster so a short assistant_delta burst
// (a full answer can stream in under a second) isn't missed between polls;
// faster still once deltas are actually arriving. The endpoint is a cheap
// read on the agent.
export const TRACE_POLL_ACTIVE_INTERVAL_MS = 500;
export const TRACE_POLL_STREAMING_INTERVAL_MS = 300;
// While realtime push is actively delivering this trace's events, polling
// backs off to a slow reconciliation heartbeat: push paints the UI, the poll
// only advances the authoritative cursor (afterSeq / done) and catches dropped
// publishes. If push goes quiet for the freshness window, polling returns to
// the fast cadence above.
export const TRACE_POLL_PUSH_BACKOFF_INTERVAL_MS = 2500;
export const TRACE_PUSH_FRESH_WINDOW_MS = 4000;
export const TRACE_POLL_LIMIT = 25;
export const TRACE_NOT_READY_GRACE_MS = 10_000;
export const PROGRESS_DETAIL_MODE: AiActivityDetailMode = "structured";
const DEFAULT_PROGRESS_PRESENTATION_MODE: AiActivityPresentationMode =
	"curated";

export const parseProgressPresentationMode = (
	value: unknown,
): AiActivityPresentationMode => {
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

export const SHARED_HIDDEN_ACTIVITY_EVENTS = new Set<string>([
	"message_received",
	"actor_context_loaded",
	"intent_classified",
	"route_selected",
	"session_staged_state",
	"message_completed",
	"provider_success",
	// assistant_delta feeds the streaming preview bubble, not the timeline.
	"assistant_delta",
	// Run bookkeeping: the banner reads `phase_entered` details live; none of
	// these are user-facing rows.
	"run_started",
	"phase_entered",
	"phase_completed",
	"run_step_completed",
	"run_checkpoint",
	"refs_resolved",
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

export const COMMIT_IMPACT_KIND_ORDER: AiCommitImpactedItemKind[] = [
	"created",
	"modified",
	"deleted",
];

const COMMIT_IMPACT_KIND_PRIORITY: Record<AiCommitImpactedItemKind, number> = {
	created: 2,
	modified: 1,
	deleted: 3,
};

export const COMMIT_IMPACT_KIND_LABEL: Record<
	AiCommitImpactedItemKind,
	string
> = {
	created: "Created",
	modified: "Modified",
	deleted: "Deleted",
};

const isRoadmapNodeType = (
	value: unknown,
): value is AiCommitImpactedItem["nodeType"] => {
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
): AiCommitImpactedItemKind => {
	if (changeType === "NODE_ADDED") return "created";
	if (changeType === "NODE_REMOVED") return "deleted";
	return "modified";
};

export const parseCommitImpactedItemsFromOperations = (
	operations: AgentOperation[] | null | undefined,
): AiCommitImpactedItem[] => {
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

		let kind: AiCommitImpactedItemKind = "modified";
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

export const mergeCommitImpactedItems = (
	...groups: Array<AiCommitImpactedItem[] | undefined>
): AiCommitImpactedItem[] => {
	const merged = new Map<string, AiCommitImpactedItem>();
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
): AiCommitImpactedItem[] => {
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
		const kind: AiCommitImpactedItemKind =
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

/**
 * Legacy single-roadmap commit state derived from the trace: the newest
 * `commit_completed` / `commit_failed` row wins. New turns carry per-roadmap
 * `commits` in the run response, so this only backs the old
 * `commitLifecycle` shape (and the controller's finalize path when a response
 * had no commits but the trace shows one).
 */
export const resolveCommitLifecycleFromTimeline = (
	timeline: AiActivityTimeline,
): AiCommitLifecycle | null => {
	const completionStep = [...timeline.steps]
		.reverse()
		.find(
			(step) =>
				step.event === "commit_completed" || step.event === "commit_failed",
		);

	if (completionStep?.event === "commit_failed") {
		const details = toRecord(completionStep.details);
		const errorMessage = toStringValue(details?.error_message) ?? undefined;
		return {
			state: "failed",
			impactedItems: [],
			updatedAt: completionStep.ts,
			...(errorMessage ? { errorMessage } : {}),
		};
	}

	if (completionStep?.event === "commit_completed") {
		return {
			state: "committed",
			impactedItems: parseCommitImpactedItemsFromTraceDetails(
				completionStep.details,
			),
			updatedAt: completionStep.ts,
		};
	}

	const startedStep = [...timeline.steps]
		.reverse()
		.find((step) => step.event === "commit_started");
	if (startedStep && !timeline.done) {
		return {
			state: "committing",
			impactedItems: [],
			updatedAt: startedStep.ts,
		};
	}

	return null;
};

export const groupCommitImpactedItems = (
	items: AiCommitImpactedItem[],
): Record<AiCommitImpactedItemKind, AiCommitImpactedItem[]> => {
	const grouped: Record<AiCommitImpactedItemKind, AiCommitImpactedItem[]> = {
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

/** Frozen copy — Playwright greps `/Committed changes/i`. */
export const getCommitLifecycleLabel = (
	state: AiCommitLifecycle["state"],
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
	presentationMode: AiActivityPresentationMode,
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
	titleList?: AiActivityStep["titleList"];
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
	if (phase === "edit_plan" || phase === "execute") {
		return "I am planning the roadmap updates now and validating each step before execution.";
	}
	if (phase === "chat" || phase === "verify") {
		return "I am composing the response and checking it against your request context.";
	}
	return "I am working through the next planning step for your request.";
};

/** `details.roadmap_title` on the commit/verify events, when the agent sent one. */
const getEventRoadmapTitle = (rawStep: RawActivityStep): string | null =>
	toStringValue(toRecord(rawStep.details)?.roadmap_title);

const summarizeImpactedCounts = (items: AiCommitImpactedItem[]): string => {
	const counts: Record<AiCommitImpactedItemKind, number> = {
		created: 0,
		modified: 0,
		deleted: 0,
	};
	for (const item of items) counts[item.kind] += 1;
	const parts: string[] = [];
	for (const kind of COMMIT_IMPACT_KIND_ORDER) {
		const count = counts[kind];
		if (count === 0) continue;
		parts.push(
			`${COMMIT_IMPACT_KIND_LABEL[kind].toLowerCase()} ${count} ${
				count === 1 ? "item" : "items"
			}`,
		);
	}
	if (parts.length === 0) return "";
	const joined = parts.join(", ");
	return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
};

export const normalizeActivityStep = (
	rawStep: RawActivityStep,
	presentationMode: AiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): AiActivityStep | null => {
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

	// Per-roadmap commits inside a run's execute phase. `details.roadmap_title`
	// names the roadmap; `details.impacted_items` carries the touched nodes.
	if (normalizedEvent === "commit_started") {
		const roadmapTitle = getEventRoadmapTitle(rawStep);
		return {
			...baseStep,
			status: "running",
			title: roadmapTitle
				? `Applying changes to ${roadmapTitle}`
				: "Applying your changes",
			summary:
				presentationMode === "curated"
					? roadmapTitle
						? `I am applying the prepared changes to ${roadmapTitle} now.`
						: "I am applying the prepared changes now."
					: "Applying your changes now.",
		};
	}

	if (normalizedEvent === "commit_completed") {
		const roadmapTitle = getEventRoadmapTitle(rawStep);
		const impactedItems = parseCommitImpactedItemsFromTraceDetails(
			rawStep.details,
		);
		const countsSentence = summarizeImpactedCounts(impactedItems);
		return {
			...baseStep,
			status: "success",
			title: roadmapTitle
				? `Applied changes to ${roadmapTitle}`
				: "Applied your changes",
			summary:
				presentationMode === "curated"
					? `${
							roadmapTitle
								? `I applied your changes to ${roadmapTitle}.`
								: "I applied your changes."
						}${countsSentence ? ` ${countsSentence}` : ""}`
					: "Your changes were applied.",
		};
	}

	if (normalizedEvent === "commit_failed") {
		const details = toRecord(rawStep.details);
		const roadmapTitle = getEventRoadmapTitle(rawStep);
		const errorMessage =
			toStringValue(details?.error_message) ??
			toStringValue(details?.auto_commit_error_message);
		const invalidOperation =
			toRecord(details?.invalid_operation) ??
			toRecord(details?.auto_commit_invalid_operation);
		const invalidReason = toStringValue(invalidOperation?.reason);
		const hasStatusValidationIssue =
			(errorMessage ?? "").toLowerCase().includes("validation error") &&
			(invalidReason === "mark_status.status_invalid" ||
				errorMessage?.toLowerCase().includes("status"));
		return {
			...baseStep,
			status: "error",
			title: roadmapTitle
				? `Could not apply changes to ${roadmapTitle}`
				: "Could not apply changes",
			summary:
				presentationMode === "curated"
					? hasStatusValidationIssue
						? "Your change plan is ready, but one or more updates used an invalid status value. Use one of: todo, in progress, in review, done, or blocked."
						: errorMessage
							? `The changes${roadmapTitle ? ` to ${roadmapTitle}` : ""} were not applied: ${errorMessage}`
							: "The changes could not be applied. You can adjust the request and try again."
					: "Your changes were not applied.",
		};
	}

	if (normalizedEvent === "verify_completed") {
		const details = toRecord(rawStep.details);
		const verifyStatus = toStringValue(details?.status)?.toLowerCase();
		const verifySummary = toStringValue(details?.summary);
		if (verifyStatus === "nothing_to_verify") {
			return {
				...baseStep,
				status: "success",
				title: "Nothing to verify",
				summary:
					verifySummary ||
					(presentationMode === "curated"
						? "No roadmap changes were applied in this run, so there was nothing to check."
						: "No changes to check."),
			};
		}
		if (verifyStatus === "failed") {
			return {
				...baseStep,
				status: "error",
				title: "Verification found issues",
				summary:
					verifySummary ||
					(presentationMode === "curated"
						? "I checked the applied changes against the plan and found problems. See the report below."
						: "Verification found problems."),
			};
		}
		if (verifyStatus === "partial") {
			return {
				...baseStep,
				status: "success",
				title: "Verified with notes",
				summary:
					verifySummary ||
					(presentationMode === "curated"
						? "I checked the applied changes against the plan; most of it matches, with a few notes in the report."
						: "Verified with notes."),
			};
		}
		return {
			...baseStep,
			status: rawStep.status === "error" ? "error" : "success",
			title: "Verified the changes",
			summary:
				verifySummary ||
				(presentationMode === "curated"
					? "I checked the applied changes against the plan and everything matches."
					: "Changes verified."),
		};
	}

	return null;
};

export const mergeTimelineSteps = (
	existingSteps: AiActivityStep[],
	incomingEvents: AgentTraceEvent[],
	presentationMode: AiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): AiActivityStep[] => {
	const deduped = new Map<number, AiActivityStep>();
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

const findElapsedAnchor = (events: AgentTraceEvent[]): number | null => {
	// Keep elapsed time anchored to the model's completion so commit/verify
	// time is excluded. `message_completed` is the legacy anchor; a run step
	// carries the same `elapsed_ms` on `run_step_completed`.
	for (const anchorEvent of ["message_completed", "run_step_completed"]) {
		const candidate = [...events].reverse().find(
			(event) =>
				String(event.event || "")
					.trim()
					.toLowerCase() === anchorEvent,
		)?.details?.elapsed_ms;
		const normalized = parseCountFromUnknown(candidate);
		if (normalized != null) return normalized;
	}
	return null;
};

export const toTimelineFromTraceResponse = (
	detailMode: AiActivityDetailMode,
	traceId: string,
	response: AgentTraceEventsResponse,
	previousTimeline?: AiActivityTimeline | null,
	presentationMode: AiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): AiActivityTimeline => {
	const normalizedMessageCompletedElapsedMs = findElapsedAnchor(
		response.events,
	);

	return {
		traceId,
		startedAt: response.started_at || previousTimeline?.startedAt,
		completedAt: response.completed_at || previousTimeline?.completedAt,
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

// Next poll delay: realtime push freshness wins (slow reconciliation
// heartbeat), otherwise cadence follows whether deltas are streaming.
export const chooseNextPollDelayMs = (
	nowMs: number,
	lastPushAtMs: number,
	freshDeltaCount: number,
): number => {
	if (lastPushAtMs > 0 && nowMs - lastPushAtMs < TRACE_PUSH_FRESH_WINDOW_MS) {
		return TRACE_POLL_PUSH_BACKOFF_INTERVAL_MS;
	}
	return freshDeltaCount > 0
		? TRACE_POLL_STREAMING_INTERVAL_MS
		: TRACE_POLL_ACTIVE_INTERVAL_MS;
};

export const normalizeTimelineForDisplay = (
	timeline?: AiActivityTimeline | null,
	presentationMode: AiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): AiActivityTimeline | null => {
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
		.filter((step): step is AiActivityStep => step != null);
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
	timeline: AiActivityTimeline,
	completedAtIso = new Date().toISOString(),
): AiActivityTimeline => {
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
