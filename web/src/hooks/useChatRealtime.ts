import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { featureFlags } from "@/config/featureFlags";
import { isRealtimeConfigured, RealtimeRoom } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { chatKeys } from "@/queries/chat";

function chatOnDurableObjects(): boolean {
	return (
		featureFlags.realtimeChatTransport === "durable-objects" &&
		isRealtimeConfigured()
	);
}

type ChatInboxPayload = {
	kind?: "message" | "reaction" | "read";
	roomId?: string;
	projectId?: string | null;
};

/**
 * Durable Objects inbox: a single per-user socket that receives chat change
 * events for every room the user participates in (channels + DMs). The backend
 * publishes to each recipient's `user:{userId}` room, so there is no need to
 * subscribe per project or per DM room.
 */
function useChatInbox(currentUserId: string | undefined) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!currentUserId) return;

		const room = new RealtimeRoom(`user:${currentUserId}`);
		room.on("chat", (payload: ChatInboxPayload) => {
			const roomId = payload?.roomId ?? "";
			const projectId = payload?.projectId ?? null;

			if (payload?.kind !== "read" && roomId) {
				void queryClient.invalidateQueries({
					queryKey: chatKeys.roomMessages(roomId),
				});
			}
			if (projectId) {
				void queryClient.invalidateQueries({
					queryKey: chatKeys.rooms(projectId),
				});
			} else {
				void queryClient.invalidateQueries({ queryKey: chatKeys.dmRooms() });
			}
		});
		room.connect();

		return () => {
			room.close();
		};
	}, [currentUserId, queryClient]);
}

/**
 * Subscribes to per-project Supabase realtime channels for every project
 * passed in. Used by /inbox + project chat to keep the channel room list
 * and any open channel thread live.
 *
 * DM messages live in rows with `project_id IS NULL` and are handled
 * separately by `useDmRealtime` below.
 *
 * Under the Durable Objects transport this opens a single per-user inbox
 * socket instead (projectIds are unused); `useDmRealtime` becomes a no-op.
 */
export function useProjectsRealtime(
	projectIds: string[],
	currentUserId: string | undefined,
) {
	const queryClient = useQueryClient();
	const onDurableObjects = chatOnDurableObjects();

	// DO transport: one inbox socket covers channels + DMs.
	useChatInbox(onDurableObjects ? currentUserId : undefined);

	const key = projectIds.slice().sort().join(",");

	useEffect(() => {
		if (onDurableObjects) return;
		if (projectIds.length === 0) return;

		const channels = projectIds.flatMap((projectId) => {
			const messageChannel = supabase
				.channel(`chat-room-messages:${projectId}`)
				.on(
					"postgres_changes",
					{
						event: "*",
						schema: "public",
						table: "chat_room_messages",
						filter: `project_id=eq.${projectId}`,
					},
					(payload) => {
						const roomId = String(
							(
								(payload.new as { room_id?: string }) ??
								(payload.old as { room_id?: string }) ??
								{}
							).room_id ?? "",
						);
						void queryClient.invalidateQueries({
							queryKey: chatKeys.rooms(projectId),
						});
						if (roomId) {
							void queryClient.invalidateQueries({
								queryKey: chatKeys.roomMessages(roomId),
							});
						}
					},
				)
				.subscribe();

			const reactionChannel = supabase
				.channel(`chat-message-reactions:${projectId}`)
				.on(
					"postgres_changes",
					{
						event: "*",
						schema: "public",
						table: "chat_room_message_reactions",
						filter: `project_id=eq.${projectId}`,
					},
					(payload) => {
						const roomId = String(
							(
								(payload.new as { room_id?: string }) ??
								(payload.old as { room_id?: string }) ??
								{}
							).room_id ?? "",
						);
						if (roomId) {
							void queryClient.invalidateQueries({
								queryKey: chatKeys.roomMessages(roomId),
							});
						}
					},
				)
				.subscribe();

			const readPointerChannel = currentUserId
				? supabase
						.channel(`chat-room-read-pointers:${projectId}:${currentUserId}`)
						.on(
							"postgres_changes",
							{
								event: "UPDATE",
								schema: "public",
								table: "chat_room_participants",
								filter: `project_id=eq.${projectId}`,
							},
							(payload) => {
								const userId = String(
									((payload.new as { user_id?: string }) ?? {}).user_id ?? "",
								);
								if (!userId || userId !== currentUserId) return;
								void queryClient.invalidateQueries({
									queryKey: chatKeys.rooms(projectId),
								});
							},
						)
						.subscribe()
				: null;

			return readPointerChannel
				? [messageChannel, reactionChannel, readPointerChannel]
				: [messageChannel, reactionChannel];
		});

		return () => {
			for (const ch of channels) {
				void supabase.removeChannel(ch);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, currentUserId, queryClient, onDurableObjects]);
}

/**
 * Subscribes to realtime updates for the current user's global DM rooms.
 * Pass the list of DM room IDs the user belongs to; the hook attaches one
 * filtered subscription per room (chat_room_messages.room_id=eq.<id> and
 * chat_room_message_reactions.room_id=eq.<id>) and invalidates the DM room
 * list + per-room message cache when changes land.
 *
 * Under the Durable Objects transport this is a no-op — the per-user inbox
 * socket opened by `useProjectsRealtime` already covers DM rooms.
 */
export function useDmRealtime(
	dmRoomIds: string[],
	currentUserId: string | undefined,
) {
	const queryClient = useQueryClient();
	const onDurableObjects = chatOnDurableObjects();
	const key = dmRoomIds.slice().sort().join(",");

	useEffect(() => {
		if (onDurableObjects) return;
		if (dmRoomIds.length === 0) return;

		const channels = dmRoomIds.flatMap((roomId) => {
			const messageChannel = supabase
				.channel(`chat-dm-messages:${roomId}`)
				.on(
					"postgres_changes",
					{
						event: "*",
						schema: "public",
						table: "chat_room_messages",
						filter: `room_id=eq.${roomId}`,
					},
					() => {
						void queryClient.invalidateQueries({
							queryKey: chatKeys.dmRooms(),
						});
						void queryClient.invalidateQueries({
							queryKey: chatKeys.roomMessages(roomId),
						});
					},
				)
				.subscribe();

			const reactionChannel = supabase
				.channel(`chat-dm-reactions:${roomId}`)
				.on(
					"postgres_changes",
					{
						event: "*",
						schema: "public",
						table: "chat_room_message_reactions",
						filter: `room_id=eq.${roomId}`,
					},
					() => {
						void queryClient.invalidateQueries({
							queryKey: chatKeys.roomMessages(roomId),
						});
					},
				)
				.subscribe();

			const readChannel = currentUserId
				? supabase
						.channel(`chat-dm-read:${roomId}:${currentUserId}`)
						.on(
							"postgres_changes",
							{
								event: "UPDATE",
								schema: "public",
								table: "chat_room_participants",
								filter: `room_id=eq.${roomId}`,
							},
							(payload) => {
								const userId = String(
									((payload.new as { user_id?: string }) ?? {}).user_id ?? "",
								);
								if (!userId || userId !== currentUserId) return;
								void queryClient.invalidateQueries({
									queryKey: chatKeys.dmRooms(),
								});
							},
						)
						.subscribe()
				: null;

			return readChannel
				? [messageChannel, reactionChannel, readChannel]
				: [messageChannel, reactionChannel];
		});

		return () => {
			for (const ch of channels) {
				void supabase.removeChannel(ch);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, currentUserId, queryClient, onDurableObjects]);
}
