import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Hash, Inbox, MessageSquare, PanelRight } from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useAuthStore, useProfile, useUser } from "@/stores/authStore";
import { DashboardShell } from "@/components/layout/DashboardShell";
import {
	type Project,
	projectService,
} from "@/services/project.service";
import { chatKeys, fetchProjectChatRooms } from "@/queries/chat";
import {
	flattenRoomMessages,
	useDeleteChatMessageMutation,
	useMarkRoomReadMutation,
	useRoomMessagesQuery,
	useSendChatMessageMutation,
	useToggleChatReactionMutation,
} from "@/hooks/useChatQueries";
import { useChatTyping } from "@/hooks/useChatTyping";
import { useProjectsRealtime } from "@/hooks/useChatRealtime";
import type { ChatRoom } from "@/services/chat.service";
import {
	mergeThreadMessages,
	type ThreadSender,
	type ThreadUiMessage,
} from "@/components/project/chat/thread";
import {
	ChatComposer,
	ChatProfilePanel,
	ChatUnsendConfirmModal,
	MessageList,
	TypingIndicator,
} from "@/components/project/chat";
import type { ChatMemberProfilePreview } from "@/components/project/chat/ChatMemberProfileCard";

export const Route = createFileRoute("/inbox")({
	validateSearch: (search) => ({
		p: typeof search.p === "string" ? search.p : undefined,
		r: typeof search.r === "string" ? search.r : undefined,
	}),
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: InboxPage,
});

// ─── Types ─────────────────────────────────────────────────────────────────

type InboxEntry = {
	room: ChatRoom;
	project: Project;
	hasUnread: boolean;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function hasUnreadForRoom(room: ChatRoom, userId?: string): boolean {
	if (!userId) return false;
	if (typeof room.has_unread === "boolean") return room.has_unread;
	const last = room.last_message;
	if (!last) return false;
	const viewerLastReadAt =
		room.viewer_last_read_at ??
		room.participants.find((p) => p.user_id === userId)?.last_read_at ??
		null;
	if (!viewerLastReadAt) return last.sender_id !== userId;
	return (
		new Date(last.created_at).getTime() >
		new Date(viewerLastReadAt).getTime()
	);
}

function getRoomTitle(room: ChatRoom, currentUserId?: string): string {
	if (room.type === "channel") {
		return room.name ?? `#${room.slug}`;
	}
	const counterpart =
		room.counterpart ??
		room.participants.find((p) => p.user_id !== currentUserId);
	return (
		counterpart?.user?.display_name ??
		counterpart?.user?.email ??
		"Direct message"
	);
}

function formatTimestamp(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const now = new Date();
	const sameDay =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate();
	if (sameDay) {
		return d.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
		});
	}
	const dayMs = 1000 * 60 * 60 * 24;
	const diffDays = Math.floor((now.getTime() - d.getTime()) / dayMs);
	if (diffDays < 7) {
		return d.toLocaleDateString(undefined, { weekday: "short" });
	}
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Page ──────────────────────────────────────────────────────────────────

function InboxPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const user = useUser();
	const queryClient = useQueryClient();

	// Cross-project: fetch all dashboard projects, then fan-out to chat rooms.
	const projectsQuery = useQueries({
		queries: [
			{
				queryKey: ["dashboard", "projects", user?.id ?? "anonymous"] as const,
				queryFn: () => projectService.listDashboardProjects(),
				enabled: Boolean(user?.id),
				staleTime: 30 * 1000,
			},
		],
	})[0];
	const projects = (projectsQuery.data as Project[] | undefined) ?? [];

	const roomQueries = useQueries({
		queries: projects.map((project) => ({
			queryKey: chatKeys.rooms(project.id),
			queryFn: () => fetchProjectChatRooms(project.id),
			enabled: Boolean(user?.id),
			staleTime: 15 * 1000,
			refetchOnWindowFocus: true,
		})),
	});

	// Live updates across every project the user belongs to. Subscribes to
	// chat-room-messages, chat-message-reactions, chat-room-read-pointers
	// per project; handlers invalidate the matching React Query keys.
	const projectIds = useMemo(
		() => projects.map((p) => p.id),
		[projects],
	);
	useProjectsRealtime(projectIds, user?.id);

	const isLoading =
		projectsQuery.isPending || roomQueries.some((q) => q.isPending);

	const entries: InboxEntry[] = useMemo(() => {
		const out: InboxEntry[] = [];
		for (let i = 0; i < projects.length; i++) {
			const project = projects[i];
			const rooms = roomQueries[i]?.data ?? [];
			for (const room of rooms) {
				out.push({
					room,
					project,
					hasUnread: hasUnreadForRoom(room, user?.id),
				});
			}
		}
		out.sort((a, b) => {
			const ta = a.room.last_message?.created_at ?? a.room.updated_at;
			const tb = b.room.last_message?.created_at ?? b.room.updated_at;
			return new Date(tb).getTime() - new Date(ta).getTime();
		});
		return out;
	}, [projects, roomQueries, user?.id]);

	// Resolve selection: explicit ?p=&r=, otherwise first entry.
	const selectedEntry = useMemo<InboxEntry | null>(() => {
		if (search.p && search.r) {
			return (
				entries.find(
					(e) => e.project.id === search.p && e.room.id === search.r,
				) ?? null
			);
		}
		return entries[0] ?? null;
	}, [entries, search.p, search.r]);

	const handleSelect = useCallback(
		(entry: InboxEntry) => {
			navigate({
				to: "/inbox",
				search: { p: entry.project.id, r: entry.room.id },
				replace: true,
			});
		},
		[navigate],
	);

	const [showUnreadOnly, setShowUnreadOnly] = useState(false);
	const visibleEntries = showUnreadOnly
		? entries.filter((e) => e.hasUnread)
		: entries;
	const unreadCount = entries.filter((e) => e.hasUnread).length;

	return (
		<DashboardShell>
			<div className="h-[calc(100vh-3.5rem)] px-4 py-4 sm:px-6 lg:px-8">
				<div className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
					{/* Left rail: room list across all projects */}
					<aside className="hidden md:flex w-[340px] shrink-0 flex-col border-r border-slate-200 bg-white">
						<div className="border-b border-slate-200 px-4 py-3">
							<div className="flex items-center justify-between">
								<h1 className="text-base font-semibold text-slate-900">
									Inbox
								</h1>
								{unreadCount > 0 && (
									<span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
										{unreadCount} unread
									</span>
								)}
							</div>
							<button
								type="button"
								onClick={() => setShowUnreadOnly((v) => !v)}
								className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
									showUnreadOnly
										? "bg-slate-900 text-white"
										: "bg-slate-100 text-slate-600 hover:bg-slate-200"
								}`}
							>
								{showUnreadOnly ? "Showing unread" : "Show unread only"}
							</button>
						</div>

						<div className="flex-1 overflow-y-auto">
							{isLoading ? (
								<InboxListSkeleton />
							) : visibleEntries.length === 0 ? (
								<EmptyState
									title={
										showUnreadOnly ? "No unread messages" : "No messages yet"
									}
									description={
										showUnreadOnly
											? "You're all caught up."
											: "When someone messages you on a project, it'll appear here."
									}
								/>
							) : (
								<ul className="divide-y divide-slate-100">
									{visibleEntries.map((entry) => (
										<InboxRow
											key={`${entry.project.id}:${entry.room.id}`}
											entry={entry}
											isSelected={
												selectedEntry?.room.id === entry.room.id &&
												selectedEntry?.project.id === entry.project.id
											}
											onSelect={() => handleSelect(entry)}
											currentUserId={user?.id}
										/>
									))}
								</ul>
							)}
						</div>
					</aside>

					{/* Right pane: selected thread */}
					<section className="flex min-w-0 flex-1 flex-col bg-white">
						{selectedEntry ? (
							<InboxThread
								key={`${selectedEntry.project.id}:${selectedEntry.room.id}`}
								entry={selectedEntry}
								currentUserId={user?.id}
								onAfterSend={() => {
									void queryClient.invalidateQueries({
										queryKey: chatKeys.rooms(selectedEntry.project.id),
									});
								}}
							/>
						) : (
							<div className="flex flex-1 items-center justify-center px-6">
								<EmptyState
									title="Select a conversation"
									description="Pick a thread from the left to read or reply."
								/>
							</div>
						)}
					</section>
				</div>
			</div>
		</DashboardShell>
	);
}

// ─── Inbox row (left rail) ──────────────────────────────────────────────────

function InboxRow({
	entry,
	isSelected,
	onSelect,
	currentUserId,
}: {
	entry: InboxEntry;
	isSelected: boolean;
	onSelect: () => void;
	currentUserId?: string;
}) {
	const title = getRoomTitle(entry.room, currentUserId);
	const isChannel = entry.room.type === "channel";
	const last = entry.room.last_message;
	const previewText = last ? last.content : "No messages yet";

	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
					isSelected ? "bg-slate-100" : "hover:bg-slate-50"
				}`}
			>
				<div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
					{isChannel ? (
						<Hash className="h-4 w-4" />
					) : (
						<MessageSquare className="h-4 w-4" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-2">
						<span
							className={`truncate text-sm ${
								entry.hasUnread
									? "font-semibold text-slate-900"
									: "font-medium text-slate-800"
							}`}
						>
							{title}
						</span>
						<span className="shrink-0 text-[11px] text-slate-500">
							{formatTimestamp(last?.created_at ?? entry.room.updated_at)}
						</span>
					</div>
					<div className="mt-0.5 flex items-center justify-between gap-2">
						<span className="truncate text-xs text-slate-500">
							{entry.project.title}
						</span>
						{entry.hasUnread && (
							<span className="h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
						)}
					</div>
					<p
						className={`mt-1 truncate text-xs ${
							entry.hasUnread ? "text-slate-700" : "text-slate-500"
						}`}
					>
						{previewText}
					</p>
				</div>
			</button>
		</li>
	);
}

// ─── Inbox thread (right pane) ──────────────────────────────────────────────

function InboxThread({
	entry,
	currentUserId,
	onAfterSend,
}: {
	entry: InboxEntry;
	currentUserId?: string;
	onAfterSend: () => void;
}) {
	const { project, room } = entry;
	const profile = useProfile();
	const messagesQuery = useRoomMessagesQuery(project.id, room.id);
	const sendMutation = useSendChatMessageMutation(project.id);
	const markReadMutation = useMarkRoomReadMutation(project.id, currentUserId);
	const toggleReactionMutation = useToggleChatReactionMutation(project.id);
	const deleteMessageMutation = useDeleteChatMessageMutation(project.id);

	const [input, setInput] = useState("");
	const [optimisticMessages, setOptimisticMessages] = useState<
		ThreadUiMessage[]
	>([]);
	const optimisticOrderCounterRef = useRef(0);

	const [pendingUnsendMessage, setPendingUnsendMessage] =
		useState<ThreadUiMessage | null>(null);
	const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(false);
	const [selectedProfileUserId, setSelectedProfileUserId] = useState<
		string | null
	>(null);

	const viewportRef = useRef<HTMLDivElement | null>(null);
	const shouldStickToBottomRef = useRef(true);
	const fetchingOlderRef = useRef(false);
	const prependAnchorRef = useRef<{
		scrollTop: number;
		scrollHeight: number;
	} | null>(null);
	const readMarkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inFlightReadRoomRef = useRef<string | null>(null);

	const confirmedMessages = useMemo<ThreadUiMessage[]>(
		() => flattenRoomMessages(messagesQuery.data),
		[messagesQuery.data],
	);
	const messages = useMemo<ThreadUiMessage[]>(
		() => mergeThreadMessages(confirmedMessages, optimisticMessages),
		[confirmedMessages, optimisticMessages],
	);

	// Build sender map from room participants. Inbox doesn't load
	// per-project members so this is the lightweight version.
	const senderMap = useMemo<Record<string, ThreadSender>>(() => {
		const map: Record<string, ThreadSender> = {};
		for (const p of room.participants) {
			if (!p.user_id) continue;
			map[p.user_id] = {
				name: p.user?.display_name ?? p.user?.email ?? "Member",
				avatarUrl: p.user?.avatar_url ?? null,
			};
		}
		return map;
	}, [room.participants]);

	// Typing — broadcast on composer change, display incoming.
	const { typingNames, startTyping, stopTyping } = useChatTyping({
		projectId: project.id,
		roomId: room.id,
		userId: currentUserId,
		displayName:
			profile?.display_name ?? profile?.first_name ?? undefined,
	});

	// In a DM, default the profile panel selection to the counterpart.
	useEffect(() => {
		if (room.type === "dm") {
			const counterpart = room.participants.find(
				(p) => p.user_id !== currentUserId,
			);
			if (counterpart?.user_id) {
				setSelectedProfileUserId(counterpart.user_id);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [room.id]);

	// Drop optimistic messages once their server-confirmed counterpart
	// shows up via the realtime invalidation.
	useEffect(() => {
		if (optimisticMessages.length === 0) return;
		setOptimisticMessages((prev) =>
			prev.filter((opt) => {
				return !confirmedMessages.some((conf) => {
					if (conf.id === opt.id) return true;
					if (
						conf.sender_id === opt.sender_id &&
						conf.content === opt.content &&
						Math.abs(
							new Date(conf.created_at).getTime() -
								new Date(opt.created_at).getTime(),
						) < 15_000
					) {
						return true;
					}
					return false;
				});
			}),
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [confirmedMessages]);

	// Debounced + deduped mark-as-read. Mirrors project chat behavior.
	const scheduleMarkRead = useCallback(
		(delayMs = 550) => {
			if (!currentUserId) return;
			if (!hasUnreadForRoom(room, currentUserId)) return;
			if (inFlightReadRoomRef.current === room.id) return;
			if (readMarkTimerRef.current) clearTimeout(readMarkTimerRef.current);
			readMarkTimerRef.current = setTimeout(() => {
				if (inFlightReadRoomRef.current === room.id) return;
				inFlightReadRoomRef.current = room.id;
				void markReadMutation
					.mutateAsync({ roomId: room.id })
					.finally(() => {
						if (inFlightReadRoomRef.current === room.id) {
							inFlightReadRoomRef.current = null;
						}
					});
			}, delayMs);
		},
		[currentUserId, markReadMutation, room],
	);

	useEffect(() => {
		return () => {
			if (readMarkTimerRef.current) clearTimeout(readMarkTimerRef.current);
		};
	}, []);

	// Reset scroll/sticky state when the active room changes.
	useEffect(() => {
		shouldStickToBottomRef.current = true;
		prependAnchorRef.current = null;
		fetchingOlderRef.current = false;
		setOptimisticMessages([]);
		setSelectedProfileUserId(null);
	}, [room.id]);

	// Infinite scroll up + sticky-to-bottom + mark-read trigger.
	const fetchOlderMessages = useCallback(async () => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return;
		if (fetchingOlderRef.current) return;

		fetchingOlderRef.current = true;
		prependAnchorRef.current = {
			scrollTop: viewport.scrollTop,
			scrollHeight: viewport.scrollHeight,
		};

		try {
			await messagesQuery.fetchNextPage();
		} finally {
			requestAnimationFrame(() => {
				const next = viewportRef.current;
				const anchor = prependAnchorRef.current;
				if (next && anchor && next.scrollHeight >= anchor.scrollHeight) {
					const delta = next.scrollHeight - anchor.scrollHeight;
					next.scrollTop = anchor.scrollTop + delta;
				}
				prependAnchorRef.current = null;
				fetchingOlderRef.current = false;
			});
		}
	}, [messagesQuery]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const onScroll = () => {
			if (
				viewport.scrollTop <= 120 &&
				messagesQuery.hasNextPage &&
				!messagesQuery.isFetchingNextPage
			) {
				void fetchOlderMessages();
			}
			const distanceToBottom =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
			shouldStickToBottomRef.current = distanceToBottom <= 140;
			if (distanceToBottom <= 140) scheduleMarkRead(500);
		};
		onScroll();
		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, [
		fetchOlderMessages,
		messagesQuery.hasNextPage,
		messagesQuery.isFetchingNextPage,
		scheduleMarkRead,
	]);

	// Sticky-to-bottom: re-anchor after new messages or typing change.
	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		if (!shouldStickToBottomRef.current) return;
		requestAnimationFrame(() => {
			viewport.scrollTop = viewport.scrollHeight;
			scheduleMarkRead(450);
		});
	}, [messages.length, typingNames.length, scheduleMarkRead]);

	const handleSend = async () => {
		if (!currentUserId || sendMutation.isPending) return;
		const content = input.trim();
		if (!content) return;

		const tempId = `tmp-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		const latest = messages[messages.length - 1]?.created_at;
		const latestMs = latest ? new Date(latest).getTime() : 0;
		const optimisticCreatedAtMs = Math.max(Date.now(), latestMs + 1);
		const nowIso = new Date(optimisticCreatedAtMs).toISOString();
		const optimisticOrder =
			Date.now() * 1000 + (optimisticOrderCounterRef.current++ % 1000);

		const optimistic: ThreadUiMessage = {
			id: tempId,
			render_key: tempId,
			optimistic_order: optimisticOrder,
			room_id: room.id,
			project_id: project.id,
			sender_id: currentUserId,
			content,
			created_at: nowIso,
			updated_at: nowIso,
			optimisticStatus: "sending",
		};

		setOptimisticMessages((prev) => [...prev, optimistic]);
		setInput("");
		shouldStickToBottomRef.current = true;
		requestAnimationFrame(() => {
			const v = viewportRef.current;
			if (v) v.scrollTop = v.scrollHeight;
		});

		try {
			const result = await sendMutation.mutateAsync({
				room_id: room.id,
				content,
			});
			void stopTyping();
			// Swap the optimistic id with the server one so any later
			// updates (reactions, deletes) match.
			setOptimisticMessages((prev) =>
				prev.map((m) =>
					m.id === tempId
						? {
								...m,
								id: result.message.id,
								created_at: result.message.created_at,
								updated_at: result.message.updated_at,
								optimisticStatus: undefined,
							}
						: m,
				),
			);
			onAfterSend();
		} catch {
			setOptimisticMessages((prev) =>
				prev.map((m) =>
					m.id === tempId ? { ...m, optimisticStatus: "failed" } : m,
				),
			);
			void stopTyping();
		}
	};

	const handleToggleReaction = useCallback(
		(messageId: string, roomId: string, emoji: string) => {
			void toggleReactionMutation.mutateAsync({ messageId, roomId, emoji });
		},
		[toggleReactionMutation],
	);

	const handleRequestUnsend = useCallback(
		async (message: ThreadUiMessage, bypassConfirm: boolean) => {
			if (message.sender_id !== currentUserId) return;
			if (bypassConfirm) {
				await deleteMessageMutation.mutateAsync({
					roomId: message.room_id || room.id,
					messageId: message.id,
				});
				return;
			}
			setPendingUnsendMessage(message);
		},
		[currentUserId, deleteMessageMutation, room.id],
	);

	const handleSelectSender = useCallback((userId: string) => {
		setSelectedProfileUserId(userId);
		setIsProfilePanelOpen(true);
	}, []);

	const profilePreview = useMemo<ChatMemberProfilePreview | null>(() => {
		if (!selectedProfileUserId) return null;
		const sender = senderMap[selectedProfileUserId];
		if (!sender) return null;
		const participant = room.participants.find(
			(p) => p.user_id === selectedProfileUserId,
		);
		return {
			userId: selectedProfileUserId,
			name: sender.name,
			roleLabel: "Member",
			positionLabel: participant?.user?.email ?? "",
			avatarUrl: sender.avatarUrl ?? null,
			bannerUrl: null,
		};
	}, [selectedProfileUserId, senderMap, room.participants]);

	const title = getRoomTitle(room, currentUserId);

	return (
		<>
			<div className="flex h-full min-h-0 flex-1 min-w-0 flex-col">
				<header className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-3">
					<div className="flex min-w-0 items-center gap-3">
						<div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
							{room.type === "channel" ? (
								<Hash className="h-4 w-4" />
							) : (
								<MessageSquare className="h-4 w-4" />
							)}
						</div>
						<div className="min-w-0">
							<h2 className="truncate text-base font-semibold text-slate-900">
								{title}
							</h2>
							<p className="truncate text-xs text-slate-500">
								{project.title}
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => {
							setIsProfilePanelOpen((v) => {
								const next = !v;
								if (next && room.type === "dm" && !selectedProfileUserId) {
									const counterpart = room.participants.find(
										(p) => p.user_id !== currentUserId,
									);
									if (counterpart?.user_id) {
										setSelectedProfileUserId(counterpart.user_id);
									}
								}
								return next;
							});
						}}
						className="hidden xl:inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
						aria-label={
							isProfilePanelOpen ? "Close profile panel" : "Open profile panel"
						}
					>
						<PanelRight className="h-4 w-4" />
					</button>
				</header>

				<div ref={viewportRef} className="flex-1 overflow-y-auto px-6 py-4">
					<MessageList
						isLoading={messagesQuery.isPending}
						hasMessages={messages.length > 0}
						messages={messages}
						senderMap={senderMap}
						currentUserId={currentUserId}
						selectedSenderId={selectedProfileUserId}
						onSelectSender={handleSelectSender}
						onToggleReaction={handleToggleReaction}
						onRequestUnsend={handleRequestUnsend}
						hasNextPage={Boolean(messagesQuery.hasNextPage)}
						isFetchingNextPage={messagesQuery.isFetchingNextPage}
						emptyTitle="No messages yet"
						emptySubtitle="Send the first message in this conversation."
					/>
				</div>

				{typingNames.length > 0 && (
					<div className="px-6 pb-1">
						<TypingIndicator names={typingNames} />
					</div>
				)}

				<ChatComposer
					value={input}
					placeholder={`Message ${title}`}
					isSending={sendMutation.isPending}
					onChange={(next) => {
						setInput(next);
						if (next.trim()) void startTyping();
						else void stopTyping();
					}}
					onBlur={() => {
						void stopTyping();
					}}
					onSend={() => {
						void handleSend();
					}}
				/>
			</div>

			{/* Profile panel — collapsible third pane */}
			{isProfilePanelOpen && (
				<aside className="hidden xl:flex w-[320px] shrink-0 flex-col border-l border-slate-200 bg-white">
					<ChatProfilePanel
						member={profilePreview}
						isOpen={isProfilePanelOpen}
						mode={room.type}
						onToggle={() => setIsProfilePanelOpen((v) => !v)}
						onClose={() => setIsProfilePanelOpen(false)}
					/>
				</aside>
			)}

			<ChatUnsendConfirmModal
				open={!!pendingUnsendMessage}
				senderName={
					(pendingUnsendMessage &&
						(senderMap[pendingUnsendMessage.sender_id]?.name || "You")) ||
					"You"
				}
				senderAvatarUrl={
					(pendingUnsendMessage &&
						(senderMap[pendingUnsendMessage.sender_id]?.avatarUrl ?? null)) ||
					null
				}
				sentAt={
					pendingUnsendMessage
						? new Date(pendingUnsendMessage.created_at).toLocaleTimeString([], {
								hour: "numeric",
								minute: "2-digit",
							})
						: ""
				}
				content={pendingUnsendMessage?.content ?? ""}
				isSubmitting={deleteMessageMutation.isPending}
				onCancel={() => {
					if (deleteMessageMutation.isPending) return;
					setPendingUnsendMessage(null);
				}}
				onConfirm={() => {
					const target = pendingUnsendMessage;
					if (!target) return;
					setPendingUnsendMessage(null);
					void deleteMessageMutation.mutateAsync({
						roomId: target.room_id || room.id,
						messageId: target.id,
					});
				}}
			/>
		</>
	);
}

// ─── Skeletons + empty ─────────────────────────────────────────────────────

function InboxListSkeleton() {
	return (
		<ul className="divide-y divide-slate-100">
			{[0, 1, 2, 3, 4].map((i) => (
				<li key={i} className="flex items-start gap-3 px-4 py-3">
					<div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
					<div className="flex-1 space-y-2">
						<div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
						<div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
					</div>
				</li>
			))}
		</ul>
	);
}

function EmptyState({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="px-6 py-14 text-center">
			<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
				<Inbox className="h-5 w-5 text-slate-700" />
			</div>
			<h3 className="text-base font-semibold text-slate-900">{title}</h3>
			<p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
				{description}
			</p>
		</div>
	);
}
