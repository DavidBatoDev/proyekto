import { useQueryClient } from "@tanstack/react-query";
import { GitBranchPlus, ListTodo, Sparkles, Telescope } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	AiAssistantIntro,
	AiAssistantWordmark,
	type AiQuickPrompt,
} from "@/components/ai/AiAssistantIdentity";
import { AiAssistantPanel } from "@/components/ai/AiAssistantPanel";
import type { AiCommitLinkView } from "@/components/ai/AiCommitCard";
import type { RunHooks } from "@/components/ai/runController";
import {
	type AiSessionScope,
	NO_PROJECT_ROUTE_ID,
} from "@/components/ai/scope";
import { useProjectDetailQuery } from "@/hooks/useProjectQueries";
import { projectKeys } from "@/queries/project";
import { useRoadmapStore } from "@/stores/roadmapStore";
import {
	buildRoadmapContextRefs,
	buildRoadmapMentionCandidates,
} from "./roadmapMentionCandidates";

// =============================================================================
// The in-roadmap assistant: a thin wrapper that binds the shared AI kit to
// one roadmap. It is the ONLY place the assistant touches `roadmapStore`
// (the kit is boundary-tested against it): the loaded tree feeds the primary
// @-mention candidates, committed edits are applied optimistically to the
// canvas, and the run's trace events refresh the roadmap when they belong to
// it. Every string Playwright depends on is frozen here.
// =============================================================================

interface RoadmapAiAssistantPanelProps {
	projectId: string;
	roadmapId: string;
	baseRevision?: number;
	isVisible?: boolean;
	/**
	 * One-shot message auto-sent as the first turn once the panel is visible
	 * and the sessions list has loaded (homepage hero handoff).
	 */
	initialMessage?: string | null;
	/** Called after `initialMessage` has been dispatched exactly once. */
	onInitialMessageConsumed?: () => void;
}

const REFRESHING_TRACE_EVENTS = new Set(["commit_completed"]);

const INTRO_TITLE = "Ask Proyekto about this roadmap";
const INTRO_SUBTITLE = "Pick a question or ask your own.";

/**
 * Roadmap-scope questions, the counterpart of the dashboard's workspace ones.
 * Each leans on the loaded tree rather than on anything a fresh roadmap would
 * lack, and the first is an edit, because requesting edits is what this panel
 * is for.
 */
const ROADMAP_QUICK_PROMPTS: readonly AiQuickPrompt[] = [
	{ prompt: "Add an epic for onboarding improvements", icon: GitBranchPlus },
	{ prompt: "Summarize this roadmap", icon: Telescope },
	{ prompt: "What is unassigned or unscheduled?", icon: ListTodo },
	{ prompt: "What should we work on next?", icon: Sparkles },
];

export function RoadmapAiAssistantPanel({
	projectId,
	roadmapId,
	baseRevision,
	isVisible = true,
	initialMessage,
	onInitialMessageConsumed,
}: RoadmapAiAssistantPanelProps) {
	const queryClient = useQueryClient();
	const scope = useMemo<AiSessionScope>(
		() => ({ kind: "roadmap", roadmapId, projectId }),
		[roadmapId, projectId],
	);
	const canvasViewMode = useRoadmapStore((state) => state.canvasViewMode);
	const loadRoadmap = useRoadmapStore((state) => state.loadRoadmap);
	const applyAiCommitImpactedItems = useRoadmapStore(
		(state) => state.applyAiCommitImpactedItems,
	);
	const tree = useRoadmapStore(
		useShallow((state) => ({
			roadmap: state.roadmap,
			epics: state.epics,
			milestones: state.milestones,
		})),
	);
	const primaryMentionCandidates = useMemo(
		() => buildRoadmapMentionCandidates(roadmapId, projectId, tree),
		[roadmapId, projectId, tree],
	);
	// Every message from this page carries the roadmap and its project as
	// context chips. The project title is a cache read on this route (the
	// roadmap page already fetched the detail); the store may still hold
	// another roadmap while a run settles, so only trust a matching row.
	const projectQuery = useProjectDetailQuery(
		projectId === NO_PROJECT_ROUTE_ID ? "" : projectId,
	);
	const projectTitle = projectQuery.data?.title;
	const roadmapName =
		tree.roadmap?.id === roadmapId ? tree.roadmap.name : undefined;
	const autoContextRefs = useMemo(
		() =>
			buildRoadmapContextRefs(roadmapId, projectId, roadmapName, projectTitle),
		[roadmapId, projectId, roadmapName, projectTitle],
	);
	const commitLinkView: AiCommitLinkView =
		canvasViewMode === "milestones" ? "timelineView" : "roadmapView";
	const refreshSeqByTraceRef = useRef<Record<string, number>>({});

	// A run may outlive this page now: only touch the singleton store while it
	// still holds THIS roadmap; otherwise just invalidate the query so the
	// next visit reloads.
	const isStoreOnThisRoadmap = useCallback(
		() => useRoadmapStore.getState().roadmap?.id === roadmapId,
		[roadmapId],
	);

	// Background reconcile of the full roadmap (features/tasks/positions). The
	// visible change is applied optimistically from the commit, so this is
	// allowed to be slow — never block the UI on it.
	const refreshRoadmap = useCallback(async () => {
		if (isStoreOnThisRoadmap()) {
			await loadRoadmap(roadmapId, { force: true });
		}
		void queryClient.invalidateQueries({
			queryKey: projectKeys.roadmapFull(roadmapId),
			exact: true,
		});
	}, [isStoreOnThisRoadmap, loadRoadmap, queryClient, roadmapId]);

	const onCommits = useCallback<NonNullable<RunHooks["onCommits"]>>(
		(commits) => {
			let touchedFocus = false;
			for (const commit of commits) {
				if (commit.status !== "committed") continue;
				if (commit.roadmap_id !== roadmapId) {
					void queryClient.invalidateQueries({
						queryKey: projectKeys.roadmapFull(commit.roadmap_id),
						exact: true,
					});
					continue;
				}
				touchedFocus = true;
				if (isStoreOnThisRoadmap()) {
					// Instant: insert/remove the committed nodes locally.
					applyAiCommitImpactedItems(
						commit.operations ?? [],
						commit.impacted_items ?? [],
					);
				}
			}
			if (!touchedFocus) return;
			void refreshRoadmap().catch((error) => {
				console.warn(
					"[RoadmapAiAssistantPanel] roadmap_refresh_after_commit_failed",
					{
						roadmap_id: roadmapId,
						error: error instanceof Error ? error.message : String(error),
					},
				);
			});
		},
		[
			applyAiCommitImpactedItems,
			isStoreOnThisRoadmap,
			queryClient,
			refreshRoadmap,
			roadmapId,
		],
	);

	const onTraceEvents = useCallback<NonNullable<RunHooks["onTraceEvents"]>>(
		(traceId, events) => {
			const completionSeq = events
				.filter((event) => {
					if (!REFRESHING_TRACE_EVENTS.has(event.event)) return false;
					const eventRoadmapId = event.details?.roadmap_id;
					return (
						eventRoadmapId == null ||
						eventRoadmapId === "" ||
						eventRoadmapId === roadmapId
					);
				})
				.reduce<number | null>(
					(max, event) => (max == null || event.seq > max ? event.seq : max),
					null,
				);
			if (completionSeq == null) return;
			const alreadyRefreshedSeq = refreshSeqByTraceRef.current[traceId] ?? 0;
			if (completionSeq <= alreadyRefreshedSeq) return;
			refreshSeqByTraceRef.current[traceId] = completionSeq;
			void refreshRoadmap().catch((error) => {
				console.warn(
					"[RoadmapAiAssistantPanel] roadmap_refresh_after_trace_commit_failed",
					{
						trace_id: traceId,
						roadmap_id: roadmapId,
						error: error instanceof Error ? error.message : String(error),
					},
				);
			});
		},
		[refreshRoadmap, roadmapId],
	);

	return (
		<AiAssistantPanel
			scope={scope}
			variant="panel"
			ariaLabel="AI Assistant Panel"
			title={<AiAssistantWordmark />}
			emptyState={(context) => (
				<AiAssistantIntro
					title={INTRO_TITLE}
					subtitle={INTRO_SUBTITLE}
					prompts={ROADMAP_QUICK_PROMPTS}
					onAsk={context.send}
					disabled={context.disabled}
				/>
			)}
			placeholder="Chat or request roadmap edits..."
			isVisible={isVisible}
			initialMessage={initialMessage}
			onInitialMessageConsumed={onInitialMessageConsumed}
			baseRevision={baseRevision}
			primaryMentionCandidates={primaryMentionCandidates}
			autoContextRefs={autoContextRefs}
			commitLinkView={commitLinkView}
			onCommits={onCommits}
			onTraceEvents={onTraceEvents}
		/>
	);
}

export default RoadmapAiAssistantPanel;
