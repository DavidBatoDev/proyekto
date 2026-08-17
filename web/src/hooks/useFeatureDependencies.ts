import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/queries/project";
import { featureDependencyService } from "@/services/roadmap.service";
import type { FeatureDependency, FeatureDependencyType } from "@/types/roadmap";

/**
 * Feature dependencies live in TanStack Query rather than roadmapStore.
 *
 * The store is tree-shaped (epics[].features[].tasks[]) and every helper walks
 * that tree; an edge belongs to two arbitrary features and to neither subtree.
 * This is also a roadmap-scoped collection the Timeline reads whole, which is
 * exactly what the query layer already models for roadmapFull.
 */
export function useFeatureDependenciesQuery(roadmapId: string | undefined) {
	return useQuery({
		queryKey: projectKeys.featureDependencies(roadmapId ?? ""),
		queryFn: () => featureDependencyService.listByRoadmap(roadmapId as string),
		enabled: Boolean(roadmapId),
		staleTime: 30_000,
	});
}

interface CreateVariables {
	blockingFeatureId: string;
	blockedFeatureId: string;
	dependencyType?: FeatureDependencyType;
}

/**
 * Optimistic create. Mirrors roadmapStore's snapshot -> optimistic -> rollback
 * discipline, in the TanStack idiom. The temp id uses the store's `temp-`
 * convention so anything keying off it behaves consistently.
 */
export function useAddFeatureDependency(roadmapId: string | undefined) {
	const queryClient = useQueryClient();
	const key = projectKeys.featureDependencies(roadmapId ?? "");

	return useMutation({
		mutationFn: (variables: CreateVariables) =>
			featureDependencyService.create(roadmapId as string, {
				blocking_feature_id: variables.blockingFeatureId,
				blocked_feature_id: variables.blockedFeatureId,
				dependency_type: variables.dependencyType ?? "FS",
			}),
		onMutate: async (variables) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<FeatureDependency[]>(key);

			const optimistic: FeatureDependency = {
				id: `temp-${variables.blockingFeatureId}-${variables.blockedFeatureId}`,
				roadmap_id: roadmapId ?? "",
				blocking_feature_id: variables.blockingFeatureId,
				blocked_feature_id: variables.blockedFeatureId,
				dependency_type: variables.dependencyType ?? "FS",
				lag_days: 0,
				created_at: new Date().toISOString(),
			};
			queryClient.setQueryData<FeatureDependency[]>(key, (current) => [
				...(current ?? []),
				optimistic,
			]);

			return { previous };
		},
		onError: (_error, _variables, context) => {
			if (context?.previous) queryClient.setQueryData(key, context.previous);
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: key });
		},
	});
}

export function useRemoveFeatureDependency(roadmapId: string | undefined) {
	const queryClient = useQueryClient();
	const key = projectKeys.featureDependencies(roadmapId ?? "");

	return useMutation({
		mutationFn: (dependencyId: string) =>
			featureDependencyService.remove(roadmapId as string, dependencyId),
		onMutate: async (dependencyId) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<FeatureDependency[]>(key);
			queryClient.setQueryData<FeatureDependency[]>(key, (current) =>
				(current ?? []).filter((edge) => edge.id !== dependencyId),
			);
			return { previous };
		},
		onError: (_error, _dependencyId, context) => {
			if (context?.previous) queryClient.setQueryData(key, context.previous);
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: key });
		},
	});
}
