import { Link } from "@tanstack/react-router";
import {
	Check,
	Loader2,
	MinusCircle,
	Pencil,
	Plus,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import type {
	AgentCommitImpactedItem,
	RunCommitView,
} from "@/services/ai-agent.service";
import { AI_ENTITY_KIND_LABEL, AiEntityAvatars } from "./AiEntityChip";
import { AiMentionKindIcon } from "./AiMentionPicker";
import { useAiEntity } from "./aiEntityResolver";
import { AI_MENTION_CHIP_TONE_CLASS } from "./aiMentions";
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
import type {
	AiChatMessage,
	AiCommitImpactedItem,
	AiCommitImpactedItemKind,
	AiCommitLifecycle,
} from "./types";

// =============================================================================
// One card per roadmap commit inside a run (`RunCommitView`), rendered the way
// the entity chips are: a roadmap heading (glyph + title, linked), a status
// badge with the frozen labels (`Committed changes` / `Commit did not
// complete` / `Committing changes` — Playwright greps `/Committed changes/i`),
// and the impacted nodes grouped by impact. Each node is a chip with its kind
// glyph, title and (tasks) assignee avatars, deep-linking into the roadmap
// with the `"n"` project sentinel when the commit carries no project id, plus
// a muted note of what changed on it.
// =============================================================================

export type AiCommitLinkView = "roadmapView" | "timelineView";

export interface AiCommitCardProps {
	commit: RunCommitView;
	scope: AiSessionScope | null;
	/** Canvas view to open for chips of the focus roadmap (roadmap scope). */
	linkView?: AiCommitLinkView;
}

const LEGACY_BATCH_ID = "legacy-commit-lifecycle";

const CHIP_CLASS = `inline-flex max-w-full items-center gap-1 rounded px-1 py-px text-[11px] font-medium ${AI_MENTION_CHIP_TONE_CLASS.onSurface}`;
const LINK_CHIP_CLASS = `${CHIP_CLASS} underline-offset-2 hover:underline`;

const IMPACT_ICON: Record<
	AiCommitImpactedItemKind,
	typeof Plus | typeof Pencil | typeof Trash2
> = {
	created: Plus,
	modified: Pencil,
	deleted: Trash2,
};

/** Backend semantic change types (and the ones synthesized from operations). */
const CHANGE_LABEL: Record<string, string> = {
	NODE_ADDED: "Added",
	NODE_REMOVED: "Removed",
	NODE_MOVED: "Moved",
	NODE_UPDATED: "Updated",
	STATUS_CHANGED: "Status changed",
	TITLE_CHANGED: "Renamed",
	ASSIGNEE_CHANGED: "Assignees changed",
	DATE_CHANGED: "Dates changed",
	PRIORITY_CHANGED: "Priority changed",
	DESCRIPTION_CHANGED: "Description updated",
	TAGS_CHANGED: "Tags changed",
	DEPENDENCY_CHANGED: "Dependencies changed",
	DELIVERABLE_CHANGED: "Deliverable changed",
	COLOR_CHANGED: "Colour changed",
};

const STATUS_BADGE_CLASS: Record<RunCommitView["status"], string> = {
	committed: "border-primary/30 bg-primary/10 text-primary",
	pending: "border-border bg-muted/40 text-muted-foreground",
	failed: "border-destructive/30 bg-destructive/10 text-destructive",
	skipped: "border-border bg-muted/40 text-muted-foreground",
};

const humanize = (value: string): string =>
	value
		.trim()
		.replace(/[_-]+/g, " ")
		.toLowerCase()
		.replace(/\b\w/g, (letter) => letter.toUpperCase());

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

/**
 * What changed on a modified node, for the note beside its chip. Created and
 * deleted nodes sit under a group that already says so.
 */
export const describeCommitChange = (
	item: { kind: AiCommitImpactedItemKind; changeType?: string | null },
	resolvedStatus?: string | null,
): string | null => {
	if (item.kind !== "modified") return null;
	const changeType = item.changeType?.trim().toUpperCase();
	if (!changeType) return null;
	if (changeType === "STATUS_CHANGED" && resolvedStatus?.trim()) {
		return `Status → ${humanize(resolvedStatus)}`;
	}
	return CHANGE_LABEL[changeType] ?? humanize(changeType);
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
	resolvedTitle: string | null,
): string => {
	const title = commit.roadmap_title?.trim() || resolvedTitle?.trim();
	if (title) return title;
	if (scope?.kind === "roadmap" && commit.roadmap_id === scope.roadmapId) {
		return "This roadmap";
	}
	return "Roadmap";
};

type ChipSearch = { nodeId: string; view?: AiCommitLinkView };

interface CommitItemRowProps {
	item: AiCommitImpactedItem;
	roadmapId: string;
	projectId: string;
	canLink: boolean;
	search: (nodeId: string) => ChipSearch;
}

function CommitItemRow({
	item,
	roadmapId,
	projectId,
	canLink,
	search,
}: CommitItemRowProps) {
	// Tasks are the only nodes whose chip shows more than its title (assignee
	// avatars, the new status); a deleted node cannot be resolved any more.
	const resolvable =
		canLink && item.nodeType === "task" && item.kind !== "deleted";
	const { data } = useAiEntity(item.nodeType, item.nodeId, {
		enabled: resolvable,
	});
	const entity = data?.accessible ? data : undefined;
	const label =
		item.title ||
		entity?.title ||
		`${item.nodeType} ${item.nodeId.slice(0, 8)}`;
	const change = describeCommitChange(item, entity?.status);
	const kindLabel = AI_ENTITY_KIND_LABEL[item.nodeType];
	const tooltip = [
		kindLabel,
		entity?.status ? humanize(entity.status) : undefined,
	]
		.filter(Boolean)
		.join(" · ");
	const body = (
		<>
			<span aria-hidden="true" className="inline-flex shrink-0">
				<AiMentionKindIcon kind={item.nodeType} size={12} />
			</span>
			<span className="min-w-0 truncate">{label}</span>
			{item.nodeType === "task" && !!entity?.assignees?.length && (
				<AiEntityAvatars
					assignees={entity.assignees}
					count={entity.assignee_count}
				/>
			)}
		</>
	);
	const linkable = canLink && item.kind !== "deleted";
	return (
		<li
			className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
			data-testid="ai-commit-item"
			data-entity-kind={item.nodeType}
			data-entity-id={item.nodeId}
		>
			{linkable ? (
				<Link
					to="/project/$projectId/roadmap/$roadmapId"
					params={{ projectId, roadmapId }}
					search={item.nodeType === "roadmap" ? undefined : search(item.nodeId)}
					className={LINK_CHIP_CLASS}
					title={tooltip}
				>
					{body}
				</Link>
			) : (
				<span className={CHIP_CLASS} title={tooltip}>
					{body}
				</span>
			)}
			{change && (
				<span className="text-[10px] text-muted-foreground">{change}</span>
			)}
		</li>
	);
}

export function AiCommitCard({ commit, scope, linkView }: AiCommitCardProps) {
	const isFocusRoadmap =
		scope?.kind === "roadmap" && commit.roadmap_id === scope.roadmapId;
	// A commit the agent staged before it had loaded the roadmap (or one
	// persisted by an older agent) carries no title or project. The resolver
	// knows both, so the card never falls back to "Roadmap" and the `n`
	// sentinel while the real project is one lookup away.
	const needsAttribution =
		commit.roadmap_id.length > 0 &&
		(!commit.roadmap_title?.trim() || !commit.project_id);
	const { data: roadmapEntity } = useAiEntity("roadmap", commit.roadmap_id, {
		enabled: needsAttribution,
	});
	const resolved = roadmapEntity?.accessible ? roadmapEntity : undefined;
	const projectId = toRouteProjectId(
		commit.project_id ??
			resolved?.project_id ??
			(isFocusRoadmap ? scope.projectId : null),
	);
	const roadmapLabel = resolveRoadmapLabel(
		commit,
		scope,
		resolved?.title ?? null,
	);
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
	const chipSearch = (nodeId: string): ChipSearch =>
		isFocusRoadmap && linkView ? { nodeId, view: linkView } : { nodeId };

	const StatusIcon =
		commit.status === "pending"
			? Loader2
			: commit.status === "committed"
				? Check
				: commit.status === "skipped"
					? MinusCircle
					: TriangleAlert;
	const heading = (
		<>
			<span aria-hidden="true" className="inline-flex shrink-0">
				<AiMentionKindIcon kind="roadmap" size={12} />
			</span>
			<span className="min-w-0 truncate">{roadmapLabel}</span>
		</>
	);

	return (
		<div
			className="mt-2 rounded-md border border-border bg-card px-2.5 py-2"
			data-testid="ai-commit-card"
			data-commit-status={commit.status}
		>
			<div className="flex items-center gap-2">
				{canLink ? (
					<Link
						to="/project/$projectId/roadmap/$roadmapId"
						params={{ projectId, roadmapId: commit.roadmap_id }}
						className={`${LINK_CHIP_CLASS} min-w-0 text-xs`}
						title={AI_ENTITY_KIND_LABEL.roadmap}
					>
						{heading}
					</Link>
				) : (
					<span className={`${CHIP_CLASS} min-w-0 text-xs`}>{heading}</span>
				)}
				<span
					className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium ${STATUS_BADGE_CLASS[commit.status]}`}
					data-testid="ai-commit-status"
				>
					<StatusIcon
						className={`h-3 w-3 ${commit.status === "pending" ? "animate-spin" : ""}`}
						aria-hidden
					/>
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
				<ul className="mt-1.5 space-y-1.5">
					{COMMIT_IMPACT_KIND_ORDER.map((kind) => {
						const items = grouped[kind];
						if (!items.length) return null;
						const Icon = IMPACT_ICON[kind];
						return (
							<li key={`${commit.batch_id}-${kind}`}>
								<p className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
									<Icon className="h-3 w-3" aria-hidden />
									{COMMIT_IMPACT_KIND_LABEL[kind]} ({items.length})
								</p>
								<ul className="mt-1 space-y-1">
									{items.map((item) => (
										<CommitItemRow
											key={`${commit.batch_id}-${kind}-${item.nodeType}-${item.nodeId}`}
											item={item}
											roadmapId={commit.roadmap_id}
											projectId={projectId}
											canLink={canLink}
											search={chipSearch}
										/>
									))}
								</ul>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

export default AiCommitCard;
