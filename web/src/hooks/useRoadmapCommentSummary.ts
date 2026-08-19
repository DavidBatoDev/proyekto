import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { featureFlags } from "@/config/featureFlags";
import { projectKeys } from "@/queries/project";
import { roadmapCommentSummaryService } from "@/services/roadmap.service";
import type {
	Comment,
	CommentSummaryNodeType,
	NodeCommentSummary,
} from "@/types/roadmap";

/**
 * Comment counts and previews for every node on the roadmap canvas.
 *
 * Lives in TanStack Query rather than roadmapStore for the same reason feature
 * dependencies do: this is a roadmap-scoped collection read whole, and the
 * store is tree-shaped (epics[].features[].tasks[]) so every write to it
 * re-derives node data for EVERY card on the canvas. The previous approach —
 * a `comment_count` field patched into the epics tree — paid exactly that cost
 * on every comment mutation, and still only ever populated for a task whose
 * Comments tab the user had already opened.
 */
export function useRoadmapCommentSummaryQuery(roadmapId: string | undefined) {
	return useQuery({
		queryKey: projectKeys.roadmapCommentSummary(roadmapId ?? ""),
		queryFn: () =>
			roadmapCommentSummaryService.listByRoadmap(roadmapId as string),
		enabled: Boolean(roadmapId) && featureFlags.canvasCommentIndicators,
		staleTime: 30_000,
	});
}

/**
 * Node id -> summary, the same shape `editorsByNodeId` uses so widgets can look
 * their own entry up by id without walking a list.
 */
export function useCommentSummaryByNodeId(
	roadmapId: string | undefined,
): Map<string, NodeCommentSummary> {
	const { data } = useRoadmapCommentSummaryQuery(roadmapId);
	return useMemo(() => {
		const map = new Map<string, NodeCommentSummary>();
		for (const row of data ?? []) map.set(row.node_id, row);
		return map;
	}, [data]);
}

const emptySummary = (
	nodeId: string,
	nodeType: CommentSummaryNodeType,
): NodeCommentSummary => ({
	node_type: nodeType,
	node_id: nodeId,
	comment_count: 0,
	last_comment: null,
});

/**
 * Optimistically move a node's count, and optionally its preview.
 *
 * `preview: undefined` means "unknown" rather than "none" — used on delete,
 * where the removed comment may have been the preview and the one before it is
 * not in hand. Rendering a count with no preview line for one round-trip is
 * honest; guessing would show a comment that is not actually the latest.
 *
 * Returns the previous cache value so the caller can roll back.
 */
export function applyCommentSummaryDelta(
	queryClient: QueryClient,
	roadmapId: string | undefined,
	nodeId: string,
	nodeType: CommentSummaryNodeType,
	change: {
		countDelta?: number;
		preview?: NodeCommentSummary["last_comment"] | undefined;
		clearPreview?: boolean;
	},
): NodeCommentSummary[] | undefined {
	if (!roadmapId) return undefined;
	const key = projectKeys.roadmapCommentSummary(roadmapId);
	const previous = queryClient.getQueryData<NodeCommentSummary[]>(key);
	if (!previous) return undefined;

	const index = previous.findIndex((row) => row.node_id === nodeId);
	const current = index >= 0 ? previous[index] : emptySummary(nodeId, nodeType);

	const next: NodeCommentSummary = {
		...current,
		comment_count: Math.max(
			0,
			current.comment_count + (change.countDelta ?? 0),
		),
		last_comment: change.clearPreview
			? null
			: change.preview !== undefined
				? change.preview
				: current.last_comment,
	};

	const rows = index >= 0 ? [...previous] : [...previous, next];
	if (index >= 0) rows[index] = next;
	queryClient.setQueryData(key, rows);
	return previous;
}

/**
 * Reconcile from an authoritative comment list — i.e. the fetch a panel or
 * modal already performs when it opens. Heals any drift the optimistic path
 * left behind, and is why a stale count never survives opening the thread.
 *
 * `CommentsSection` renders oldest -> newest, so the LAST entry is the latest.
 */
export function applyCommentSummaryAuthoritative(
	queryClient: QueryClient,
	roadmapId: string | undefined,
	nodeId: string,
	nodeType: CommentSummaryNodeType,
	comments: Comment[],
): void {
	if (!roadmapId) return;
	const key = projectKeys.roadmapCommentSummary(roadmapId);
	const previous = queryClient.getQueryData<NodeCommentSummary[]>(key);
	if (!previous) return;

	const latest = comments.length ? comments[comments.length - 1] : null;
	const next: NodeCommentSummary = {
		node_type: nodeType,
		node_id: nodeId,
		comment_count: comments.length,
		last_comment: latest
			? {
					id: latest.id,
					created_at: latest.created_at,
					author_id: latest.author_id ?? latest.user_id ?? null,
					author_name: latest.user?.display_name ?? null,
					excerpt: htmlToPlainExcerpt(latest.content),
				}
			: null,
	};

	const index = previous.findIndex((row) => row.node_id === nodeId);
	const rows = index >= 0 ? [...previous] : [...previous, next];
	if (index >= 0) rows[index] = next;
	queryClient.setQueryData(key, rows);
}

/**
 * Client-side mirror of the server's excerpt rule, used only for optimistic
 * previews. The trailing-partial-tag strip matters for the same reason it does
 * server-side: a tag cut mid-way is not matched by the tag regex and would
 * otherwise show as visible markup.
 */
export function htmlToPlainExcerpt(html: string, maxChars = 140): string {
	const text = html
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<[^>]*$/, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > maxChars ? `${text.slice(0, maxChars).trim()}…` : text;
}

/** Bound helpers for a single roadmap, so callers do not thread the client. */
export function useCommentSummaryUpdaters(roadmapId: string | undefined) {
	const queryClient = useQueryClient();

	const applyDelta = useCallback(
		(
			nodeId: string,
			nodeType: CommentSummaryNodeType,
			change: Parameters<typeof applyCommentSummaryDelta>[4],
		) =>
			applyCommentSummaryDelta(
				queryClient,
				roadmapId,
				nodeId,
				nodeType,
				change,
			),
		[queryClient, roadmapId],
	);

	const applyAuthoritative = useCallback(
		(nodeId: string, nodeType: CommentSummaryNodeType, comments: Comment[]) =>
			applyCommentSummaryAuthoritative(
				queryClient,
				roadmapId,
				nodeId,
				nodeType,
				comments,
			),
		[queryClient, roadmapId],
	);

	const restore = useCallback(
		(snapshot: NodeCommentSummary[] | undefined) => {
			if (!roadmapId || !snapshot) return;
			queryClient.setQueryData(
				projectKeys.roadmapCommentSummary(roadmapId),
				snapshot,
			);
		},
		[queryClient, roadmapId],
	);

	return { applyDelta, applyAuthoritative, restore };
}
