import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { projectKeys } from "@/queries/project";
import type { Profile } from "@/types/profile.types";

const COLLAB_COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#06b6d4",
	"#6366f1",
	"#a855f7",
	"#ec4899",
];

export function collaborationColor(userId: string): string {
	let hash = 0;
	for (const c of userId) hash ^= c.charCodeAt(0);
	return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length]!;
}

export interface CollaboratorInfo {
	userId: string;
	name: string;
	avatarUrl: string | null;
	color: string;
}

export interface RemoteCursor {
	userId: string;
	name: string;
	color: string;
	/** Canvas (flow) coordinates — viewport-independent */
	x: number;
	y: number;
	expiresAt: number;
}

interface PresenceState {
	userId: string;
	name: string;
	avatarUrl: string | null;
	color: string;
}

interface CursorPayload {
	userId: string;
	name: string;
	color: string;
	x: number;
	y: number;
}

function resolveDisplayName(profile: Profile | null): string {
	if (!profile) return "Anonymous";
	if (profile.display_name) return profile.display_name;
	const full = [profile.first_name, profile.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return full || profile.email || "Anonymous";
}

interface UseRoadmapCollaborationOptions {
	roadmapId: string;
	userId: string | null | undefined;
	profile: Profile | null;
	isPanningCanvas: boolean;
}

export function useRoadmapCollaboration({
	roadmapId,
	userId,
	profile,
	isPanningCanvas,
}: UseRoadmapCollaborationOptions) {
	const queryClient = useQueryClient();
	const channelRef = useRef<RealtimeChannel | null>(null);
	const lastSentRef = useRef({ x: 0, y: 0, time: 0 });
	const isPanningRef = useRef(isPanningCanvas);
	const userIdRef = useRef(userId);
	const nameRef = useRef("");
	const colorRef = useRef("");

	const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
	const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);

	// Called by RoadmapCanvas after a local mutation completes so other viewers
	// get an immediate notification without waiting for postgres_changes.
	const broadcastDataChanged = useCallback(() => {
		const channel = channelRef.current;
		if (!channel || !userIdRef.current) return;
		void channel.send({
			type: "broadcast",
			event: "data_changed",
			payload: { from: userIdRef.current },
		});
	}, []);

	// Keep refs in sync without triggering re-subscribe
	useEffect(() => {
		isPanningRef.current = isPanningCanvas;
	}, [isPanningCanvas]);
	useEffect(() => {
		userIdRef.current = userId;
	}, [userId]);

	// Prune expired cursors (ghost prevention when user goes idle)
	useEffect(() => {
		const interval = setInterval(() => {
			const now = Date.now();
			setRemoteCursors((prev) => prev.filter((c) => c.expiresAt > now));
		}, 200);
		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		if (!userId || !roadmapId) return;

		const color = collaborationColor(userId);
		const name = resolveDisplayName(profile);
		const avatarUrl = profile?.avatar_url ?? null;

		nameRef.current = name;
		colorRef.current = color;

		const invalidate = () =>
			void queryClient.invalidateQueries({
				queryKey: projectKeys.roadmapFull(roadmapId),
			});

		const channel = supabase.channel(`roadmap-collab:${roadmapId}`, {
			config: { presence: { key: userId } },
		});
		channelRef.current = channel;

		channel
			.on("presence", { event: "sync" }, () => {
				const state = channel.presenceState<PresenceState>();
				const others: CollaboratorInfo[] = [];
				for (const [key, presences] of Object.entries(state)) {
					if (key === userId) continue;
					const p = presences[0];
					if (p) {
						others.push({
							userId: p.userId,
							name: p.name,
							avatarUrl: p.avatarUrl,
							color: p.color,
						});
					}
				}
				setCollaborators(others);
				// Remove cursors for users who left
				const activeIds = new Set(others.map((o) => o.userId));
				setRemoteCursors((prev) =>
					prev.filter((c) => activeIds.has(c.userId)),
				);
			})
			.on("broadcast", { event: "data_changed" }, ({ payload }) => {
				// Ignore our own broadcasts to avoid reflexive invalidation
				if (payload?.from === userId) return;
				invalidate();
			})
			.on<CursorPayload>("broadcast", { event: "cursor" }, ({ payload }) => {
				if (!payload || payload.userId === userId) return;

				setRemoteCursors((prev) => {
					const filtered = prev.filter((c) => c.userId !== payload.userId);
					return [
						...filtered,
						{
							userId: payload.userId,
							name: payload.name,
							color: payload.color,
							x: payload.x,
							y: payload.y,
							expiresAt: Date.now() + 3000,
						},
					];
				});
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
			.subscribe(async (status) => {
				if (status === "SUBSCRIBED") {
					await channel.track({
						userId,
						name,
						avatarUrl,
						color,
					} satisfies PresenceState);
				}
			});

		return () => {
			void supabase.removeChannel(channel);
			channelRef.current = null;
		};
	}, [roadmapId, userId, profile, queryClient]);

	const trackCursor = useCallback((canvasX: number, canvasY: number) => {
		const channel = channelRef.current;
		if (!channel) return;
		if (isPanningRef.current) return;
		if (document.visibilityState !== "visible") return;

		const now = Date.now();
		const last = lastSentRef.current;
		if (now - last.time < 100) return; // 100ms throttle

		const dx = canvasX - last.x;
		const dy = canvasY - last.y;
		if (dx * dx + dy * dy < 25) return; // skip if moved <5px

		lastSentRef.current = { x: canvasX, y: canvasY, time: now };

		void channel.send({
			type: "broadcast",
			event: "cursor",
			payload: {
				userId: userIdRef.current,
				name: nameRef.current,
				color: colorRef.current,
				x: canvasX,
				y: canvasY,
			},
		});
	}, []);

	return { collaborators, remoteCursors, trackCursor, broadcastDataChanged };
}
