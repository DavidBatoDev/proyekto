import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDashboardProjectsQuery } from "@/hooks/useDashboardProjectsQuery";
import { roadmapsPreviewQueryOptions } from "@/hooks/useRoadmapsPreviewQuery";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { listMyTeams } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";
import {
	type AiMentionCandidate,
	buildAiMentionCandidates,
} from "./aiMentions";
import type { AiSessionScope } from "./scope";

export interface UseAiMentionCandidatesInput {
	scope: AiSessionScope | null;
	/**
	 * Focus roadmap + its nodes (built by the roadmap wrapper from the loaded
	 * tree). Renders instantly while the cross-roadmap lists load.
	 */
	primary?: readonly AiMentionCandidate[];
	/** The `@query` the composer reports; ignored while `active` is false. */
	query: string;
	/** Picker open. The lists are fetched only while it is. */
	active: boolean;
}

export interface UseAiMentionCandidatesResult {
	candidates: AiMentionCandidate[];
	/** True while any cross-roadmap list is still on its first fetch. */
	isLoading: boolean;
}

const EMPTY: never[] = [];

/**
 * Candidates for the composer's @-picker. The three lists reuse the
 * dashboard's caches (`["dashboard","projects",uid]`,
 * `["dashboard","roadmaps-preview",uid]`, `["teams","mine",uid]`) and are
 * enabled only while the picker is open, so the roadmap page never pays for
 * the preview payload until the first `@`. Guests (no user) get only the
 * `primary` list.
 */
export function useAiMentionCandidates({
	scope,
	primary,
	query,
	active,
}: UseAiMentionCandidatesInput): UseAiMentionCandidatesResult {
	const user = useUser();
	const userId = user?.id;
	const enabled = active && Boolean(userId);

	const projectsQuery = useDashboardProjectsQuery({ enabled: active });
	const roadmapsQuery = useQuery({
		...roadmapsPreviewQueryOptions(userId),
		enabled,
	});
	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", userId ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled,
		staleTime: 30_000,
	});

	const { workspace, workspaces } = useCurrentWorkspace();
	// In workspace scope the session's workspace is the "current" lane even if
	// the URL/store selection lags behind; in roadmap scope fall back to the
	// viewer's selection so shared roadmaps still sort after their own.
	const currentWorkspaceId =
		scope?.kind === "workspace" ? scope.workspaceId : (workspace?.id ?? null);
	const myWorkspaceIds = useMemo(
		() => workspaces.map((item) => item.id),
		[workspaces],
	);

	const projects = projectsQuery.data ?? EMPTY;
	const roadmaps = roadmapsQuery.data ?? EMPTY;
	const teams = teamsQuery.data ?? EMPTY;

	const candidates = useMemo(
		() =>
			active
				? buildAiMentionCandidates({
						query,
						primary,
						projects,
						roadmaps,
						teams,
						currentWorkspaceId,
						myWorkspaceIds,
					})
				: [],
		[
			active,
			query,
			primary,
			projects,
			roadmaps,
			teams,
			currentWorkspaceId,
			myWorkspaceIds,
		],
	);

	const isLoading =
		enabled &&
		(projectsQuery.isLoading ||
			roadmapsQuery.isLoading ||
			teamsQuery.isLoading);

	return { candidates, isLoading };
}
