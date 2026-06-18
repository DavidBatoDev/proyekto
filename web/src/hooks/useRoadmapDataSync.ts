import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { featureFlags } from "@/config/featureFlags";
import { isRealtimeConfigured, RealtimeRoom } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { projectKeys } from "@/queries/project";

function roadmapOnDurableObjects(): boolean {
	return (
		featureFlags.realtimeRoadmapTransport === "durable-objects" &&
		isRealtimeConfigured()
	);
}

/**
 * Subscribes to real-time updates for all roadmap tables and invalidates the
 * roadmapFull query on any change. No cursors or presence — use
 * useRoadmapCollaboration for the full canvas experience.
 *
 * Uses the same channel/room name as useRoadmapCollaboration so that broadcast
 * data_changed events sent from the canvas view are received here too, and
 * vice-versa.
 */
export function useRoadmapDataSync(roadmapId: string, selfUserId?: string) {
	const queryClient = useQueryClient();
	const channelRef = useRef<RealtimeChannel | null>(null);
	const roomRef = useRef<RealtimeRoom | null>(null);

	const broadcastDataChanged = useCallback(() => {
		if (!selfUserId) return;
		if (roadmapOnDurableObjects()) {
			roomRef.current?.send("data_changed", { from: selfUserId });
			return;
		}
		const channel = channelRef.current;
		if (!channel) return;
		void channel.send({
			type: "broadcast",
			event: "data_changed",
			payload: { from: selfUserId },
		});
	}, [selfUserId]);

	useEffect(() => {
		if (!roadmapId) return;

		const invalidate = () =>
			void queryClient.invalidateQueries({
				queryKey: projectKeys.roadmapFull(roadmapId),
			});

		// ── Durable Objects transport ──────────────────────────────────────────
		if (roadmapOnDurableObjects()) {
			const room = new RealtimeRoom(`roadmap:${roadmapId}`);
			roomRef.current = room;
			room.on("data_changed", (payload: { from?: string }) => {
				if (payload?.from === selfUserId) return;
				invalidate();
			});
			room.connect();
			return () => {
				room.close();
				roomRef.current = null;
			};
		}

		// ── Supabase Realtime transport (legacy) ─────────────────────────────────
		// Same channel name as useRoadmapCollaboration so broadcast events
		// cross between the canvas view and the work-items view.
		const channel = supabase
			.channel(`roadmap-collab:${roadmapId}`)
			.on("broadcast", { event: "data_changed" }, ({ payload }) => {
				if (payload?.from === selfUserId) return;
				invalidate();
			})
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

		channelRef.current = channel;

		return () => {
			void supabase.removeChannel(channel);
			channelRef.current = null;
		};
	}, [roadmapId, selfUserId, queryClient]);

	return { broadcastDataChanged };
}
