import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { chatKeys } from "@/queries/chat";

/**
 * Subscribes to per-project Supabase realtime channels for every project
 * passed in. Used by /inbox to keep the cross-project room list and any
 * open thread live.
 *
 * Three channels per project:
 *   chat-room-messages:<projectId>           — new/updated/deleted messages
 *   chat-message-reactions:<projectId>       — reaction add/remove
 *   chat-room-read-pointers:<projectId>:<u>  — current user's read pointer
 *
 * Each handler invalidates the matching `chatKeys` cache so React Query
 * refetches the affected slice.
 */
export function useProjectsRealtime(
	projectIds: string[],
	currentUserId: string | undefined,
) {
	const queryClient = useQueryClient();

	// Stable signature so we don't tear down + resubscribe on every render
	// when the array reference changes but the contents don't.
	const key = projectIds.slice().sort().join(",");

	useEffect(() => {
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
								queryKey: chatKeys.roomMessages(projectId, roomId),
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
								queryKey: chatKeys.roomMessages(projectId, roomId),
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
		// `key` is the stable serialization; deliberately not depending on
		// the projectIds array reference itself.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, currentUserId, queryClient]);
}
