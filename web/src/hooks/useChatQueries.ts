import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  chatService,
  type ChatMemberCandidate,
  type ChatMessage,
  type ChatMessagesPage,
  type ChatRoom,
} from "@/services/chat.service";
import {
  chatKeys,
  fetchDmEligibleMembers,
  fetchDmRooms,
  fetchProjectChatMembers,
  fetchProjectChatRooms,
  fetchRoomMessages,
} from "@/queries/chat";

export function useProjectChatRoomsQuery(projectId: string) {
  return useQuery({
    queryKey: chatKeys.rooms(projectId),
    queryFn: () => fetchProjectChatRooms(projectId),
    enabled: Boolean(projectId),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useDmRoomsQuery(enabled = true) {
  return useQuery({
    queryKey: chatKeys.dmRooms(),
    queryFn: () => fetchDmRooms(),
    enabled,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useProjectChatMembersQuery(projectId: string) {
  return useQuery({
    queryKey: chatKeys.members(projectId),
    queryFn: () => fetchProjectChatMembers(projectId),
    enabled: Boolean(projectId),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useDmEligibleMembersQuery(projectId: string) {
  return useQuery({
    queryKey: chatKeys.dmEligibleMembers(projectId),
    queryFn: () => fetchDmEligibleMembers(projectId),
    enabled: Boolean(projectId),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useRoomMessagesQuery(roomId: string, limit = 30) {
  return useInfiniteQuery({
    queryKey: chatKeys.roomMessages(roomId),
    queryFn: ({ pageParam }) =>
      fetchRoomMessages(roomId, {
        before: pageParam as string | undefined,
        limit,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before || undefined,
    enabled: Boolean(roomId),
    staleTime: 5 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/**
 * Send a channel message (project-scoped). Invalidates the project's room
 * list and the room's message thread.
 */
export function useSendChannelMessageMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      payload:
        | { room_id: string; content: string }
        | { slug?: "general"; content: string },
    ) => chatService.sendChannelMessage(projectId, payload),
    // Keep `isPending` tied to the POST only. The thread already shows the
    // optimistic message and realtime reconciles it, so we refresh the room
    // list without awaiting and skip the redundant thread refetch — this
    // unlocks the composer the moment the server responds instead of after two
    // refetches complete.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
    },
  });
}

/** Send a DM message (global). Invalidates the DM room list. */
export function useSendDmMessageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      payload:
        | { room_id: string; content: string }
        | { recipient_id: string; content: string },
    ) => chatService.sendDmMessage(payload),
    // See useSendChannelMessageMutation: non-blocking refresh so the composer
    // unlocks on POST completion; realtime handles thread reconciliation.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.dmRooms() });
    },
  });
}

export function useToggleChatReactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { roomId: string; messageId: string; emoji: string }) =>
      chatService.toggleReaction(payload.messageId, payload.emoji),
    onMutate: async (payload) => {
      const key = chatKeys.roomMessages(payload.roomId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous =
        queryClient.getQueryData<InfiniteData<ChatMessagesPage>>(key);

      queryClient.setQueryData<InfiniteData<ChatMessagesPage>>(key, (current) => {
        if (!current) return current;

        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            messages: page.messages.map((message) => {
              if (message.id !== payload.messageId) return message;
              const currentReactions = [...(message.reactions ?? [])];
              const index = currentReactions.findIndex(
                (reaction) => reaction.emoji === payload.emoji,
              );

              if (index === -1) {
                currentReactions.push({
                  emoji: payload.emoji,
                  count: 1,
                  reacted_by_me: true,
                });
              } else {
                const reaction = currentReactions[index];
                if (reaction.reacted_by_me) {
                  const nextCount = Math.max(0, reaction.count - 1);
                  if (nextCount === 0) {
                    currentReactions.splice(index, 1);
                  } else {
                    currentReactions[index] = {
                      ...reaction,
                      count: nextCount,
                      reacted_by_me: false,
                    };
                  }
                } else {
                  currentReactions[index] = {
                    ...reaction,
                    count: reaction.count + 1,
                    reacted_by_me: true,
                  };
                }
              }

              return {
                ...message,
                reactions: currentReactions.sort((a, b) =>
                  a.emoji.localeCompare(b.emoji),
                ),
              };
            }),
          })),
        };
      });

      return { previous, key };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: async (_data, _error, payload) => {
      await queryClient.invalidateQueries({
        queryKey: chatKeys.roomMessages(payload.roomId),
      });
    },
  });
}

export function useDeleteChatMessageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { roomId: string; messageId: string }) =>
      chatService.deleteMessage(payload.messageId),
    onMutate: async (payload) => {
      const key = chatKeys.roomMessages(payload.roomId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous =
        queryClient.getQueryData<InfiniteData<ChatMessagesPage>>(key);

      queryClient.setQueryData<InfiniteData<ChatMessagesPage>>(key, (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            messages: page.messages.filter((message) => message.id !== payload.messageId),
          })),
        };
      });

      return { previous, key };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: async (_data, _error, payload) => {
      await queryClient.invalidateQueries({
        queryKey: chatKeys.roomMessages(payload.roomId),
      });
    },
  });
}

/**
 * Mark a room as read. Optimistically updates whichever room list query the
 * caller targets (channel rooms by projectId, or global DM rooms).
 */
export function useMarkRoomReadMutation(
  options: {
    projectId?: string;
    isDm?: boolean;
    currentUserId?: string;
  } = {},
) {
  const queryClient = useQueryClient();
  const { projectId, isDm, currentUserId } = options;

  const listKey = isDm
    ? chatKeys.dmRooms()
    : projectId
      ? chatKeys.rooms(projectId)
      : null;

  return useMutation({
    mutationFn: (payload: { roomId: string }) =>
      chatService.markRoomRead(payload.roomId),
    onMutate: async (payload) => {
      if (!listKey) return { previous: undefined, key: null as null };
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<ChatRoom[]>(listKey);
      const optimisticReadAt = new Date().toISOString();

      queryClient.setQueryData<ChatRoom[]>(listKey, (current) => {
        if (!current) return current;
        return current.map((room) => {
          if (room.id !== payload.roomId) return room;
          return {
            ...room,
            has_unread: false,
            viewer_last_read_at: optimisticReadAt,
            participants: room.participants.map((participant) =>
              currentUserId && participant.user_id === currentUserId
                ? { ...participant, last_read_at: optimisticReadAt }
                : participant,
            ),
          };
        });
      });

      return { previous, key: listKey };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous && context.key) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSuccess: (result, payload) => {
      if (!listKey) return;
      queryClient.setQueryData<ChatRoom[]>(listKey, (current) => {
        if (!current) return current;
        return current.map((room) => {
          if (room.id !== payload.roomId) return room;
          return {
            ...room,
            has_unread: false,
            viewer_last_read_at: result.last_read_at,
            participants: room.participants.map((participant) =>
              currentUserId && participant.user_id === currentUserId
                ? { ...participant, last_read_at: result.last_read_at }
                : participant,
            ),
          };
        });
      });
    },
    onSettled: async () => {
      if (listKey) {
        await queryClient.invalidateQueries({ queryKey: listKey });
      }
    },
  });
}

export function flattenRoomMessages(data: {
  pages: Array<{ messages: ChatMessage[] }>;
} | null | undefined): ChatMessage[] {
  if (!data) return [];
  return data.pages.flatMap((page) => page.messages);
}

export function findRoomByCounterpart(
  rooms: ChatRoom[],
  userId: string,
): ChatRoom | null {
  for (const room of rooms) {
    if (room.type !== "dm") continue;
    const hasUser = room.participants.some((participant) => participant.user_id === userId);
    if (hasUser) return room;
  }
  return null;
}

export function findMemberCandidate(
  members: ChatMemberCandidate[],
  userId: string,
): ChatMemberCandidate | null {
  return members.find((member) => member.user_id === userId) ?? null;
}
