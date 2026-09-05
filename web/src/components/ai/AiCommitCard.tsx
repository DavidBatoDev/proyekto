import { Link } from "@tanstack/react-router";
import { Check, Loader2, MinusCircle, TriangleAlert } from "lucide-react";
import type {
	AgentCommitImpactedItem,
	RunCommitView,
} from "@/services/ai-agent.service";
import {
	COMMIT_IMPACT_KIND_LABEL,
	COMMIT_IMPACT_KIND_ORDER,
	getCommitLifecycleLabel,
	groupCommitImpactedItems,
	mergeCommitImpactedItems,
	parseCommitImpactedItemsFromOperations,
	parseCommitImpactedItemsFromTraceDetails,
} from "./aiProgress";
import { type AiSessionScope, focusRoadmapId, toRouteProjectId } from "./scope";
import type { AiChatMessage, AiCommitLifecycle } from "./types";

// =============================================================================
// One card per roadmap commit inside a run (`RunCommitView`). The status line
// uses the frozen labels (`Committed changes` / `Commit did not complete` /
// `Committing changes` — Playwright greps `/Committed changes/i`); impacted
// nodes render as grouped chips that deep-link into the roadmap with the `"n"`
// project sentinel when the commit carries no project id.
// =============================================================================

export type AiCommitLinkView = "roadmapView" | "timelineView";

export interface AiCommitCardProps {
	commit: RunCommitView;
	scope: AiSessionScope | null;
	/** Canvas view to open for chips of the focus roadmap (roadmap scope). */
	linkView?: AiCommitLinkView;
}

const LEGACY_BATCH_ID = "legacy-commit-lifecycle";

const lifecycleStateFromStatus = (
	status: RunCommitView["status"],
): AiCommitLifecycle["state"] => {
	if (status === "committed") return "committed";
	if (status === "failed") return "failed";
	return "committing";
};

/** Status line for a commit; `skipped` has no lifecycle equivalent. */
export const getCommitStatusLabel = (
	status: RunCommitView["status"],
): string => {
	if (status === "skipped") return "Changes were skipped";
	return getCommitLifecycleLabel(lifecycleStateFromStatus(status));
};

const toWireImpactedItems = (
	lifecycle: AiCommitLifecycle,
): AgentCommitImpactedItem[] =>
	lifecycle.impactedItems.map((item) => ({
		node_id: item.nodeId,
		node_type: item.nodeType,
		title: item.title ?? null,
		change_type: item.changeType ?? null,
		impact: item.kind,
	}));

/**
 * Legacy persisted `commitLifecycle` rows (single-roadmap, pre-run) rendered
 * through the same card: the roadmap is the scope's focus roadmap.
 */
export const legacyLifecycleToCommit = (
	lifecycle: AiCommitLifecycle,
	roadmapId: string | null,
): RunCommitView => ({
	batch_id: LEGACY_BATCH_ID,
	roadmap_id: roadmapId ?? "",
	roadmap_title: null,
	project_id: null,
	status:
		lifecycle.state === "committed"
			? "committed"
			: lifecycle.state === "failed"
				? "failed"
				: "pending",
	change_id: null,
	operations_count: lifecycle.impactedItems.length,
	impacted_items: toWireImpactedItems(lifecycle),
	error_message: lifecycle.errorMessage ?? null,
});

/** The commit cards an assistant turn shows: run commits, else a legacy row. */
export const toCommitCards = (
	message: AiChatMessage,
	scope: AiSessionScope | null,
): RunCommitView[] => {
	if (Array.isArray(message.commits) && message.commits.length > 0) {
		return message.commits;
	}
	if (message.commitLifecycle) {
		return [
			legacyLifecycleToCommit(message.commitLifecycle, focusRoadmapId(scope)),
		];
	}
	return [];
};

const resolveRoadmapLabel = (
	commit: RunCommitView,
	scope: AiSessionScope | null,
): string => {
	const title = commit.roadmap_title?.trim();
	if (title) return title;
	if (scope?.kind === "roadmap" && commit.roadmap_id === scope.roadmapId) {
		return "This roadmap";
	}
	return "Roadmap";
};

export function AiCommitCard({ commit, scope, linkView }: AiCommitCardProps) {
	const isFocusRoadmap =
		scope?.kind === "roadmap" && commit.roadmap_id === scope.roadmapId;
	const projectId = toRouteProjectId(
		commit.project_id ?? (isFocusRoadmap ? scope.projectId : null),
	);
	const roadmapLabel = resolveRoadmapLabel(commit, scope);
	// Trace-shaped items carry titles; this step's `operations` backfill any
	// node the agent only referenced by id (same merge as the old panel).
	const impactedItems = mergeCommitImpactedItems(
		parseCommitImpactedItemsFromOperations(commit.operations ?? undefined),
		parseCommitImpactedItemsFromTraceDetails({
			impacted_items: commit.impacted_items ?? [],
		}),
	);
	const grouped = groupCommitImpactedItems(impactedItems);
	const canLink = commit.roadmap_id.length > 0;
	const chipSearch = (nodeId: string) =>
		isFocusRoadmap && linkView ? { nodeId, view: linkView } : { nodeId };

	return (
		<div
			className="mt-2 rounded-md border border-border bg-card px-2.5 py-2"
			data-testid="ai-commit-card"
			data-commit-status={commit.status}
		>
			<div className="flex items-center gap-1.5 text-[10px] font-semibold text-card-foreground">
				{commit.status === "pending" ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
				) : commit.status === "committed" ? (
					<Check className="h-3.5 w-3.5 text-primary" />
				) : commit.status === "skipped" ? (
					<MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />
				) : (
					<TriangleAlert className="h-3.5 w-3.5 text-destructive" />
				)}
				<span className="min-w-0 truncate">{roadmapLabel}</span>
				<span className="text-muted-foreground">·</span>
				<span className="font-medium text-muted-foreground">
					{getCommitStatusLabel(commit.status)}
				</span>
			</div>

			{commit.status === "failed" && (
				<p className="mt-1 text-[10px] text-destructive">
					{commit.error_message ??
						"The edit could not be applied to the roadmap. Rephrase the request and try again."}
				</p>
			)}

			{commit.status === "skipped" && (
				<p className="mt-1 text-[10px] text-muted-foreground">
					These changes were not applied. Ask Proyekto to apply them again.
				</p>
			)}

			{commit.status === "committed" && impactedItems.length > 0 && (
				<div className="mt-1.5 space-y-1.5">
					{COMMIT_IMPACT_KIND_ORDER.map((kind) => {
						const items = grouped[kind];
						if (!items.length) return null;
						return (
							<div key={`${commit.batch_id}-${kind}`}>
								<p className="text-[10px] font-medium text-card-foreground">
									{COMMIT_IMPACT_KIND_LABEL[kind]} ({items.length})
								</p>
								<div className="mt-1 flex flex-wrap gap-1">
									{items.map((item) => {
										const label =
											item.title ||
											`${item.nodeType} ${item.nodeId.slice(0, 8)}`;
										const chipClassName =
											"inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] text-primary transition-colors hover:border-primary/40 hover:bg-primary/15";
										const key = `${commit.batch_id}-${kind}-${item.nodeType}-${item.nodeId}`;
										if (!canLink) {
											return (
												<span key={key} className={chipClassName}>
													{label}
												</span>
											);
										}
										return (
											<Link
												key={key}
												to="/project/$projectId/roadmap/$roadmapId"
												params={{ projectId, roadmapId: commit.roadmap_id }}
												search={chipSearch(item.nodeId)}
												className={chipClassName}
											>
												{label}
											</Link>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

export default AiCommitCard;
