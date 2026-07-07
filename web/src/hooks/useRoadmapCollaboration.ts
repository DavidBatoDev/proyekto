import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { featureFlags } from "@/config/featureFlags";
import { isRealtimeConfigured, RealtimeRoom } from "@/lib/realtime";
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
	return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length] ?? "#6366f1";
}

export interface CollaboratorInfo {
	userId: string;
	name: string;
	avatarUrl: string | null;
	color: string;
	/** Id of the epic/feature/task this collaborator currently has open, if any. */
	editingNodeId?: string | null;
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
	editingNodeId?: string | null;
}

interface CursorPayload {
	userId: string;
	name: string;
	color: string;
	x: number;
	y: number;
}

/** A live epic/feature drag by another collaborator (ephemeral preview). */
export interface RemoteDrag {
	nodeId: string;
	type: "epic" | "feature";
	sourceEpicId?: string;
	/** Dragged node's canvas (flow) coords; null until the first move arrives. */
	position: { x: number; y: number } | null;
	userId: string;
	color: string;
	expiresAt: number;
	/**
	 * Terminal phase. Set when the dragger releases:
	 *  - "commit": the reorder was persisted → settle peers to the new order.
	 *  - "cancel": released without committing (cancelled, no-op, or a confirm
	 *    is still pending) → peers revert to the committed/original order.
	 */
	ended?: "commit" | "cancel";
}

interface NodeDragStartPayload {
	nodeId: string;
	type: "epic" | "feature";
	sourceEpicId?: string;
	userId: string;
	color: string;
}
interface NodeDragPayload extends NodeDragStartPayload {
	x: number;
	y: number;
}
interface NodeDragEndPayload {
	nodeId: string;
	userId: string;
	/** Whether the drop was actually persisted (vs cancelled / pending confirm). */
	committed: boolean;
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

function roadmapOnDurableObjects(): boolean {
	return (
		featureFlags.realtimeRoadmapTransport === "durable-objects" &&
		isRealtimeConfigured()
	);
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
	const roomRef = useRef<RealtimeRoom | null>(null);
	const lastSentRef = useRef({ x: 0, y: 0, time: 0 });
	const nodeDragLastSentRef = useRef(0);
	const isPanningRef = useRef(isPanningCanvas);
	const userIdRef = useRef(userId);
	const nameRef = useRef("");
	const colorRef = useRef("");
	const avatarUrlRef = useRef<string | null>(null);
	// The node whose detail this user currently has open (epic/feature/task), or
	// null. Held in a ref so it survives the connection effect re-running (e.g. a
	// profile change) and is re-tracked on every (re)connect.
	const editingNodeIdRef = useRef<string | null>(null);
	// Mirrors `collaborators.length > 0` so the high-frequency senders can skip
	// broadcasting into an empty room (no one watching) — solo roadmap usage is
	// the common case and is the dominant realtime cost driver.
	const hasCollaboratorsRef = useRef(false);

	const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
	const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
	const [remoteDrag, setRemoteDrag] = useState<RemoteDrag | null>(null);

	// Called by RoadmapCanvas after a local mutation completes so other viewers
	// get an immediate notification without waiting for the backend publish.
	const broadcastDataChanged = useCallback(() => {
		if (!userIdRef.current) return;
		if (roadmapOnDurableObjects()) {
			roomRef.current?.send("data_changed", { from: userIdRef.current });
			return;
		}
		const channel = channelRef.current;
		if (!channel) return;
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
	useEffect(() => {
		hasCollaboratorsRef.current = collaborators.length > 0;
	}, [collaborators]);

	// Prune expired cursors + a stale drag (e.g. a dropped node_drag_end)
	useEffect(() => {
		const interval = setInterval(() => {
			const now = Date.now();
			setRemoteCursors((prev) => prev.filter((c) => c.expiresAt > now));
			setRemoteDrag((prev) => (prev && prev.expiresAt <= now ? null : prev));
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
		avatarUrlRef.current = avatarUrl;

		const invalidate = () =>
			void queryClient.invalidateQueries({
				queryKey: projectKeys.roadmapFull(roadmapId),
			});

		const applyPresence = (collaboratorsList: PresenceState[]) => {
			const others = collaboratorsList
				.filter((p) => p.userId !== userId)
				.map((p) => ({
					userId: p.userId,
					name: p.name,
					avatarUrl: p.avatarUrl,
					color: p.color,
					editingNodeId: p.editingNodeId ?? null,
				}));
			setCollaborators(others);
			// Remove cursors / drag preview for users who left
			const activeIds = new Set(others.map((o) => o.userId));
			setRemoteCursors((prev) => prev.filter((c) => activeIds.has(c.userId)));
			setRemoteDrag((prev) =>
				prev && !activeIds.has(prev.userId) ? null : prev,
			);
		};

		const applyCursor = (payload: CursorPayload | undefined) => {
			if (!featureFlags.realtimeCursors) return;
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
		};

		const DRAG_TTL = 5000;
		const applyNodeDragStart = (p: NodeDragStartPayload | undefined) => {
			if (!p || p.userId === userId) return;
			setRemoteDrag({
				nodeId: p.nodeId,
				type: p.type,
				sourceEpicId: p.sourceEpicId,
				position: null,
				userId: p.userId,
				color: p.color,
				expiresAt: Date.now() + DRAG_TTL,
			});
		};
		const applyNodeDrag = (p: NodeDragPayload | undefined) => {
			if (!p || p.userId === userId) return;
			setRemoteDrag({
				nodeId: p.nodeId,
				type: p.type,
				sourceEpicId: p.sourceEpicId,
				position: { x: p.x, y: p.y },
				userId: p.userId,
				color: p.color,
				expiresAt: Date.now() + DRAG_TTL,
			});
		};
		const applyNodeDragEnd = (p: NodeDragEndPayload | undefined) => {
			if (!p || p.userId === userId) return;
			// Mark the terminal phase; RoadmapView settles (commit) or reverts
			// (cancel) once, then it's pruned. Bumping expiresAt gives RoadmapView
			// a window to handle it before the prune nulls it.
			setRemoteDrag((prev) =>
				prev && prev.userId === p.userId
					? {
							...prev,
							ended: p.committed ? "commit" : "cancel",
							expiresAt: Date.now() + 3000,
						}
					: prev,
			);
		};

		// ── Durable Objects transport ──────────────────────────────────────────
		if (roadmapOnDurableObjects()) {
			const room = new RealtimeRoom(`roadmap:${roadmapId}`);
			roomRef.current = room;

			room
				.on("presence", (payload: { collaborators?: PresenceState[] }) => {
					applyPresence(payload?.collaborators ?? []);
				})
				.on("data_changed", (payload: { from?: string }) => {
					if (payload?.from === userId) return;
					invalidate();
				})
				.on("cursor", applyCursor)
				.on("node_drag_start", applyNodeDragStart)
				.on("node_drag", applyNodeDrag)
				.on("node_drag_end", applyNodeDragEnd);

			room.track({
				userId,
				name,
				avatarUrl,
				color,
				editingNodeId: editingNodeIdRef.current,
			} satisfies PresenceState);
			room.connect();

			return () => {
				room.close();
				roomRef.current = null;
			};
		}

		// ── Supabase Realtime transport (legacy) ─────────────────────────────────
		const channel = supabase.channel(`roadmap-collab:${roadmapId}`, {
			config: { presence: { key: userId } },
		});
		channelRef.current = channel;

		channel
			.on("presence", { event: "sync" }, () => {
				const state = channel.presenceState<PresenceState>();
				const others: PresenceState[] = [];
				for (const [key, presences] of Object.entries(state)) {
					if (key === userId) continue;
					const p = presences[0];
					if (p) others.push(p);
				}
				applyPresence(others);
			})
			.on("broadcast", { event: "data_changed" }, ({ payload }) => {
				// Ignore our own broadcasts to avoid reflexive invalidation
				if (payload?.from === userId) return;
				invalidate();
			})
			.on<CursorPayload>("broadcast", { event: "cursor" }, ({ payload }) => {
				applyCursor(payload);
			})
			.on<NodeDragStartPayload>(
				"broadcast",
				{ event: "node_drag_start" },
				({ payload }) => applyNodeDragStart(payload),
			)
			.on<NodeDragPayload>("broadcast", { event: "node_drag" }, ({ payload }) =>
				applyNodeDrag(payload),
			)
			.on<NodeDragEndPayload>(
				"broadcast",
				{ event: "node_drag_end" },
				({ payload }) => applyNodeDragEnd(payload),
			)
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
						editingNodeId: editingNodeIdRef.current,
					} satisfies PresenceState);
				}
			});

		return () => {
			void supabase.removeChannel(channel);
			channelRef.current = null;
		};
	}, [roadmapId, userId, profile, queryClient]);

	const trackCursor = useCallback((canvasX: number, canvasY: number) => {
		if (!featureFlags.realtimeCursors) return;
		// No one else is here — don't pay to broadcast into an empty room.
		if (!hasCollaboratorsRef.current) return;
		if (isPanningRef.current) return;
		if (document.visibilityState !== "visible") return;

		const now = Date.now();
		const last = lastSentRef.current;
		if (now - last.time < 100) return; // 100ms throttle

		const dx = canvasX - last.x;
		const dy = canvasY - last.y;
		if (dx * dx + dy * dy < 25) return; // skip if moved <5px

		lastSentRef.current = { x: canvasX, y: canvasY, time: now };

		const payload: CursorPayload = {
			userId: userIdRef.current ?? "",
			name: nameRef.current,
			color: colorRef.current,
			x: canvasX,
			y: canvasY,
		};

		if (roadmapOnDurableObjects()) {
			roomRef.current?.send("cursor", payload);
			return;
		}
		const channel = channelRef.current;
		if (!channel) return;
		void channel.send({ type: "broadcast", event: "cursor", payload });
	}, []);

	// Announce (or clear) which epic/feature/task detail this user has open by
	// folding `editingNodeId` into our presence and re-tracking. Peers render an
	// "editing" badge on the matching card. Carried in presence (not a one-off
	// event) so it survives reconnects, reaches late-joiners, and auto-clears on
	// disconnect via the room's presence rebroadcast.
	const setEditingNode = useCallback((nodeId: string | null) => {
		if (editingNodeIdRef.current === nodeId) return;
		editingNodeIdRef.current = nodeId;
		if (!userIdRef.current) return;
		const presence: PresenceState = {
			userId: userIdRef.current,
			name: nameRef.current,
			avatarUrl: avatarUrlRef.current,
			color: colorRef.current,
			editingNodeId: nodeId,
		};
		if (roadmapOnDurableObjects()) {
			roomRef.current?.track(presence);
			return;
		}
		void channelRef.current?.track(presence);
	}, []);

	// Transport-agnostic broadcast for the node-drag preview events.
	const sendBroadcast = useCallback((event: string, payload: unknown) => {
		if (roadmapOnDurableObjects()) {
			roomRef.current?.send(event, payload);
			return;
		}
		const channel = channelRef.current;
		if (!channel) return;
		void channel.send({ type: "broadcast", event, payload });
	}, []);

	const broadcastNodeDragStart = useCallback(
		(p: {
			nodeId: string;
			type: "epic" | "feature";
			sourceEpicId?: string;
		}) => {
			if (!userIdRef.current) return;
			if (!hasCollaboratorsRef.current) return;
			sendBroadcast("node_drag_start", {
				...p,
				userId: userIdRef.current,
				color: colorRef.current,
			});
		},
		[sendBroadcast],
	);

	const broadcastNodeDrag = useCallback(
		(p: {
			nodeId: string;
			type: "epic" | "feature";
			sourceEpicId?: string;
			x: number;
			y: number;
		}) => {
			if (!userIdRef.current) return;
			if (!hasCollaboratorsRef.current) return;
			const now = Date.now();
			// ~40Hz. Edges anchor to node positions instantly (no CSS transform
			// transition — that desyncs edges), so the send rate alone drives
			// smoothness; 40Hz keeps motion fluid while staying lightweight.
			if (now - nodeDragLastSentRef.current < 25) return;
			nodeDragLastSentRef.current = now;
			sendBroadcast("node_drag", {
				...p,
				userId: userIdRef.current,
				color: colorRef.current,
			});
		},
		[sendBroadcast],
	);

	const broadcastNodeDragEnd = useCallback(
		(nodeId: string, committed: boolean) => {
			if (!userIdRef.current) return;
			if (!hasCollaboratorsRef.current) return;
			nodeDragLastSentRef.current = 0; // let the next drag's first frame through
			sendBroadcast("node_drag_end", {
				nodeId,
				userId: userIdRef.current,
				committed,
			});
		},
		[sendBroadcast],
	);

	const hasCollaborators = collaborators.length > 0;
	const shouldTrackCursors = featureFlags.realtimeCursors && hasCollaborators;

	return {
		collaborators,
		remoteCursors,
		remoteDrag,
		hasCollaborators,
		shouldTrackCursors,
		trackCursor,
		setEditingNode,
		broadcastDataChanged,
		broadcastNodeDragStart,
		broadcastNodeDrag,
		broadcastNodeDragEnd,
	};
}
