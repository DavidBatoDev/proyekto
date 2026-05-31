import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { projectKeys } from "@/queries/project";

/**
 * Subscribes to real-time postgres_changes for all roadmap tables and
 * invalidates the roadmapFull query on any change. No cursors or presence —
 * use useRoadmapCollaboration for the full canvas collaboration experience.
 */
export function useRoadmapDataSync(roadmapId: string) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!roadmapId) return;

		const invalidate = () =>
			void queryClient.invalidateQueries({
				queryKey: projectKeys.roadmapFull(roadmapId),
			});

		const channel = supabase
			.channel(`roadmap-data-sync:${roadmapId}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "roadmap_epics",
					filter: `roadmap_id=eq.${roadmapId}`,
				},
				invalidate,
			)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "roadmap_features",
					filter: `roadmap_id=eq.${roadmapId}`,
				},
				invalidate,
			)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "roadmap_milestones",
					filter: `roadmap_id=eq.${roadmapId}`,
				},
				invalidate,
			)
			// roadmap_tasks has no roadmap_id column — RLS scopes delivery to accessible rows
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "roadmap_tasks" },
				invalidate,
			)
			.subscribe();

		return () => {
			void supabase.removeChannel(channel);
		};
	}, [roadmapId, queryClient]);
}
