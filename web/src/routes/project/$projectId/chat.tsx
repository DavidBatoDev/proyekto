import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/stores/authStore";
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
  ChatShell,
  ChatSidebar,
  ChatUnsendConfirmModal,
  MessageList,
} from "@/components/project/chat";
import type {
  ChatMemberCandidate,
  ChatMemberRole,
  ChatRoom,
} from "@/services/chat.service";
import type { ThreadUiMessage } from "@/components/project/chat/thread";

export const Route = createFileRoute("/project/$projectId/chat")({
  component: ChatPage,
});

type ActiveTarget =
  | { kind: "channel"; slug: "general"; roomId: string | null }
  | { kind: "dm"; userId: string; roomId: string | null };

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
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const user = useUser();
  const [showPeoplePicker, setShowPeoplePicker] = useState(false);
  const [showSidebarMobile, setShowSidebarMobile] = useState(false);
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(true);
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<string | null>(
    null,
  );
  const [messageInput, setMessageInput] = useState("");
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

  const rooms = roomsQuery.data ?? [];
  const members = membersQuery.data ?? [];

  const [activeTarget, setActiveTarget] = useState<ActiveTarget>({
    kind: "channel",
    slug: "general",
    roomId: null,
  });

  useEffect(() => {
    const generalRoom = rooms.find(
      (room) => room.type === "channel" && room.slug === "general",
    );

    setActiveTarget((previous) => {
      if (previous.kind === "channel") {
        return { ...previous, roomId: generalRoom?.id ?? null };
      }

      const linkedRoom = findRoomByCounterpart(rooms, previous.userId);
      return { ...previous, roomId: linkedRoom?.id ?? null };
    });
  }, [rooms]);

  const activeRoomId = activeTarget.roomId;
  const conversationKey =
    activeTarget.kind === "channel"
      ? "channel:general"
      : `dm:${activeTarget.userId}`;
  const messagesQuery = useRoomMessagesQuery(projectId, activeRoomId ?? "");
  const messages = flattenRoomMessages(messagesQuery.data);
  const optimisticMessages = optimisticByConversation[conversationKey] ?? [];
  const displayedMessages = useMemo(() => {
    return [...messages, ...optimisticMessages].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messages, optimisticMessages]);
  const activeRoom =
    activeRoomId != null ? rooms.find((room) => room.id === activeRoomId) : null;

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

  const generalRoom = useMemo(
    () => rooms.find((room) => room.type === "channel" && room.slug === "general") ?? null,
    [rooms],
  );
  const generalHasUnread = generalRoom ? hasUnreadForRoom(generalRoom, user?.id) : false;

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
        name: user.email || "You",
        avatarUrl: null,
      };
    }

    return map;
  }, [members, activeRoom?.participants, user?.id, user?.email]);

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
    const nowIso = new Date().toISOString();

    const optimisticMessage: ThreadUiMessage = {
      id: tempId,
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

    try {
      let result:
        | {
            room: ChatRoom;
            message: unknown;
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
        if (activeTarget.kind === "channel") {
          setActiveTarget({
            kind: "channel",
            slug: "general",
            roomId: result.room.id,
          });
        } else {
          setActiveTarget((prev) =>
            prev.kind === "dm" ? { ...prev, roomId: result.room.id } : prev,
          );
        }
      }

      setOptimisticByConversation((prev) => ({
        ...prev,
        [conversationKey]: (prev[conversationKey] ?? []).filter(
          (message) => message.id !== tempId,
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
  const hasRoomMessages = displayedMessages.length > 0;
  const activeTitle =
    activeTarget.kind === "channel" ? "#general" : getDisplayName(activeDmMember);
  const activeSubtitle = activeTarget.kind === "channel" ? "Channel" : "Direct Message";
  const activeAvatarUrl =
    activeTarget.kind === "dm" ? activeDmMember?.user?.avatar_url : null;

  return (
    <>
      <ChatShell
      messagesContainerRef={messagesViewportRef}
      sidebar={
        <ChatSidebar
          show={showSidebarMobile}
          dmEntries={dmEntries}
          members={members}
          generalHasUnread={generalHasUnread}
          activeDmUserId={activeTarget.kind === "dm" ? activeTarget.userId : null}
          activeChannel={activeTarget.kind === "channel"}
          showPeoplePicker={showPeoplePicker}
          onTogglePeoplePicker={() => setShowPeoplePicker((value) => !value)}
          onSelectGeneral={() => {
            setActiveTarget({
              kind: "channel",
              slug: "general",
              roomId:
                rooms.find((room) => room.type === "channel" && room.slug === "general")
                  ?.id ?? null,
            });
            setShowSidebarMobile(false);
          }}
          onSelectMember={(userId, roomId) => {
            setActiveTarget({
              kind: "dm",
              userId,
              roomId,
            });
            setShowSidebarMobile(false);
          }}
          onCloseMobile={() => setShowSidebarMobile(false)}
        />
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
          selectedSenderId={
            activeTarget.kind === "channel" ? selectedProfileUserId : null
          }
          onSelectSender={(userId) => {
            if (activeTarget.kind !== "channel") return;
            setSelectedProfileUserId(userId);
            setIsProfilePanelOpen(true);
          }}
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
          typingNames={typingNames}
        />
      }
      profilePanel={
        <ChatProfilePanel
          member={activeProfilePreview}
          isOpen={isProfilePanelOpen}
          mode={activeTarget.kind}
          projectMembers={projectMemberPreviews}
          onToggle={() => setIsProfilePanelOpen((value) => !value)}
          onClose={() => setIsProfilePanelOpen(false)}
        />
      }
      isProfilePanelOpen={isProfilePanelOpen}
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
    </>
  );
}
