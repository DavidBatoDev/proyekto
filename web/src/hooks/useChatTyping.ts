import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { featureFlags } from "@/config/featureFlags";
import { isRealtimeConfigured, RealtimeRoom } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";

type TypingUser = {
	userId: string;
	name: string;
	at: number;
};

type TypingPayload = {
	roomId?: string;
	userId?: string;
	name?: string;
	typing?: boolean;
	at?: number;
};

const TYPING_IDLE_MS = 2200;
const TYPING_STALE_MS = 5000;

function chatOnDurableObjects(): boolean {
	return (
		featureFlags.realtimeChatTransport === "durable-objects" &&
		isRealtimeConfigured()
	);
}

export function useChatTyping({
	projectId,
	roomId,
	userId,
	displayName,
}: {
	projectId: string;
	roomId: string | null;
	userId?: string;
	displayName?: string;
}) {
	const [typingUsers, setTypingUsers] = useState<Record<string, TypingUser>>(
		{},
	);
	const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
		null,
	);
	const roomRef = useRef<RealtimeRoom | null>(null);
	const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isTypingRef = useRef(false);

	useEffect(() => {
		setTypingUsers({});
	}, [roomId]);

	useEffect(() => {
		if (!projectId || !roomId || !userId) {
			if (typingChannelRef.current) {
				void supabase.removeChannel(typingChannelRef.current);
				typingChannelRef.current = null;
			}
			if (roomRef.current) {
				roomRef.current.close();
				roomRef.current = null;
			}
			return;
		}

		const handleTyping = (incoming: TypingPayload) => {
			if (
				!incoming?.userId ||
				incoming.userId === userId ||
				incoming.roomId !== roomId
			) {
				return;
			}

			if (incoming.typing) {
				setTypingUsers((prev) => ({
					...prev,
					[incoming.userId as string]: {
						userId: incoming.userId as string,
						name: incoming.name || "Someone",
						at: incoming.at || Date.now(),
					},
				}));
			} else {
				setTypingUsers((prev) => {
					const next = { ...prev };
					delete next[incoming.userId as string];
					return next;
				});
			}
		};

		// ── Durable Objects transport ──────────────────────────────────────────
		if (chatOnDurableObjects()) {
			const room = new RealtimeRoom(`chatroom:${roomId}`);
			roomRef.current = room;
			room.on("typing", handleTyping);
			room.connect();

			return () => {
				if (idleTimeoutRef.current) {
					clearTimeout(idleTimeoutRef.current);
					idleTimeoutRef.current = null;
				}
				isTypingRef.current = false;
				setTypingUsers({});
				room.close();
				roomRef.current = null;
			};
		}

		// ── Supabase Realtime transport (legacy) ─────────────────────────────────
		const channel = supabase
			.channel(`chat-typing:${projectId}:${roomId}`, {
				config: { broadcast: { self: false } },
			})
			.on("broadcast", { event: "typing" }, ({ payload }) => {
				handleTyping(payload as TypingPayload);
			})
			.subscribe();

		typingChannelRef.current = channel;

		return () => {
			if (idleTimeoutRef.current) {
				clearTimeout(idleTimeoutRef.current);
				idleTimeoutRef.current = null;
			}
			isTypingRef.current = false;
			setTypingUsers({});
			void supabase.removeChannel(channel);
			typingChannelRef.current = null;
		};
	}, [projectId, roomId, userId]);

	useEffect(() => {
		const interval = setInterval(() => {
			setTypingUsers((prev) => {
				const now = Date.now();
				const next: Record<string, TypingUser> = {};
				for (const [key, value] of Object.entries(prev)) {
					if (now - value.at <= TYPING_STALE_MS) {
						next[key] = value;
					}
				}
				return next;
			});
		}, 900);

		return () => clearInterval(interval);
	}, []);

	const emitTyping = useCallback(
		async (typing: boolean) => {
			if (!roomId || !userId) return;
			const payload: TypingPayload = {
				roomId,
				userId,
				name: displayName || "Someone",
				typing,
				at: Date.now(),
			};

			if (chatOnDurableObjects()) {
				roomRef.current?.send("typing", payload);
				return;
			}
			const channel = typingChannelRef.current;
			if (!channel) return;
			await channel.send({ type: "broadcast", event: "typing", payload });
		},
		[displayName, roomId, userId],
	);

	const startTyping = useCallback(async () => {
		if (!roomId || !userId) return;
		if (!isTypingRef.current) {
			isTypingRef.current = true;
			await emitTyping(true);
		}

		if (idleTimeoutRef.current) {
			clearTimeout(idleTimeoutRef.current);
		}
		idleTimeoutRef.current = setTimeout(async () => {
			if (!isTypingRef.current) return;
			isTypingRef.current = false;
			await emitTyping(false);
		}, TYPING_IDLE_MS);
	}, [emitTyping, roomId, userId]);

	const stopTyping = useCallback(async () => {
		if (idleTimeoutRef.current) {
			clearTimeout(idleTimeoutRef.current);
			idleTimeoutRef.current = null;
		}
		if (!isTypingRef.current) return;
		isTypingRef.current = false;
		await emitTyping(false);
	}, [emitTyping]);

	const typingNames = useMemo(
		() => Object.values(typingUsers).map((user) => user.name),
		[typingUsers],
	);

	return {
		typingNames,
		startTyping,
		stopTyping,
	};
}
