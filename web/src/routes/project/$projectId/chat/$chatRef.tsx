import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useProfile, useUser } from "@/stores/authStore";
import { useChatTyping } from "@/hooks/useChatTyping";
import { profileService } from "@/services/profile.service";
import {
  findMemberCandidate,
  findRoomByCounterpart,
  flattenRoomMessages,
  useDeleteChatMessageMutation,
  useProjectChatMembersQuery,
  useProjectChatRoomsQuery,
  useRoomMessagesQuery,
  useSendChatMessageMutation,
  useToggleChatReactionMutation,
  useMarkRoomReadMutation,
} from "@/hooks/useChatQueries";
import { chatKeys } from "@/queries/chat";
import {
  ChatComposer,
  ChatHeader,
  ChatProfilePanel,
  ChatProfilePanelSkeleton,
  ChatShell,
  ChatSidebar,
  ChatSidebarSkeleton,
  ChatCenterShellSkeleton,
  ChatUnsendConfirmModal,
  MessageList,
  TypingIndicator,
} from "@/components/project/chat";
import {
  parseChatRef,
  roomRef,
  toChannelRef,
  toDmRef,
} from "@/components/project/chat/chatRef";
import type {
  ChatMemberCandidate,
  ChatMessage,
  ChatMemberRole,
  ChatRoom,
} from "@/services/chat.service";
import {
  mergeThreadMessages,
  type ThreadUiMessage,
} from "@/components/project/chat/thread";
import { useToast } from "@/hooks/useToast";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";

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
  | { kind: "channel"; slug: "general"; roomId: string | null }
  | { kind: "dm"; userId: string; roomId: string | null };
type ResolvedTarget = ActiveTarget | { kind: "invalid" };

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
    room.participants.find((participant) => participant.user_id === userId)?.last_read_at ??
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
  const queryClient = useQueryClient();
  const user = useUser();
  const profile = useProfile();
  const toast = useToast();
  const [showPeoplePicker, setShowPeoplePicker] = useState(false);
  const [showSidebarMobile, setShowSidebarMobile] = useState(false);
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(true);
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(
    null,
  );
  const [messageInput, setMessageInput] = useState("");
  const optimisticOrderCounterRef = useRef(0);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
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
  const sendMessageMutation = useSendChatMessageMutation(projectId);
  const toggleReactionMutation = useToggleChatReactionMutation(projectId);
  const deleteMessageMutation = useDeleteChatMessageMutation(projectId);
  const markRoomReadMutation = useMarkRoomReadMutation(projectId, user?.id);
  const [pendingUnsendMessage, setPendingUnsendMessage] = useState<ThreadUiMessage | null>(
    null,
  );
  const readMarkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightReadRoomRef = useRef<string | null>(null);
  const roomSwitchSkeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadReadyRef = useRef(false);
  const [showRoomSwitchSkeletonPulse, setShowRoomSwitchSkeletonPulse] = useState(false);

  const rooms = roomsQuery.data ?? [];
  const members = membersQuery.data ?? [];

  const generalRoomBySlug = useMemo(
    () => rooms.find((room) => room.type === "channel" && room.slug === "general") ?? null,
    [rooms],
  );

  const resolvedTarget = useMemo<ResolvedTarget>(() => {
    const parsed = parseChatRef(chatRef);

    if (parsed.kind === "channel") {
      return {
        kind: "channel",
        slug: "general",
        roomId: generalRoomBySlug?.id ?? null,
      };
    }

    if (parsed.kind === "dm") {
      const memberExists = members.some((member) => member.user_id === parsed.userId);
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
          return {
            kind: "channel",
            slug: "general",
            roomId: generalRoomBySlug?.id ?? null,
          };
        }
        return { kind: "invalid" };
      }

      if (room.type === "channel") {
        return {
          kind: "channel",
          slug: "general",
          roomId: room.id,
        };
      }

      const counterpart =
        room.participants.find((participant) => participant.user_id !== user?.id) ?? null;
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
    generalRoomBySlug?.id,
    members,
    membersQuery.isPending,
    rooms,
    roomsQuery.isPending,
    transientRoomTargets,
    user?.id,
  ]);

  const activeTarget: ActiveTarget =
    resolvedTarget.kind === "invalid"
      ? { kind: "channel", slug: "general", roomId: generalRoomBySlug?.id ?? null }
      : resolvedTarget;

  const activeRoomId = activeTarget.roomId;
  const conversationKey =
    activeTarget.kind === "channel"
      ? "channel:general"
      : `dm:${activeTarget.userId}`;
  const messagesQuery = useRoomMessagesQuery(projectId, activeRoomId ?? "");
  const messages = flattenRoomMessages(messagesQuery.data);
  const optimisticMessages = optimisticByConversation[conversationKey] ?? [];
  const displayedMessages = useMemo(() => {
    return mergeThreadMessages(messages, optimisticMessages);
  }, [messages, optimisticMessages]);
  const activeRoom =
    activeRoomId != null ? rooms.find((room) => room.id === activeRoomId) : null;
  const isInitialChatBootLoading =
    (roomsQuery.isPending || membersQuery.isPending) &&
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
          preview: existingRoom?.last_message?.content || "Start a conversation",
          avatarUrl:
            member.user?.avatar_url ??
            existingRoom?.counterpart?.user?.avatar_url ??
            null,
          lastAt: existingRoom?.last_message?.created_at ?? "",
          lastSenderId: existingRoom?.last_message?.sender_id ?? "",
          hasUnread: existingRoom ? hasUnreadForRoom(existingRoom, user?.id) : false,
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

  const generalHasUnread = generalRoomBySlug
    ? hasUnreadForRoom(generalRoomBySlug, user?.id)
    : false;

  const activeDmMember =
    activeTarget.kind === "dm"
      ? findMemberCandidate(members, activeTarget.userId)
      : null;
  const activeProfileUserId =
    activeTarget.kind === "dm" ? activeDmMember?.user_id ?? null : selectedProfileUserId;
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
  }, [activeRoom?.participants, members, profile?.avatar_url, profile?.display_name, user?.id]);

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

  useEffect(() => {
    if (!projectId) return;

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
          void queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
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

    const readPointerChannel = user?.id
      ? supabase
          .channel(`chat-room-read-pointers:${projectId}:${user.id}`)
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
              if (!userId || userId !== user.id) return;
              void queryClient.invalidateQueries({
                queryKey: chatKeys.rooms(projectId),
              });
            },
          )
          .subscribe()
      : null;

    return () => {
      void supabase.removeChannel(messageChannel);
      void supabase.removeChannel(reactionChannel);
      if (readPointerChannel) {
        void supabase.removeChannel(readPointerChannel);
      }
    };
  }, [projectId, queryClient, user?.id]);

  const { typingNames, startTyping, stopTyping } = useChatTyping({
    projectId,
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
  }, [activeProfileQuery.data?.banner_url, activeMemberCandidate, activeProfileUserId, senderMap]);

  const projectMemberPreviews = useMemo(() => {
    return members.map((member) => {
      const name = getDisplayName(member);
      return {
        userId: member.user_id,
        name,
        roleLabel: getRoleLabel(member.role),
        positionLabel: member.position?.trim() || getRoleLabel(member.role),
        avatarUrl: member.user?.avatar_url ?? null,
        bannerUrl: null,
      };
    });
  }, [members]);

  const scheduleMarkActiveRoomRead = useCallback(
    (delayMs = 550) => {
      if (!activeRoomId || !user?.id) return;
      if (!activeRoom || !hasUnreadForRoom(activeRoom, user.id)) return;
      if (inFlightReadRoomRef.current === activeRoomId) return;

      if (readMarkTimerRef.current) {
        clearTimeout(readMarkTimerRef.current);
      }

      readMarkTimerRef.current = setTimeout(() => {
        if (inFlightReadRoomRef.current === activeRoomId) return;
        inFlightReadRoomRef.current = activeRoomId;
        void markRoomReadMutation
          .mutateAsync({ roomId: activeRoomId })
          .finally(() => {
            if (inFlightReadRoomRef.current === activeRoomId) {
              inFlightReadRoomRef.current = null;
            }
          });
      }, delayMs);
    },
    [activeRoom, activeRoomId, markRoomReadMutation, user?.id],
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
      shouldStickToBottomRef.current = distanceToBottom <= 140;
      if (distanceToBottom <= 140) {
        scheduleMarkActiveRoomRead(500);
      }
    };

    onScroll();
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
  }, [activeRoomId]);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    if (!shouldStickToBottomRef.current) return;

    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
      scheduleMarkActiveRoomRead(450);
    });
  }, [
    activeRoomId,
    displayedMessages.length,
    typingNames.length,
    scheduleMarkActiveRoomRead,
  ]);

  useEffect(() => {
    return () => {
      if (readMarkTimerRef.current) {
        clearTimeout(readMarkTimerRef.current);
      }
    };
  }, []);

  const sendMessage = async () => {
    if (!user || sendMessageMutation.isPending) return;

    const content = messageInput.trim();
    if (!content) return;
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
    const optimisticCreatedAtMs = Math.max(Date.now(), safeLatestDisplayedMs + 1);
    const nowIso = new Date(optimisticCreatedAtMs).toISOString();
    const optimisticOrder =
      Date.now() * 1000 + (optimisticOrderCounterRef.current++ % 1000);

    const optimisticMessage: ThreadUiMessage = {
      id: tempId,
      render_key: tempId,
      optimistic_order: optimisticOrder,
      room_id: activeRoomId ?? "pending",
      project_id: projectId,
      sender_id: user.id,
      content,
      created_at: nowIso,
      updated_at: nowIso,
      optimisticStatus: "sending",
    };

    setOptimisticByConversation((prev) => ({
      ...prev,
      [conversationKey]: [...(prev[conversationKey] ?? []), optimisticMessage],
    }));
    setMessageInput("");
    shouldStickToBottomRef.current = true;
    requestAnimationFrame(() => {
      const viewport = messagesViewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
    });

    try {
      let result:
        | {
            room: ChatRoom;
            message: ChatMessage;
          }
        | undefined;

      if (activeTarget.kind === "channel") {
        result = await sendMessageMutation.mutateAsync({
          kind: "channel",
          slug: "general",
          content,
        });
      } else if (activeTarget.roomId) {
        result = await sendMessageMutation.mutateAsync({
          room_id: activeTarget.roomId,
          content,
        });
      } else {
        result = await sendMessageMutation.mutateAsync({
          kind: "dm",
          recipient_id: activeTarget.userId,
          content,
        });
      }

      if (result?.room) {
        setTransientRoomTargets((prev) => ({
          ...prev,
          [result.room.id]: {
            kind: activeTarget.kind,
            ...(activeTarget.kind === "dm"
              ? { userId: activeTarget.userId }
              : { slug: "general" }),
            roomId: result.room.id,
          } as ActiveTarget,
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
                room_id: result?.message?.room_id ?? result?.room?.id ?? message.room_id,
                project_id: result?.message?.project_id ?? message.project_id,
                sender_id: result?.message?.sender_id ?? message.sender_id,
                content: result?.message?.content ?? message.content,
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

  const isLoading = roomsQuery.isPending || membersQuery.isPending;
  const isThreadReady =
    resolvedTarget.kind !== "invalid" &&
    (!activeRoomId || !messagesQuery.isPending) &&
    !roomsQuery.isPending &&
    !membersQuery.isPending;
  const isRoomSwitchLoading = !isInitialChatBootLoading && !isThreadReady;
  const shouldShowCenterSkeleton = isInitialChatBootLoading || isRoomSwitchLoading;
  const shouldAnimateCenterSkeleton =
    isInitialChatBootLoading || showRoomSwitchSkeletonPulse;
  const hasRoomMessages = displayedMessages.length > 0;
  const activeTitle =
    activeTarget.kind === "channel" ? "#general" : getDisplayName(activeDmMember);
  const activeSubtitle = activeTarget.kind === "channel" ? "Channel" : "Direct Message";
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

  return (
    <div className="app-fade-in h-full w-full">
      <ChatShell
      messagesContainerRef={shouldShowCenterSkeleton ? undefined : messagesViewportRef}
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
            show={showSidebarMobile}
            dmEntries={dmEntries}
            members={members}
            currentUserId={user?.id}
            generalHasUnread={generalHasUnread}
            activeDmUserId={activeTarget.kind === "dm" ? activeTarget.userId : null}
            activeChannel={activeTarget.kind === "channel"}
            showPeoplePicker={showPeoplePicker}
            onTogglePeoplePicker={() => setShowPeoplePicker((value) => !value)}
            onSelectGeneral={() => {
              void navigate({
                to: "/project/$projectId/chat/$chatRef",
                params: {
                  projectId,
                  chatRef: toChannelRef(),
                },
              });
              setShowSidebarMobile(false);
            }}
            onSelectMember={(userId, roomId) => {
              void navigate({
                to: "/project/$projectId/chat/$chatRef",
                params: {
                  projectId,
                  chatRef: roomId || toDmRef(userId),
                },
              });
              setShowSidebarMobile(false);
            }}
            onCloseMobile={() => setShowSidebarMobile(false)}
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
              if (next && activeTarget.kind === "dm" && activeDmMember?.user_id) {
                setSelectedProfileUserId(activeDmMember.user_id);
              }
              return next;
            });
          }}
          onOpenSidebar={() => setShowSidebarMobile(true)}
        />
      }
      messages={
        <MessageList
          isLoading={isLoading}
          hasMessages={hasRoomMessages}
          messages={displayedMessages}
          senderMap={senderMap}
          currentUserId={user?.id}
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
          hasNextPage={!!messagesQuery.hasNextPage}
          isFetchingNextPage={messagesQuery.isFetchingNextPage}
          emptyTitle={
            activeTarget.kind === "channel"
              ? "Start #general"
              : `Message ${getDisplayName(activeDmMember)}`
          }
          emptySubtitle={
            activeTarget.kind === "channel"
              ? "This channel appears in recents after the first message."
              : "This DM room is created when you send the first message."
          }
        />
      }
      typingIndicator={<TypingIndicator names={typingNames} />}
      profilePanel={
        isInitialChatBootLoading ? (
          <ChatProfilePanelSkeleton />
        ) : (
          <ChatProfilePanel
            member={activeProfilePreview}
            isOpen={isProfilePanelOpen}
            mode={activeTarget.kind}
            projectMembers={projectMemberPreviews}
            onToggle={() => setIsProfilePanelOpen((value) => !value)}
            onClose={() => setIsProfilePanelOpen(false)}
          />
        )
      }
      isProfilePanelOpen={isInitialChatBootLoading ? true : isProfilePanelOpen}
      onCloseProfilePanel={() => setIsProfilePanelOpen(false)}
      composer={
        <ChatComposer
          value={messageInput}
          onChange={(nextValue) => {
            setMessageInput(nextValue);
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
          isSending={sendMessageMutation.isPending}
          placeholder={
            activeTarget.kind === "channel"
              ? "Message #general"
              : `Message ${getDisplayName(activeDmMember)}`
          }
        />
      }
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
