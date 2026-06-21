import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
	ChevronRight,
	Hash,
	Inbox,
	Lock,
	MessageSquare,
	PanelRight,
} from "lucide-react";
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
	useDmRoomsQuery,
	useMarkRoomReadMutation,
	useRoomMessagesQuery,
	useSendChannelMessageMutation,
	useSendDmMessageMutation,
	useToggleChatReactionMutation,
} from "@/hooks/useChatQueries";
import { useChatTyping } from "@/hooks/useChatTyping";
import { useDmRealtime, useProjectsRealtime } from "@/hooks/useChatRealtime";
import { useProjectMembersQuery } from "@/hooks/useProjectQueries";
import type { ProjectMember } from "@/services/project.service";
import type { ChatAttachment, ChatRoom } from "@/services/chat.service";
import { uploadService } from "@/services/upload.service";
import {
	forgetAttachmentBlob,
	rememberAttachmentBlob,
} from "@/components/project/chat/attachmentPreviewCache";
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
	type PendingAttachment,
	type MentionCandidate,
} from "@/components/project/chat";
import type { ChatMemberProfilePreview } from "@/components/project/chat/ChatMemberProfileCard";
import {
	resolveMentions,
	type MentionPick,
} from "@/components/project/chat/mentions";

export const Route = createFileRoute("/inbox")({
	validateSearch: (search) => ({
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
	project: Project | null; // null for global DM entries
	hasUnread: boolean;
};

type InboxGroup = {
	id: string;
	label: string;
	project: Project | null;
	entries: InboxEntry[];
	mostRecent: number;
	unreadCount: number;
};

const DM_GROUP_ID = "__dm__";

// ─── Helpers ───────────────────────────────────────────────────────────────

const COLLAPSED_STORAGE_KEY = "inbox_collapsed_projects";

function loadCollapsed(): Record<string, boolean> {
	if (typeof window === "undefined") return {};
	try {
		const raw = sessionStorage.getItem(COLLAPSED_STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
	} catch {
		return {};
	}
}

function saveCollapsed(state: Record<string, boolean>): void {
	if (typeof window === "undefined") return;
	try {
		sessionStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(state));
	} catch {
		/* sessionStorage full / disabled — non-fatal */
	}
}

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

	// Per-project: channels only (backend now filters DMs out of this list).
	const roomQueries = useQueries({
		queries: projects.map((project) => ({
			queryKey: chatKeys.rooms(project.id),
			queryFn: () => fetchProjectChatRooms(project.id),
			enabled: Boolean(user?.id),
			staleTime: 15 * 1000,
			refetchOnWindowFocus: true,
		})),
	});

	// Global DMs (cross-project; one row per counterpart).
	const dmRoomsQuery = useDmRoomsQuery(Boolean(user?.id));
	const dmRooms = dmRoomsQuery.data ?? [];

	// Realtime: channels per project + per-DM-room.
	const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
	useProjectsRealtime(projectIds, user?.id);
	const dmRoomIds = useMemo(() => dmRooms.map((r) => r.id), [dmRooms]);
	useDmRealtime(dmRoomIds, user?.id);

	const isLoading =
		projectsQuery.isPending ||
		roomQueries.some((q) => q.isPending) ||
		dmRoomsQuery.isPending;

	const entries: InboxEntry[] = useMemo(() => {
		const out: InboxEntry[] = [];
		for (let i = 0; i < projects.length; i++) {
			const project = projects[i];
			const rooms = roomQueries[i]?.data ?? [];
			for (const room of rooms) {
				if (room.type !== "channel") continue;
				out.push({
					room,
					project,
					hasUnread: hasUnreadForRoom(room, user?.id),
				});
			}
		}
		for (const room of dmRooms) {
			out.push({
				room,
				project: null,
				hasUnread: hasUnreadForRoom(room, user?.id),
			});
		}
		out.sort((a, b) => {
			const ta = a.room.last_message?.created_at ?? a.room.updated_at;
			const tb = b.room.last_message?.created_at ?? b.room.updated_at;
			return new Date(tb).getTime() - new Date(ta).getTime();
		});
		return out;
	}, [projects, roomQueries, dmRooms, user?.id]);

	const selectedEntry = useMemo<InboxEntry | null>(() => {
		if (search.r) {
			return entries.find((e) => e.room.id === search.r) ?? null;
		}
		return entries[0] ?? null;
	}, [entries, search.r]);

	const handleSelect = useCallback(
		(entry: InboxEntry) => {
			navigate({
				to: "/inbox",
				search: { r: entry.room.id },
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

	// Group: each project + one synthetic "Direct messages" group.
	const visibleGroups = useMemo<InboxGroup[]>(() => {
		const map = new Map<string, InboxGroup>();
		for (const entry of visibleEntries) {
			const ts = new Date(
				entry.room.last_message?.created_at ?? entry.room.updated_at,
			).getTime();
			const groupId = entry.project?.id ?? DM_GROUP_ID;
			const groupLabel = entry.project?.title ?? "Direct messages";
			const existing = map.get(groupId);
			if (existing) {
				existing.entries.push(entry);
				if (ts > existing.mostRecent) existing.mostRecent = ts;
				if (entry.hasUnread) existing.unreadCount += 1;
			} else {
				map.set(groupId, {
					id: groupId,
					label: groupLabel,
					project: entry.project,
					entries: [entry],
					mostRecent: ts,
					unreadCount: entry.hasUnread ? 1 : 0,
				});
			}
		}
		const groups = Array.from(map.values());
		for (const g of groups) {
			g.entries.sort((a, b) => {
				const aChannel = a.room.type === "channel" ? 0 : 1;
				const bChannel = b.room.type === "channel" ? 0 : 1;
				if (aChannel !== bChannel) return aChannel - bChannel;
				const aTs = new Date(
					a.room.last_message?.created_at ?? a.room.updated_at,
				).getTime();
				const bTs = new Date(
					b.room.last_message?.created_at ?? b.room.updated_at,
				).getTime();
				return bTs - aTs;
			});
		}
		// Pin DMs group at top, then projects by recency.
		return groups.sort((a, b) => {
			if (a.id === DM_GROUP_ID && b.id !== DM_GROUP_ID) return -1;
			if (b.id === DM_GROUP_ID && a.id !== DM_GROUP_ID) return 1;
			return b.mostRecent - a.mostRecent;
		});
	}, [visibleEntries]);

	const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
		loadCollapsed(),
	);
	const toggleCollapsed = useCallback((groupId: string) => {
		setCollapsed((prev) => {
			const next = { ...prev, [groupId]: !prev[groupId] };
			saveCollapsed(next);
			return next;
		});
	}, []);

	return (
		<DashboardShell>
			<div className="h-[calc(100vh-3.5rem)] px-4 py-4 sm:px-6 lg:px-8">
				<div className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
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
							) : visibleGroups.length === 0 ? (
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
								<div>
									{visibleGroups.map((group) => (
										<InboxSection
											key={group.id}
											group={group}
											collapsed={!!collapsed[group.id]}
											onToggle={() => toggleCollapsed(group.id)}
											selectedEntry={selectedEntry}
											currentUserId={user?.id}
											onSelect={handleSelect}
										/>
									))}
								</div>
							)}
						</div>
					</aside>

					<section className="flex min-w-0 flex-1 bg-white">
						{selectedEntry ? (
							<InboxThread
								key={selectedEntry.room.id}
								entry={selectedEntry}
								currentUserId={user?.id}
								onAfterSend={() => {
									if (selectedEntry.room.type === "dm") {
										void queryClient.invalidateQueries({
											queryKey: chatKeys.dmRooms(),
										});
									} else if (selectedEntry.project) {
										void queryClient.invalidateQueries({
											queryKey: chatKeys.rooms(selectedEntry.project.id),
										});
									}
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

// ─── Group section (left rail) ─────────────────────────────────────────────

function InboxSection({
	group,
	collapsed,
	onToggle,
	selectedEntry,
	currentUserId,
	onSelect,
}: {
	group: InboxGroup;
	collapsed: boolean;
	onToggle: () => void;
	selectedEntry: InboxEntry | null;
	currentUserId?: string;
	onSelect: (entry: InboxEntry) => void;
}) {
	return (
		<section className="border-b border-slate-100 last:border-b-0">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-2 bg-slate-50/60 px-4 py-2 text-left transition-colors hover:bg-slate-100"
			>
				<motion.span
					initial={false}
					animate={{ rotate: collapsed ? 0 : 90 }}
					transition={{ duration: 0.18, ease: "easeOut" }}
					className="flex"
				>
					<ChevronRight className="h-3.5 w-3.5 text-slate-500" />
				</motion.span>
				<span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-600">
					{group.label}
				</span>
				{group.unreadCount > 0 && (
					<span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
						{group.unreadCount}
					</span>
				)}
			</button>

			<AnimatePresence initial={false}>
				{!collapsed && (
					<motion.div
						key="rooms"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
						className="overflow-hidden"
					>
						<ul className="divide-y divide-slate-100">
							{group.entries.map((entry) => (
								<InboxRow
									key={entry.room.id}
									entry={entry}
									isSelected={selectedEntry?.room.id === entry.room.id}
									onSelect={() => onSelect(entry)}
									currentUserId={currentUserId}
								/>
							))}
						</ul>
					</motion.div>
				)}
			</AnimatePresence>
		</section>
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
	const lastAttachment = last?.attachments?.[0];
	const previewText = last
		? last.content.trim() ||
			(lastAttachment
				? lastAttachment.content_type.startsWith("image/")
					? "📷 Photo"
					: `📎 ${lastAttachment.name}`
				: "No messages yet")
		: "No messages yet";

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
						entry.room.is_private ? (
							<Lock className="h-4 w-4" />
						) : (
							<Hash className="h-4 w-4" />
						)
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
					<div className="mt-1 flex items-center justify-between gap-2">
						<p
							className={`min-w-0 flex-1 truncate text-xs ${
								entry.hasUnread ? "text-slate-700" : "text-slate-500"
							}`}
						>
							{previewText}
						</p>
						{entry.hasUnread && (
							<span className="h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
						)}
					</div>
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
	const messagesQuery = useRoomMessagesQuery(room.id);
	const sendChannelMutation = useSendChannelMessageMutation(project?.id ?? "");
	const sendDmMutation = useSendDmMessageMutation();
	const markReadMutation = useMarkRoomReadMutation({
		projectId: project?.id,
		isDm: room.type === "dm",
		currentUserId,
	});
	const toggleReactionMutation = useToggleChatReactionMutation();
	const deleteMessageMutation = useDeleteChatMessageMutation();

	const [input, setInput] = useState("");
	const [pendingAttachments, setPendingAttachments] = useState<
		PendingAttachment[]
	>([]);
	const [pendingMentions, setPendingMentions] = useState<MentionPick[]>([]);
	const addMention = (pick: MentionPick) =>
		setPendingMentions((prev) => [...prev, pick]);
	const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
	const objectUrlsRef = useRef<string[]>([]);
	const rememberedCdnsRef = useRef<string[]>([]);
	const [optimisticMessages, setOptimisticMessages] = useState<
		ThreadUiMessage[]
	>([]);
	const optimisticOrderCounterRef = useRef(0);

	const addFiles = (files: File[]) => {
		const additions = files.map((file) => {
			const isImage = file.type.startsWith("image/");
			const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
			if (previewUrl) objectUrlsRef.current.push(previewUrl);
			return {
				id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				file,
				kind: isImage ? ("image" as const) : ("file" as const),
				previewUrl,
			} satisfies PendingAttachment;
		});
		setPendingAttachments((prev) => [...prev, ...additions]);
	};

	const removeAttachment = (id: string) => {
		setPendingAttachments((prev) => {
			const target = prev.find((attachment) => attachment.id === id);
			if (target?.previewUrl) {
				URL.revokeObjectURL(target.previewUrl);
				objectUrlsRef.current = objectUrlsRef.current.filter(
					(url) => url !== target.previewUrl,
				);
			}
			return prev.filter((attachment) => attachment.id !== id);
		});
	};

	useEffect(() => {
		return () => {
			for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
			objectUrlsRef.current = [];
			for (const cdn of rememberedCdnsRef.current) forgetAttachmentBlob(cdn);
			rememberedCdnsRef.current = [];
		};
	}, []);

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

	// Mentionable people in this thread: the other participant(s).
	const mentionables = useMemo<MentionCandidate[]>(
		() =>
			room.participants
				.filter((p) => p.user_id && p.user_id !== currentUserId)
				.map((p) => ({
					user_id: p.user_id,
					name: p.user?.display_name ?? p.user?.email ?? "Member",
					avatar_url: p.user?.avatar_url ?? null,
				})),
		[room.participants, currentUserId],
	);

	// Pill spans for the composer's live input (Messenger-style highlight).
	const composerHighlightRanges = useMemo(
		() => resolveMentions(input, pendingMentions),
		[input, pendingMentions],
	);

	const projectMembersQuery = useProjectMembersQuery(project?.id ?? "");
	const projectMembers =
		(projectMembersQuery.data as ProjectMember[] | undefined) ?? [];

	const { typingNames, startTyping, stopTyping } = useChatTyping({
		// Use room.project_id when available so channel typing stays per-project;
		// fall back to "dm" sentinel so both DM participants share the same channel
		// name regardless of where they opened the thread.
		projectId: room.project_id ?? "dm",
		roomId: room.id,
		userId: currentUserId,
		displayName: profile?.display_name ?? profile?.first_name ?? undefined,
	});

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

	useEffect(() => {
		shouldStickToBottomRef.current = true;
		prependAnchorRef.current = null;
		fetchingOlderRef.current = false;
		setOptimisticMessages([]);
		setSelectedProfileUserId(null);
	}, [room.id]);

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

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		if (!shouldStickToBottomRef.current) return;
		requestAnimationFrame(() => {
			viewport.scrollTop = viewport.scrollHeight;
			scheduleMarkRead(450);
		});
	}, [messages.length, typingNames.length, scheduleMarkRead]);

	const isSendingMessage =
		sendChannelMutation.isPending || sendDmMutation.isPending;

	const handleSend = async () => {
		if (!currentUserId || isSendingMessage || isUploadingAttachments) return;
		const content = input.trim();
		const pending = pendingAttachments;
		if (!content && pending.length === 0) return;

		const mentions = resolveMentions(content, pendingMentions);
		const mentionsPayload = mentions.length > 0 ? mentions : undefined;

		const optimisticAttachments: ChatAttachment[] = pending.map(
			(attachment) => ({
				url: attachment.previewUrl ?? "",
				name: attachment.file.name,
				content_type: attachment.file.type || "application/octet-stream",
				size: attachment.file.size,
			}),
		);

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
			project_id: room.project_id,
			sender_id: currentUserId,
			content,
			attachments: optimisticAttachments,
			mentions,
			created_at: nowIso,
			updated_at: nowIso,
			optimisticStatus: "sending",
		};

		setOptimisticMessages((prev) => [...prev, optimistic]);
		setInput("");
		setPendingAttachments([]);
		setPendingMentions([]);
		shouldStickToBottomRef.current = true;
		requestAnimationFrame(() => {
			const v = viewportRef.current;
			if (v) v.scrollTop = v.scrollHeight;
		});

		const markFailed = () =>
			setOptimisticMessages((prev) =>
				prev.map((m) =>
					m.id === tempId ? { ...m, optimisticStatus: "failed" } : m,
				),
			);

		let uploadedAttachments: ChatAttachment[] = [];
		if (pending.length > 0) {
			setIsUploadingAttachments(true);
			try {
				uploadedAttachments = await Promise.all(
					pending.map((attachment) =>
						uploadService.uploadChatAttachment(attachment.file),
					),
				);
				pending.forEach((attachment, index) => {
					const uploaded = uploadedAttachments[index];
					if (
						attachment.kind === "image" &&
						attachment.previewUrl &&
						uploaded
					) {
						rememberAttachmentBlob(uploaded.url, attachment.previewUrl);
						rememberedCdnsRef.current.push(uploaded.url);
					}
				});
			} catch {
				markFailed();
				void stopTyping();
				return;
			} finally {
				setIsUploadingAttachments(false);
			}
		}

		const attachmentsPayload =
			uploadedAttachments.length > 0 ? uploadedAttachments : undefined;

		try {
			const result =
				room.type === "dm"
					? await sendDmMutation.mutateAsync({
							room_id: room.id,
							content,
							attachments: attachmentsPayload,
							mentions: mentionsPayload,
						})
					: await sendChannelMutation.mutateAsync({
							room_id: room.id,
							content,
							attachments: attachmentsPayload,
							mentions: mentionsPayload,
						});
			void stopTyping();
			setOptimisticMessages((prev) =>
				prev.map((m) =>
					m.id === tempId
						? {
								...m,
								id: result.message.id,
								attachments: result.message.attachments ?? m.attachments,
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

	const projectMemberPreviews = useMemo<ChatMemberProfilePreview[]>(
		() =>
			projectMembers
				.filter((m) => !!m.user_id)
				.map((m) => {
					const name =
						m.user?.display_name ||
						[m.user?.first_name, m.user?.last_name]
							.filter(Boolean)
							.join(" ") ||
						m.user?.email ||
						"Member";
					const roleLabel = m.role
						? m.role.charAt(0).toUpperCase() + m.role.slice(1)
						: "Member";
					return {
						userId: m.user_id as string,
						name,
						roleLabel,
						positionLabel: m.position?.trim() || "",
						avatarUrl: m.user?.avatar_url ?? null,
						bannerUrl: null,
					};
				}),
		[projectMembers],
	);

	const profilePreview = useMemo<ChatMemberProfilePreview | null>(() => {
		if (!selectedProfileUserId) return null;
		const sender = senderMap[selectedProfileUserId];
		if (!sender) return null;
		const member = projectMembers.find(
			(m) => m.user_id === selectedProfileUserId,
		);
		const roleLabel = member?.role
			? member.role.charAt(0).toUpperCase() + member.role.slice(1)
			: "Member";
		return {
			userId: selectedProfileUserId,
			name: sender.name,
			roleLabel,
			positionLabel: member?.position?.trim() || "",
			avatarUrl: sender.avatarUrl ?? null,
			bannerUrl: null,
		};
	}, [selectedProfileUserId, senderMap, projectMembers]);

	const title = getRoomTitle(room, currentUserId);

	return (
		<>
			<div className="flex h-full min-h-0 flex-1 min-w-0 flex-col">
				<header className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-3">
					<div className="flex min-w-0 items-center gap-3">
						<div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
							{room.type === "channel" ? (
								room.is_private ? (
									<Lock className="h-4 w-4" />
								) : (
									<Hash className="h-4 w-4" />
								)
							) : (
								<MessageSquare className="h-4 w-4" />
							)}
						</div>
						<div className="min-w-0">
							<h2 className="truncate text-base font-semibold text-slate-900">
								{title}
							</h2>
							<p className="truncate text-xs text-slate-500">
								{project?.title ?? "Direct message"}
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
					isSending={isSendingMessage}
					isUploading={isUploadingAttachments}
					attachments={pendingAttachments}
					mentionables={mentionables}
					canMention={mentionables.length > 0}
					highlightRanges={composerHighlightRanges}
					onAddMention={addMention}
					onAddFiles={addFiles}
					onRemoveAttachment={removeAttachment}
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

			{isProfilePanelOpen && (
				<aside className="hidden xl:flex w-[320px] shrink-0 flex-col border-l border-slate-200 bg-white">
					<ChatProfilePanel
						member={profilePreview}
						isOpen={isProfilePanelOpen}
						mode={room.type}
						projectMembers={projectMemberPreviews}
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
