import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import {
	ChatCenterShellSkeleton,
	ChatComposer,
	ChatHeader,
	ChatInfoPanel,
	ChatProfilePanelSkeleton,
	ChatShell,
	ChatSidebar,
	ChatSidebarSkeleton,
	ChatUnsendConfirmModal,
	CreateChannelModal,
	type MentionCandidate,
	MessageList,
	type PendingAttachment,
	ScrollToLatestButton,
	TypingIndicator,
} from "@/components/project/chat";
import {
	forgetAttachmentBlob,
	rememberAttachmentBlob,
} from "@/components/project/chat/attachmentPreviewCache";
import {
	parseChatRef,
	roomRef,
	toChannelRef,
	toDmRef,
} from "@/components/project/chat/chatRef";
import { resolveMentions } from "@/components/project/chat/mentions";
import {
	mergeThreadMessages,
	type ThreadUiMessage,
} from "@/components/project/chat/thread";
import { useChatDraft } from "@/hooks/useChatDraft";
import {
	findMemberCandidate,
	findRoomByCounterpart,
	flattenRoomMessages,
	useCreateChannelMutation,
	useDeleteChatMessageMutation,
	useDmRoomsQuery,
	useEditChatMessageMutation,
	useMarkRoomReadMutation,
	useProjectChatMembersQuery,
	useProjectChatRoomsQuery,
	useRoomMessagesQuery,
	useSendChannelMessageMutation,
	useSendDmMessageMutation,
	useToggleChatReactionMutation,
	useToggleRoomStarMutation,
} from "@/hooks/useChatQueries";
import { useDmRealtime, useProjectsRealtime } from "@/hooks/useChatRealtime";
import { useChatTyping } from "@/hooks/useChatTyping";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import type {
	ChatAttachment,
	ChatMemberCandidate,
	ChatMemberRole,
	ChatMessage,
	ChatRoom,
} from "@/services/chat.service";
import { profileService } from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";
import { useProfile, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/chat/$chatRef")({
	component: ChatRoute,
});

function ChatRoute() {
	const { projectId } = Route.useParams();
	return (
		<RequireProjectAccess projectId={projectId} access="chat">
			<ChatPage />
		</RequireProjectAccess>
	);
}

type ActiveTarget =
	| { kind: "channel"; roomId: string | null }
	| { kind: "dm"; userId: string; roomId: string | null };
type ResolvedTarget = ActiveTarget | { kind: "invalid" };

// Canonical ordering of the auto-provisioned default rooms in the sidebar,
// keyed by slug (the system_key column was dropped).
const SYSTEM_ROOM_ORDER: Record<string, number> = {
	"client-room": 0,
	"internal-team": 1,
	"consultant-client": 2,
	"consultant-pm": 3,
	general: 0,
};

function channelTitle(room: ChatRoom | null | undefined): string {
	if (!room) return "Channel";
	return room.name?.trim() || `#${room.slug}`;
}

/** Sidebar/last-message preview text, falling back to attachment labels. */
function messagePreviewText(message: ChatMessage | null | undefined): string {
	if (!message) return "";
	const text = message.content?.trim();
	if (text) return text;
	const first = message.attachments?.[0];
	if (first) {
		return first.content_type.startsWith("image/")
			? "📷 Photo"
			: `📎 ${first.name}`;
	}
	return "";
}

function getDisplayName(member: ChatMemberCandidate | null): string {
	if (!member) return "Unknown member";
	return member.user?.display_name || member.user?.email || member.user_id;
}

function getRoleLabel(role: ChatMemberRole | undefined): string {
	if (!role) return "Member";
	return role.charAt(0).toUpperCase() + role.slice(1);
}

function hasUnreadForRoom(room: ChatRoom, userId?: string): boolean {
	if (!userId) return false;
	if (typeof room.has_unread === "boolean") return room.has_unread;

	const latestMessage = room.last_message;
	if (!latestMessage) return false;

	const viewerLastReadAt =
		room.viewer_last_read_at ??
		room.participants.find((participant) => participant.user_id === userId)
			?.last_read_at ??
		null;

	if (!viewerLastReadAt) {
		return latestMessage.sender_id !== userId;
	}

	return (
		new Date(latestMessage.created_at).getTime() >
		new Date(viewerLastReadAt).getTime()
	);
}

function ChatPage() {
	const { projectId, chatRef } = Route.useParams();
	const navigate = useNavigate();
	const user = useUser();
	const profile = useProfile();
	const toast = useToast();
	const [showPeoplePicker, setShowPeoplePicker] = useState(false);
	const [mobileView, setMobileView] = useState<"list" | "chat" | "info">(
		"list",
	);
	const [showCreateChannel, setShowCreateChannel] = useState(false);
	const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(true);
	const [selectedProfileUserId, setSelectedProfileUserId] = useState<
		string | null
	>(null);
	const [pendingAttachments, setPendingAttachments] = useState<
		PendingAttachment[]
	>([]);
	const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
	// All object URLs we minted for image previews, revoked on unmount so a long
	// chat session doesn't leak them.
	const objectUrlsRef = useRef<string[]>([]);
	// CDN URLs whose blob preview we registered in the shared cache, so we can
	// forget them when this view unmounts (after the blobs are revoked).
	const rememberedCdnsRef = useRef<string[]>([]);
	const optimisticOrderCounterRef = useRef(0);

	const addFiles = useCallback((files: File[]) => {
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
	}, []);

	const removeAttachment = useCallback((id: string) => {
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
	}, []);

	useEffect(() => {
		return () => {
			for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
			objectUrlsRef.current = [];
			for (const cdn of rememberedCdnsRef.current) forgetAttachmentBlob(cdn);
			rememberedCdnsRef.current = [];
		};
	}, []);
	const messagesViewportRef = useRef<HTMLDivElement | null>(null);
	const shouldStickToBottomRef = useRef(true);
	// The room we've already auto-scrolled to the bottom for; lets us force a
	// jump-to-latest exactly once when the (shared) thread first shows a new room.
	const lastScrolledRoomRef = useRef<string | null>(null);
	const [showJumpToLatest, setShowJumpToLatest] = useState(false);
	const [hasNewBelow, setHasNewBelow] = useState(false);
	const [highlightedMessageId, setHighlightedMessageId] = useState<
		string | null
	>(null);
	const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevDisplayedCountRef = useRef(0);
	const fetchingOlderRef = useRef(false);
	const prependAnchorRef = useRef<{
		roomId: string | null;
		scrollTop: number;
		scrollHeight: number;
	} | null>(null);
	const [optimisticByConversation, setOptimisticByConversation] = useState<
		Record<string, ThreadUiMessage[]>
	>({});
	const [transientRoomTargets, setTransientRoomTargets] = useState<
		Record<string, ActiveTarget>
	>({});

	const roomsQuery = useProjectChatRoomsQuery(projectId);
	const membersQuery = useProjectChatMembersQuery(projectId);
	const dmRoomsQuery = useDmRoomsQuery(Boolean(user?.id));
	const sendChannelMutation = useSendChannelMessageMutation(projectId);
	const sendDmMutation = useSendDmMessageMutation();
	const toggleReactionMutation = useToggleChatReactionMutation();
	const toggleRoomStarMutation = useToggleRoomStarMutation(projectId);
	const deleteMessageMutation = useDeleteChatMessageMutation();
	const editMessageMutation = useEditChatMessageMutation();
	const createChannelMutation = useCreateChannelMutation(projectId);
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const canCreateChannels = Boolean(
		permissionsQuery.data?.chat?.create_channels,
	);
	const canManageChannels = Boolean(
		permissionsQuery.data?.chat?.manage_channels,
	);
	const canMentionMembers = Boolean(
		permissionsQuery.data?.chat?.mention_members,
	);
	// The active room may be a project channel OR a global DM. Pick the
	// right list to optimistically update based on the room currently in view.
	const markChannelReadMutation = useMarkRoomReadMutation({
		projectId,
		isDm: false,
		currentUserId: user?.id,
	});
	const markDmReadMutation = useMarkRoomReadMutation({
		isDm: true,
		currentUserId: user?.id,
	});
	const [pendingUnsendMessage, setPendingUnsendMessage] =
		useState<ThreadUiMessage | null>(null);
	const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
	const [replyTarget, setReplyTarget] = useState<ThreadUiMessage | null>(null);
	const readMarkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inFlightReadRoomRef = useRef<string | null>(null);
	const roomSwitchSkeletonTimerRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const threadReadyRef = useRef(false);
	const [showRoomSwitchSkeletonPulse, setShowRoomSwitchSkeletonPulse] =
		useState(false);

	const channelRooms = roomsQuery.data ?? [];
	const members = membersQuery.data ?? [];
	const allDmRooms = dmRoomsQuery.data ?? [];
	// DM rows visible in this project: only those whose counterpart is a
	// member of *this* project. Same global thread, filtered surface.
	const memberIdSet = useMemo(
		() => new Set(members.map((m) => m.user_id)),
		[members],
	);
	const projectDmRooms = useMemo(
		() =>
			allDmRooms.filter((room) =>
				room.participants.some(
					(participant) =>
						participant.user_id !== user?.id &&
						memberIdSet.has(participant.user_id),
				),
			),
		[allDmRooms, memberIdSet, user?.id],
	);
	// Unified "rooms" view for the existing resolution logic: channels for
	// this project + the project-filtered DM rooms.
	const rooms = useMemo(
		() => [...channelRooms, ...projectDmRooms],
		[channelRooms, projectDmRooms],
	);
	const dmRoomIds = useMemo(() => allDmRooms.map((r) => r.id), [allDmRooms]);
	useProjectsRealtime([projectId], user?.id);
	useDmRealtime(dmRoomIds, user?.id);

	// Channels visible in this project, sorted system-rooms-first then by name.
	const channels = useMemo(
		() =>
			channelRooms
				.filter((room) => room.type === "channel")
				.sort((a, b) => {
					// Starred channels float to the top.
					if (!!a.is_starred !== !!b.is_starred) return a.is_starred ? -1 : 1;
					const order = (room: ChatRoom) => SYSTEM_ROOM_ORDER[room.slug] ?? 99;
					const ao = order(a);
					const bo = order(b);
					if (ao !== bo) return ao - bo;
					const an = (a.name || a.slug).toLowerCase();
					const bn = (b.name || b.slug).toLowerCase();
					return an.localeCompare(bn);
				}),
		[channelRooms],
	);

	// The channel a bare /chat or the legacy "channel-general" ref lands on.
	// New projects start with #general; client-room is a fallback for any
	// pre-existing projects that still have the old persona rooms.
	const defaultChannel = useMemo(
		() =>
			channels.find((room) => room.slug === "general") ??
			channels.find((room) => room.slug === "client-room") ??
			channels[0] ??
			null,
		[channels],
	);

	const resolvedTarget = useMemo<ResolvedTarget>(() => {
		const parsed = parseChatRef(chatRef);

		if (parsed.kind === "channel") {
			return { kind: "channel", roomId: defaultChannel?.id ?? null };
		}

		if (parsed.kind === "dm") {
			const memberExists = members.some(
				(member) => member.user_id === parsed.userId,
			);
			if (!memberExists && !membersQuery.isPending) {
				return { kind: "invalid" };
			}
			const linkedRoom = findRoomByCounterpart(rooms, parsed.userId);
			return {
				kind: "dm",
				userId: parsed.userId,
				roomId: linkedRoom?.id ?? null,
			};
		}

		if (parsed.kind === "room") {
			const room = rooms.find((item) => item.id === parsed.roomId);
			if (!room) {
				const transient = transientRoomTargets[parsed.roomId];
				if (transient) {
					return transient;
				}
				if (roomsQuery.isPending) {
					return { kind: "channel", roomId: defaultChannel?.id ?? null };
				}
				return { kind: "invalid" };
			}

			if (room.type === "channel") {
				return { kind: "channel", roomId: room.id };
			}

			const counterpart =
				room.participants.find(
					(participant) => participant.user_id !== user?.id,
				) ?? null;
			if (!counterpart?.user_id) {
				return { kind: "invalid" };
			}

			return {
				kind: "dm",
				userId: counterpart.user_id,
				roomId: room.id,
			};
		}

		return { kind: "invalid" };
	}, [
		chatRef,
		defaultChannel?.id,
		members,
		membersQuery.isPending,
		rooms,
		roomsQuery.isPending,
		transientRoomTargets,
		user?.id,
	]);

	const activeTarget: ActiveTarget =
		resolvedTarget.kind === "invalid"
			? { kind: "channel", roomId: defaultChannel?.id ?? null }
			: resolvedTarget;

	const activeRoomId = activeTarget.roomId;
	const conversationKey =
		activeTarget.kind === "channel"
			? `channel:${activeTarget.roomId ?? "default"}`
			: `dm:${activeTarget.userId}`;
	// Per-conversation composer draft (text + @mention picks), persisted to
	// localStorage and scoped by conversationKey — so switching conversations
	// restores that conversation's own unsent message instead of bleeding.
	const draft = useChatDraft(conversationKey);
	const messageInput = draft.text;
	const pendingMentions = draft.mentions;
	const addMention = draft.addMention;
	const messagesQuery = useRoomMessagesQuery(activeRoomId ?? "");
	const messages = flattenRoomMessages(messagesQuery.data);
	const optimisticMessages = optimisticByConversation[conversationKey] ?? [];
	const displayedMessages = useMemo(() => {
		return mergeThreadMessages(messages, optimisticMessages);
	}, [messages, optimisticMessages]);
	const activeRoom =
		activeRoomId != null
			? rooms.find((room) => room.id === activeRoomId)
			: null;
	const isInitialChatBootLoading =
		(roomsQuery.isPending ||
			membersQuery.isPending ||
			dmRoomsQuery.isPending) &&
		rooms.length === 0 &&
		members.length === 0;

	useEffect(() => {
		if (resolvedTarget.kind !== "invalid") return;
		if (roomsQuery.isPending || membersQuery.isPending) return;
		toast.error("Chat thread not found or unavailable. Showing #general.");
		void navigate({
			to: "/project/$projectId/chat/$chatRef",
			params: { projectId, chatRef: toChannelRef() },
			replace: true,
		});
	}, [
		membersQuery.isPending,
		navigate,
		projectId,
		resolvedTarget.kind,
		roomsQuery.isPending,
		toast,
	]);

	useEffect(() => {
		if (Object.keys(transientRoomTargets).length === 0) return;
		const next = { ...transientRoomTargets };
		let changed = false;
		for (const roomId of Object.keys(next)) {
			if (rooms.some((room) => room.id === roomId)) {
				delete next[roomId];
				changed = true;
			}
		}
		if (changed) {
			setTransientRoomTargets(next);
		}
	}, [rooms, transientRoomTargets]);

	const dmEntries = useMemo(() => {
		return members
			.map((member) => {
				const existingRoom = findRoomByCounterpart(rooms, member.user_id);
				return {
					member,
					roomId: existingRoom?.id ?? null,
					preview:
						messagePreviewText(existingRoom?.last_message) ||
						"Start a conversation",
					avatarUrl:
						member.user?.avatar_url ??
						existingRoom?.counterpart?.user?.avatar_url ??
						null,
					lastAt: existingRoom?.last_message?.created_at ?? "",
					lastSenderId: existingRoom?.last_message?.sender_id ?? "",
					hasUnread: existingRoom
						? hasUnreadForRoom(existingRoom, user?.id)
						: false,
				};
			})
			.sort((a, b) => {
				const aHasRoom = !!a.roomId;
				const bHasRoom = !!b.roomId;
				if (aHasRoom && !bHasRoom) return -1;
				if (!aHasRoom && bHasRoom) return 1;
				if (a.lastAt && b.lastAt) {
					return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
				}
				const aName = getDisplayName(a.member).toLowerCase();
				const bName = getDisplayName(b.member).toLowerCase();
				return aName.localeCompare(bName);
			});
	}, [members, rooms, user?.id]);

	const channelEntries = useMemo(
		() =>
			channels.map((room) => ({
				roomId: room.id,
				title: channelTitle(room),
				isPrivate: room.is_private,
				hasUnread: hasUnreadForRoom(room, user?.id),
				isStarred: !!room.is_starred,
			})),
		[channels, user?.id],
	);

	const activeDmMember =
		activeTarget.kind === "dm"
			? findMemberCandidate(members, activeTarget.userId)
			: null;

	// People mentionable in the active conversation: every project member in a
	// channel (the composer adds @everyone), or just the counterpart in a DM.
	const mentionables = useMemo<MentionCandidate[]>(() => {
		if (activeTarget.kind === "dm") {
			return activeDmMember
				? [
						{
							user_id: activeDmMember.user_id,
							name: getDisplayName(activeDmMember),
							avatar_url: activeDmMember.user?.avatar_url ?? null,
						},
					]
				: [];
		}
		return members.map((member) => ({
			user_id: member.user_id,
			name: getDisplayName(member),
			avatar_url: member.user?.avatar_url ?? null,
		}));
	}, [activeTarget.kind, activeDmMember, members]);

	// Pill spans for the composer's live input (Messenger-style highlight).
	const composerHighlightRanges = useMemo(
		() => resolveMentions(messageInput, pendingMentions),
		[messageInput, pendingMentions],
	);
	const activeProfileUserId =
		activeTarget.kind === "dm"
			? (activeDmMember?.user_id ?? null)
			: selectedProfileUserId;
	const senderMap = useMemo(() => {
		const map: Record<string, { name: string; avatarUrl?: string | null }> = {};

		for (const member of members) {
			map[member.user_id] = {
				name: getDisplayName(member),
				avatarUrl: member.user?.avatar_url ?? null,
			};
		}

		for (const participant of activeRoom?.participants ?? []) {
			if (!map[participant.user_id]) {
				map[participant.user_id] = {
					name:
						participant.user?.display_name ||
						participant.user?.email ||
						participant.user_id,
					avatarUrl: participant.user?.avatar_url ?? null,
				};
			}
		}

		if (user?.id && !map[user.id]) {
			map[user.id] = {
				name: profile?.display_name?.trim() || "You",
				avatarUrl: profile?.avatar_url ?? null,
			};
		}

		return map;
	}, [
		activeRoom?.participants,
		members,
		profile?.avatar_url,
		profile?.display_name,
		user?.id,
	]);

	useEffect(() => {
		if (activeTarget.kind === "dm") {
			setSelectedProfileUserId(activeDmMember?.user_id ?? null);
			return;
		}

		if (!selectedProfileUserId) return;
		const senderExists = displayedMessages.some(
			(message) => message.sender_id === selectedProfileUserId,
		);
		if (!senderExists) {
			setSelectedProfileUserId(null);
		}
	}, [
		activeTarget.kind,
		activeDmMember?.user_id,
		displayedMessages,
		selectedProfileUserId,
	]);

	// Realtime is handled by useProjectsRealtime + useDmRealtime above.

	const activeRoomForTyping =
		activeRoomId != null
			? rooms.find((room) => room.id === activeRoomId)
			: null;
	const { typingNames, startTyping, stopTyping } = useChatTyping({
		// Use room.project_id for channel typing (per-project channel) and a
		// "dm" sentinel for DM rooms so both peers join the same broadcast
		// channel regardless of the project they opened the DM from.
		projectId:
			activeRoomForTyping?.project_id ??
			(activeRoomForTyping?.type === "dm" ? "dm" : projectId),
		roomId: activeRoomId,
		userId: user?.id,
		displayName: user?.email || "You",
	});

	const activeMemberCandidate = useMemo(() => {
		if (!activeProfileUserId) return null;
		const fromMembers = findMemberCandidate(members, activeProfileUserId);
		if (fromMembers) return fromMembers;

		const fromParticipants = activeRoom?.participants.find(
			(participant) => participant.user_id === activeProfileUserId,
		);
		if (!fromParticipants) return null;

		return {
			user_id: fromParticipants.user_id,
			role: "freelancer" as ChatMemberRole,
			position: null,
			user: fromParticipants.user,
		} satisfies ChatMemberCandidate;
	}, [activeProfileUserId, activeRoom?.participants, members]);

	const activeProfileQuery = useQuery({
		queryKey: ["chat-member-profile", activeProfileUserId],
		queryFn: () => profileService.getProfile(activeProfileUserId as string),
		enabled: Boolean(isProfilePanelOpen && activeProfileUserId),
		staleTime: 5 * 60 * 1000,
		retry: 1,
	});

	const activeProfilePreview = useMemo(() => {
		if (!activeProfileUserId) return null;
		const name =
			activeMemberCandidate?.user?.display_name ||
			activeMemberCandidate?.user?.email ||
			senderMap[activeProfileUserId]?.name ||
			"Unknown member";
		const avatarUrl =
			activeMemberCandidate?.user?.avatar_url ||
			senderMap[activeProfileUserId]?.avatarUrl ||
			null;

		const positionLabel =
			activeMemberCandidate?.position?.trim() ||
			getRoleLabel(activeMemberCandidate?.role) ||
			"Member";

		return {
			userId: activeProfileUserId,
			name,
			roleLabel: getRoleLabel(activeMemberCandidate?.role),
			positionLabel,
			avatarUrl,
			bannerUrl: activeProfileQuery.data?.banner_url ?? null,
		};
	}, [
		activeProfileQuery.data?.banner_url,
		activeMemberCandidate,
		activeProfileUserId,
		senderMap,
	]);

	const scheduleMarkActiveRoomRead = useCallback(
		(delayMs = 550) => {
			if (!activeRoomId || !user?.id) return;
			if (!activeRoom || !hasUnreadForRoom(activeRoom, user.id)) return;
			if (inFlightReadRoomRef.current === activeRoomId) return;

			if (readMarkTimerRef.current) {
				clearTimeout(readMarkTimerRef.current);
			}

			const mutation =
				activeRoom.type === "dm" ? markDmReadMutation : markChannelReadMutation;

			readMarkTimerRef.current = setTimeout(() => {
				if (inFlightReadRoomRef.current === activeRoomId) return;
				inFlightReadRoomRef.current = activeRoomId;
				void mutation.mutateAsync({ roomId: activeRoomId }).finally(() => {
					if (inFlightReadRoomRef.current === activeRoomId) {
						inFlightReadRoomRef.current = null;
					}
				});
			}, delayMs);
		},
		[
			activeRoom,
			activeRoomId,
			markChannelReadMutation,
			markDmReadMutation,
			user?.id,
		],
	);

	const fetchOlderMessages = async () => {
		const viewport = messagesViewportRef.current;
		if (!viewport || !activeRoomId) return;
		if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return;
		if (fetchingOlderRef.current) return;

		fetchingOlderRef.current = true;
		prependAnchorRef.current = {
			roomId: activeRoomId,
			scrollTop: viewport.scrollTop,
			scrollHeight: viewport.scrollHeight,
		};

		try {
			await messagesQuery.fetchNextPage();
		} finally {
			requestAnimationFrame(() => {
				const nextViewport = messagesViewportRef.current;
				const anchor = prependAnchorRef.current;
				if (
					nextViewport &&
					anchor &&
					anchor.roomId === activeRoomId &&
					nextViewport.scrollHeight >= anchor.scrollHeight
				) {
					const delta = nextViewport.scrollHeight - anchor.scrollHeight;
					nextViewport.scrollTop = anchor.scrollTop + delta;
				}
				prependAnchorRef.current = null;
				fetchingOlderRef.current = false;
			});
		}
	};

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		const viewport = messagesViewportRef.current;
		if (!viewport) return;
		viewport.scrollTo({ top: viewport.scrollHeight, behavior });
	}, []);

	const handleJumpToLatest = useCallback(() => {
		shouldStickToBottomRef.current = true;
		setHasNewBelow(false);
		setShowJumpToLatest(false);
		scrollToBottom("smooth");
		scheduleMarkActiveRoomRead(300);
	}, [scrollToBottom, scheduleMarkActiveRoomRead]);

	// Scroll to a searched message (if it's in the loaded thread) and flash a
	// highlight. Messages further back than the loaded pages can't be located in
	// the DOM yet — the search result still shows their snippet.
	const handleJumpToMessage = useCallback((messageId: string) => {
		const viewport = messagesViewportRef.current;
		const target = viewport?.querySelector<HTMLElement>(
			`[data-message-id="${messageId}"]`,
		);
		if (target) {
			shouldStickToBottomRef.current = false;
			target.scrollIntoView({ block: "center", behavior: "smooth" });
		}
		setHighlightedMessageId(messageId);
		if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
		highlightTimerRef.current = setTimeout(
			() => setHighlightedMessageId(null),
			2200,
		);
	}, []);

	useEffect(
		() => () => {
			if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
		},
		[],
	);

	useEffect(() => {
		const viewport = messagesViewportRef.current;
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
			const atBottom = distanceToBottom <= 140;
			shouldStickToBottomRef.current = atBottom;
			setShowJumpToLatest(distanceToBottom > 200);
			if (atBottom) {
				setHasNewBelow(false);
				scheduleMarkActiveRoomRead(500);
			}
		};

		// No initial onScroll() call: a fresh thread starts at the top before the
		// scroll-to-bottom runs, and calling it here would wrongly clear the
		// stick-to-bottom default and skip the initial jump to the latest message.
		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, [
		activeRoomId,
		messagesQuery.hasNextPage,
		messagesQuery.isFetchingNextPage,
		scheduleMarkActiveRoomRead,
	]);

	useEffect(() => {
		shouldStickToBottomRef.current = true;
		prependAnchorRef.current = null;
		fetchingOlderRef.current = false;
		prevDisplayedCountRef.current = 0;
		setShowJumpToLatest(false);
		setHasNewBelow(false);
	}, [activeRoomId]);

	// Keep the thread pinned to the newest message while we should stick to the
	// bottom — re-running as content grows (async images, late layout, new
	// messages) so opening a room reliably lands on the latest message and
	// doesn't drift up as images finish loading.
	useEffect(() => {
		const viewport = messagesViewportRef.current;
		if (!viewport) return;

		const pinIfNeeded = () => {
			if (shouldStickToBottomRef.current) {
				viewport.scrollTop = viewport.scrollHeight;
			}
		};

		const observer = new ResizeObserver(pinIfNeeded);
		for (const child of Array.from(viewport.children)) observer.observe(child);
		return () => observer.disconnect();
	}, [activeRoomId, displayedMessages.length, scheduleMarkActiveRoomRead]);

	// Keep the thread at the latest message. Runs before paint (no flash of the
	// top). On a room switch we force the jump to the bottom once the new room's
	// content is present — independent of the previous room's stick state, since
	// the thread container is shared across conversations. Within the same room
	// we only stick when the user is already at the bottom.
	useLayoutEffect(() => {
		const viewport = messagesViewportRef.current;
		if (!viewport) return;

		const roomChanged = lastScrolledRoomRef.current !== activeRoomId;
		if (roomChanged) {
			if (displayedMessages.length === 0) return; // wait for content to load
			lastScrolledRoomRef.current = activeRoomId;
			shouldStickToBottomRef.current = true;
			viewport.scrollTop = viewport.scrollHeight;
			return;
		}

		if (shouldStickToBottomRef.current) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [activeRoomId, displayedMessages.length, typingNames.length]);

	// Surface a "New messages" hint if the thread grows while scrolled up.
	useEffect(() => {
		const prev = prevDisplayedCountRef.current;
		const next = displayedMessages.length;
		prevDisplayedCountRef.current = next;
		if (next > prev && !shouldStickToBottomRef.current) {
			setHasNewBelow(true);
		}
	}, [displayedMessages.length]);

	useEffect(() => {
		return () => {
			if (readMarkTimerRef.current) {
				clearTimeout(readMarkTimerRef.current);
			}
		};
	}, []);

	const isSending = sendChannelMutation.isPending || sendDmMutation.isPending;
	const sendMessage = async () => {
		if (!user || isSending || isUploadingAttachments) return;

		const content = messageInput.trim();
		const pending = pendingAttachments;
		if (!content && pending.length === 0) return;

		// Resolve composer picks into @mention spans against the exact trimmed text
		// we send, so offsets stay valid (the backend only re-trims, idempotently).
		const mentions = resolveMentions(content, pendingMentions);
		const mentionsPayload = mentions.length > 0 ? mentions : undefined;

		// Capture the reply target (if any) up front; it's cleared below so the
		// composer resets immediately, but the optimistic bubble keeps the quote.
		const replyToId = replyTarget?.id;
		const replyPreview = replyTarget
			? {
					id: replyTarget.id,
					sender_id: replyTarget.sender_id,
					content: replyTarget.content,
					deleted_at: replyTarget.deleted_at ?? null,
				}
			: null;

		// Local attachment previews so the optimistic bubble renders instantly;
		// image previews reuse the blob URL until the server's CDN URL arrives.
		const optimisticAttachments: ChatAttachment[] = pending.map(
			(attachment) => ({
				url: attachment.previewUrl ?? "",
				name: attachment.file.name,
				content_type: attachment.file.type || "application/octet-stream",
				size: attachment.file.size,
			}),
		);

		const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const latestDisplayedCreatedAt =
			displayedMessages.length > 0
				? displayedMessages[displayedMessages.length - 1]?.created_at
				: null;
		const latestDisplayedMs = latestDisplayedCreatedAt
			? new Date(latestDisplayedCreatedAt).getTime()
			: Number.NaN;
		const safeLatestDisplayedMs = Number.isFinite(latestDisplayedMs)
			? latestDisplayedMs
			: 0;
		const optimisticCreatedAtMs = Math.max(
			Date.now(),
			safeLatestDisplayedMs + 1,
		);
		const nowIso = new Date(optimisticCreatedAtMs).toISOString();
		const optimisticOrder =
			Date.now() * 1000 + (optimisticOrderCounterRef.current++ % 1000);

		const optimisticMessage: ThreadUiMessage = {
			id: tempId,
			render_key: tempId,
			optimistic_order: optimisticOrder,
			room_id: activeRoomId ?? "pending",
			project_id: activeTarget.kind === "channel" ? projectId : null,
			sender_id: user.id,
			content,
			attachments: optimisticAttachments,
			mentions,
			reply_to_id: replyToId ?? null,
			reply_to: replyPreview,
			created_at: nowIso,
			updated_at: nowIso,
			optimisticStatus: "sending",
		};

		setOptimisticByConversation((prev) => ({
			...prev,
			[conversationKey]: [...(prev[conversationKey] ?? []), optimisticMessage],
		}));
		draft.clear();
		setReplyTarget(null);
		setPendingAttachments([]);
		shouldStickToBottomRef.current = true;
		requestAnimationFrame(() => {
			const viewport = messagesViewportRef.current;
			if (!viewport) return;
			viewport.scrollTop = viewport.scrollHeight;
		});

		const markOptimisticFailed = () =>
			setOptimisticByConversation((prev) => ({
				...prev,
				[conversationKey]: (prev[conversationKey] ?? []).map((message) =>
					message.id === tempId
						? { ...message, optimisticStatus: "failed" as const }
						: message,
				),
			}));

		// Upload any queued files to R2 first; the message persists the CDN URLs.
		let uploadedAttachments: ChatAttachment[] = [];
		if (pending.length > 0) {
			setIsUploadingAttachments(true);
			try {
				uploadedAttachments = await Promise.all(
					pending.map((attachment) =>
						uploadService.uploadChatAttachment(attachment.file),
					),
				);
				// Map each uploaded image's CDN URL to the local blob we already have,
				// so the thread keeps rendering the blob (no reload/flash on swap).
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
				markOptimisticFailed();
				await stopTyping();
				return;
			} finally {
				setIsUploadingAttachments(false);
			}
		}

		const attachmentsPayload =
			uploadedAttachments.length > 0 ? uploadedAttachments : undefined;

		try {
			let result:
				| {
						room: ChatRoom;
						message: ChatMessage;
				  }
				| undefined;

			if (activeTarget.kind === "channel") {
				result = await sendChannelMutation.mutateAsync(
					activeTarget.roomId
						? {
								room_id: activeTarget.roomId,
								content,
								attachments: attachmentsPayload,
								mentions: mentionsPayload,
								reply_to_id: replyToId,
							}
						: {
								slug: "general",
								content,
								attachments: attachmentsPayload,
								mentions: mentionsPayload,
								reply_to_id: replyToId,
							},
				);
			} else if (activeTarget.roomId) {
				result = await sendDmMutation.mutateAsync({
					room_id: activeTarget.roomId,
					content,
					attachments: attachmentsPayload,
					mentions: mentionsPayload,
					reply_to_id: replyToId,
				});
			} else {
				result = await sendDmMutation.mutateAsync({
					recipient_id: activeTarget.userId,
					content,
					attachments: attachmentsPayload,
					mentions: mentionsPayload,
					reply_to_id: replyToId,
				});
			}

			if (result?.room) {
				setTransientRoomTargets((prev) => ({
					...prev,
					[result.room.id]:
						activeTarget.kind === "dm"
							? {
									kind: "dm",
									userId: activeTarget.userId,
									roomId: result.room.id,
								}
							: { kind: "channel", roomId: result.room.id },
				}));

				const nextRef = roomRef(result.room);
				if (chatRef !== nextRef) {
					void navigate({
						to: "/project/$projectId/chat/$chatRef",
						params: {
							projectId,
							chatRef: nextRef,
						},
						replace: true,
					});
				}
			}

			setOptimisticByConversation((prev) => ({
				...prev,
				[conversationKey]: (prev[conversationKey] ?? []).map((message) =>
					message.id === tempId
						? {
								id: result?.message?.id ?? message.id,
								room_id:
									result?.message?.room_id ??
									result?.room?.id ??
									message.room_id,
								project_id: result?.message?.project_id ?? message.project_id,
								sender_id: result?.message?.sender_id ?? message.sender_id,
								content: result?.message?.content ?? message.content,
								attachments:
									result?.message?.attachments ?? message.attachments,
								mentions: result?.message?.mentions ?? message.mentions,
								reply_to_id:
									result?.message?.reply_to_id ?? message.reply_to_id,
								reply_to: message.reply_to,
								created_at: result?.message?.created_at ?? message.created_at,
								updated_at: result?.message?.updated_at ?? message.updated_at,
								reactions: result?.message?.reactions ?? [],
								render_key: message.render_key ?? message.id,
								optimistic_order: message.optimistic_order,
							}
						: message,
				),
			}));
			await stopTyping();
		} catch {
			setOptimisticByConversation((prev) => ({
				...prev,
				[conversationKey]: (prev[conversationKey] ?? []).map((message) =>
					message.id === tempId
						? { ...message, optimisticStatus: "failed" }
						: message,
				),
			}));
			await stopTyping();
			return;
		}
	};

	const requestUnsend = async (
		message: ThreadUiMessage,
		bypassConfirm: boolean,
	) => {
		if (!activeRoomId) return;
		if (message.sender_id !== user?.id) return;

		if (bypassConfirm) {
			await deleteMessageMutation.mutateAsync({
				roomId: message.room_id || activeRoomId,
				messageId: message.id,
			});
			return;
		}

		setPendingUnsendMessage(message);
	};

	const handleStartEdit = (message: ThreadUiMessage) => {
		if (message.sender_id !== user?.id) return;
		if (message.optimisticStatus) return;
		setEditingMessageId(message.id);
	};

	const handleCancelEdit = () => setEditingMessageId(null);

	const handleSubmitEdit = async (
		message: ThreadUiMessage,
		nextContent: string,
	) => {
		const roomId = message.room_id || activeRoomId;
		if (!roomId) return;
		const trimmed = nextContent.trim();
		setEditingMessageId(null);
		if (!trimmed || trimmed === message.content.trim()) return;

		// Preserve existing @mentions whose "@Name" text survived the edit; offsets
		// are recomputed against the new content (no inline picker in v1).
		const picks = (message.mentions ?? []).map((mention) => ({
			user_id: mention.user_id,
			name: mention.name,
		}));
		const mentions = resolveMentions(trimmed, picks);

		try {
			await editMessageMutation.mutateAsync({
				roomId,
				messageId: message.id,
				content: trimmed,
				mentions: mentions.length > 0 ? mentions : undefined,
			});
		} catch {
			toast.error("Could not edit message. Please try again.");
		}
	};

	const handleCopyMessage = (message: ThreadUiMessage) => {
		const text = message.content ?? "";
		if (!text) return;
		void navigator.clipboard?.writeText(text).then(
			() => toast.success("Copied to clipboard"),
			() => toast.error("Could not copy message"),
		);
	};

	const handleReply = (message: ThreadUiMessage) => {
		if (message.deleted_at) return;
		setReplyTarget(message);
	};

	// Dropping a conversation cancels any in-progress edit/reply for the old room.
	useEffect(() => {
		setEditingMessageId(null);
		setReplyTarget(null);
	}, [conversationKey]);

	const isLoading = roomsQuery.isPending || membersQuery.isPending;
	const isThreadReady =
		resolvedTarget.kind !== "invalid" &&
		(!activeRoomId || !messagesQuery.isPending) &&
		!roomsQuery.isPending &&
		!membersQuery.isPending;
	const isRoomSwitchLoading = !isInitialChatBootLoading && !isThreadReady;
	const shouldShowCenterSkeleton =
		isInitialChatBootLoading || isRoomSwitchLoading;
	const shouldAnimateCenterSkeleton =
		isInitialChatBootLoading || showRoomSwitchSkeletonPulse;
	const hasRoomMessages = displayedMessages.length > 0;
	const activeTitle =
		activeTarget.kind === "channel"
			? channelTitle(activeRoom)
			: getDisplayName(activeDmMember);
	const activeSubtitle =
		activeTarget.kind === "channel"
			? activeRoom?.is_private
				? "Private channel"
				: "Channel"
			: "Direct Message";
	const activeAvatarUrl =
		activeTarget.kind === "dm" ? activeDmMember?.user?.avatar_url : null;

	useEffect(() => {
		threadReadyRef.current = isThreadReady;
	}, [isThreadReady]);

	useEffect(() => {
		if (roomSwitchSkeletonTimerRef.current) {
			clearTimeout(roomSwitchSkeletonTimerRef.current);
			roomSwitchSkeletonTimerRef.current = null;
		}

		setShowRoomSwitchSkeletonPulse(false);

		if (isInitialChatBootLoading || !isRoomSwitchLoading) return;

		roomSwitchSkeletonTimerRef.current = setTimeout(() => {
			if (!threadReadyRef.current) {
				setShowRoomSwitchSkeletonPulse(true);
			}
		}, 120);

		return () => {
			if (roomSwitchSkeletonTimerRef.current) {
				clearTimeout(roomSwitchSkeletonTimerRef.current);
				roomSwitchSkeletonTimerRef.current = null;
			}
		};
	}, [chatRef, isInitialChatBootLoading, isRoomSwitchLoading]);

	const selfPreview = useMemo(() => {
		if (!user?.id) return null;
		const persona = profile?.active_persona
			? profile.active_persona.charAt(0).toUpperCase() +
				profile.active_persona.slice(1)
			: "Member";
		return {
			name: profile?.display_name?.trim() || user.email || "You",
			avatarUrl: profile?.avatar_url ?? null,
			positionLabel: profile?.headline?.trim() || persona,
		};
	}, [
		user?.id,
		user?.email,
		profile?.active_persona,
		profile?.display_name,
		profile?.avatar_url,
		profile?.headline,
	]);

	return (
		<div className="app-fade-in h-full w-full">
			<ChatShell
				messagesContainerRef={
					shouldShowCenterSkeleton ? undefined : messagesViewportRef
				}
				centerShellOverride={
					shouldShowCenterSkeleton ? (
						<ChatCenterShellSkeleton animated={shouldAnimateCenterSkeleton} />
					) : undefined
				}
				sidebar={
					isInitialChatBootLoading ? (
						<ChatSidebarSkeleton />
					) : (
						<ChatSidebar
							dmEntries={dmEntries}
							members={members}
							currentUserId={user?.id}
							channels={channelEntries}
							activeChannelRoomId={
								activeTarget.kind === "channel" ? activeTarget.roomId : null
							}
							canCreateChannels={canCreateChannels}
							onCreateChannel={() => setShowCreateChannel(true)}
							onToggleChannelStar={(roomId) =>
								toggleRoomStarMutation.mutate({ roomId })
							}
							onSelectChannel={(roomId) => {
								void navigate({
									to: "/project/$projectId/chat/$chatRef",
									params: { projectId, chatRef: roomId },
								});
								setMobileView("chat");
							}}
							activeDmUserId={
								activeTarget.kind === "dm" ? activeTarget.userId : null
							}
							showPeoplePicker={showPeoplePicker}
							onTogglePeoplePicker={() =>
								setShowPeoplePicker((value) => !value)
							}
							onSelectMember={(userId, roomId) => {
								void navigate({
									to: "/project/$projectId/chat/$chatRef",
									params: {
										projectId,
										chatRef: roomId || toDmRef(userId),
									},
								});
								setMobileView("chat");
							}}
						/>
					)
				}
				header={
					<ChatHeader
						title={activeTitle}
						subtitle={activeSubtitle}
						isChannel={activeTarget.kind === "channel"}
						avatarUrl={activeAvatarUrl}
						isProfilePanelOpen={isProfilePanelOpen}
						onToggleProfilePanel={() => {
							setIsProfilePanelOpen((value) => {
								const next = !value;
								if (
									next &&
									activeTarget.kind === "dm" &&
									activeDmMember?.user_id
								) {
									setSelectedProfileUserId(activeDmMember.user_id);
								}
								setMobileView(next ? "info" : "chat");
								return next;
							});
						}}
						onBack={() => setMobileView("list")}
					/>
				}
				messages={
					<MessageList
						isLoading={isLoading}
						hasMessages={hasRoomMessages}
						messages={displayedMessages}
						senderMap={senderMap}
						currentUserId={user?.id}
						highlightedMessageId={highlightedMessageId}
						editingMessageId={editingMessageId}
						selectedSenderId={null}
						onSelectSender={undefined}
						onToggleReaction={(messageId, roomId, emoji) => {
							void toggleReactionMutation.mutateAsync({
								messageId,
								roomId,
								emoji,
							});
						}}
						onRequestUnsend={(message, bypassConfirm) => {
							void requestUnsend(message, bypassConfirm);
						}}
						onStartEdit={handleStartEdit}
						onSubmitEdit={(message, content) => {
							void handleSubmitEdit(message, content);
						}}
						onCancelEdit={handleCancelEdit}
						onCopy={handleCopyMessage}
						onReply={handleReply}
						onJumpToMessage={handleJumpToMessage}
						hasNextPage={!!messagesQuery.hasNextPage}
						isFetchingNextPage={messagesQuery.isFetchingNextPage}
						emptyTitle={
							activeTarget.kind === "channel"
								? `Start ${channelTitle(activeRoom)}`
								: `Message ${getDisplayName(activeDmMember)}`
						}
						emptySubtitle={
							activeTarget.kind === "channel"
								? "Be the first to post in this channel."
								: "This DM room is created when you send the first message."
						}
					/>
				}
				messagesOverlay={
					<ScrollToLatestButton
						show={showJumpToLatest}
						hasNew={hasNewBelow}
						onClick={handleJumpToLatest}
					/>
				}
				typingIndicator={<TypingIndicator names={typingNames} />}
				profilePanel={
					isInitialChatBootLoading ? (
						<ChatProfilePanelSkeleton />
					) : (
						<ChatInfoPanel
							mode={activeTarget.kind}
							roomId={activeRoomId}
							room={
								activeTarget.kind === "channel" ? (activeRoom ?? null) : null
							}
							projectId={projectId}
							members={members}
							currentUserId={user?.id}
							currentUser={selfPreview}
							canManage={canManageChannels}
							dmMember={
								activeTarget.kind === "dm" ? activeProfilePreview : null
							}
							isOpen={isProfilePanelOpen}
							onToggle={() => {
								setIsProfilePanelOpen((value) => {
									const next = !value;
									setMobileView(next ? "info" : "chat");
									return next;
								});
							}}
							onClose={() => {
								setIsProfilePanelOpen(false);
								setMobileView("chat");
							}}
							onJumpToMessage={handleJumpToMessage}
							onExitChannel={() => {
								if (defaultChannel) {
									void navigate({
										to: "/project/$projectId/chat/$chatRef",
										params: { projectId, chatRef: defaultChannel.id },
									});
								}
							}}
						/>
					)
				}
				isProfilePanelOpen={
					isInitialChatBootLoading ? true : isProfilePanelOpen
				}
				onCloseProfilePanel={() => {
					setIsProfilePanelOpen(false);
					setMobileView("chat");
				}}
				mobileView={mobileView}
				composer={
					<>
						{replyTarget && (
							<div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 md:px-6">
								<span className="shrink-0 font-medium text-slate-500">
									Replying to{" "}
									<span className="text-slate-700">
										{senderMap[replyTarget.sender_id]?.name ?? "Unknown"}
									</span>
								</span>
								<span className="min-w-0 flex-1 truncate text-slate-400">
									{replyTarget.content.trim() || "Attachment"}
								</span>
								<button
									type="button"
									onClick={() => setReplyTarget(null)}
									className="shrink-0 rounded px-1.5 py-0.5 font-medium text-slate-400 hover:bg-slate-200 hover:text-slate-600"
									aria-label="Cancel reply"
								>
									✕
								</button>
							</div>
						)}
						<ChatComposer
							value={messageInput}
							attachments={pendingAttachments}
							mentionables={mentionables}
							canMention={canMentionMembers}
							highlightRanges={composerHighlightRanges}
							onAddMention={addMention}
							onAddFiles={addFiles}
							onRemoveAttachment={removeAttachment}
							isUploading={isUploadingAttachments}
							onChange={(nextValue) => {
								draft.setText(nextValue);
								if (nextValue.trim()) {
									void startTyping();
								} else {
									void stopTyping();
								}
							}}
							onBlur={() => {
								void stopTyping();
							}}
							onSend={() => {
								void sendMessage();
							}}
							isSending={isSending}
							placeholder={
								activeTarget.kind === "channel"
									? `Message ${channelTitle(activeRoom)}`
									: `Message ${getDisplayName(activeDmMember)}`
							}
						/>
					</>
				}
			/>
			<CreateChannelModal
				open={showCreateChannel}
				members={members}
				currentUserId={user?.id}
				existingChannels={channels.map((room) => ({
					slug: room.slug,
					name: room.name,
				}))}
				isSubmitting={createChannelMutation.isPending}
				onClose={() => {
					if (createChannelMutation.isPending) return;
					setShowCreateChannel(false);
				}}
				onCreate={async ({ name, isPrivate, memberIds }) => {
					try {
						const room = await createChannelMutation.mutateAsync({
							name,
							is_private: isPrivate,
							memberIds,
						});
						setShowCreateChannel(false);
						void navigate({
							to: "/project/$projectId/chat/$chatRef",
							params: { projectId, chatRef: room.id },
						});
					} catch {
						toast.error("Could not create channel. Please try again.");
					}
				}}
			/>
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
					const targetMessage = pendingUnsendMessage;
					if (!targetMessage) return;
					setPendingUnsendMessage(null);
					void deleteMessageMutation.mutateAsync({
						roomId: targetMessage.room_id || activeRoomId || "",
						messageId: targetMessage.id,
					});
				}}
			/>
		</div>
	);
}
