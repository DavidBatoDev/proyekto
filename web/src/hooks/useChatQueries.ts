import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  chatService,
  type ChatAttachment,
  type ChatMemberCandidate,
  type ChatMention,
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

/** Shared media / files / links for a room (chat info panel). */
export function useRoomLibraryQuery(roomId: string, enabled = true) {
  return useQuery({
    queryKey: chatKeys.roomLibrary(roomId),
    queryFn: () => chatService.getRoomLibrary(roomId),
    enabled: enabled && Boolean(roomId),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Word + fuzzy search of a room's messages. Enabled once the (debounced) query
 * is at least 2 chars; keeps prior results visible while the next query loads.
 */
export function useRoomMessageSearchQuery(
  roomId: string,
  query: string,
  enabled = true,
) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: chatKeys.roomSearch(roomId, trimmed),
    queryFn: () => chatService.searchRoomMessages(roomId, trimmed),
    enabled: enabled && Boolean(roomId) && trimmed.length >= 2,
    staleTime: 15 * 1000,
    placeholderData: (previous) => previous,
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
        | {
            room_id: string;
            content: string;
            attachments?: ChatAttachment[];
            mentions?: ChatMention[];
          }
        | {
            slug?: "general";
            content: string;
            attachments?: ChatAttachment[];
            mentions?: ChatMention[];
          },
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

/**
 * Create a new channel. Optionally seeds members for private channels (the
 * create endpoint only joins the creator, so members are added afterwards).
 */
export function useCreateChannelMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      name: string;
      is_private?: boolean;
      memberIds?: string[];
    }) => {
      const room = await chatService.createChannel(projectId, {
        name: payload.name,
        is_private: payload.is_private,
      });
      if (payload.is_private && payload.memberIds?.length) {
        await Promise.all(
          payload.memberIds.map((id) =>
            chatService.addChannelMember(projectId, room.id, id).catch(() => null),
          ),
        );
      }
      return room;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
    },
  });
}

/** Rename, archive, or toggle visibility of a channel. Invalidates the room list. */
export function useUpdateChannelMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      roomId: string;
      name?: string;
      is_archived?: boolean;
      is_private?: boolean;
    }) =>
      chatService.updateChannel(projectId, payload.roomId, {
        name: payload.name,
        is_archived: payload.is_archived,
        is_private: payload.is_private,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
    },
  });
}

/** Leave a channel (self-service). Invalidates the project's room list. */
export function useLeaveChannelMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (roomId: string) => chatService.leaveChannel(projectId, roomId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
    },
  });
}

/** Members of a single channel (for the manage-members modal). */
export function useChannelMembersQuery(
  projectId: string,
  roomId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: chatKeys.channelMembers(projectId, roomId ?? ""),
    queryFn: () => chatService.listChannelMembers(projectId, roomId as string),
    enabled: enabled && Boolean(projectId) && Boolean(roomId),
    staleTime: 15 * 1000,
  });
}

/** Add a member to a channel. Refreshes that channel's member list + rooms. */
export function useAddChannelMemberMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { roomId: string; userId: string }) =>
      chatService.addChannelMember(projectId, payload.roomId, payload.userId),
    onSuccess: (_data, { roomId }) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.channelMembers(projectId, roomId),
      });
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
    },
  });
}

/** Remove a member from a channel. Refreshes that channel's member list + rooms. */
export function useRemoveChannelMemberMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { roomId: string; userId: string }) =>
      chatService.removeChannelMember(projectId, payload.roomId, payload.userId),
    onSuccess: (_data, { roomId }) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.channelMembers(projectId, roomId),
      });
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
        | {
            room_id: string;
            content: string;
            attachments?: ChatAttachment[];
            mentions?: ChatMention[];
          }
        | {
            recipient_id: string;
            content: string;
            attachments?: ChatAttachment[];
            mentions?: ChatMention[];
          },
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

/**
 * Toggle a personal star on a whole room (favorite channel). Optimistically
 * flips `is_starred` in both the project room list and the global DM list.
 */
export function useToggleRoomStarMutation(projectId: string) {
  const queryClient = useQueryClient();

  const flip = (rooms: ChatRoom[] | undefined, roomId: string) =>
    rooms?.map((room) =>
      room.id === roomId ? { ...room, is_starred: !room.is_starred } : room,
    );

  return useMutation({
    mutationFn: (payload: { roomId: string }) =>
      chatService.toggleRoomStar(payload.roomId),
    onMutate: async (payload) => {
      const roomsKey = chatKeys.rooms(projectId);
      const dmKey = chatKeys.dmRooms();
      await Promise.all([
        queryClient.cancelQueries({ queryKey: roomsKey }),
        queryClient.cancelQueries({ queryKey: dmKey }),
      ]);
      const prevRooms = queryClient.getQueryData<ChatRoom[]>(roomsKey);
      const prevDms = queryClient.getQueryData<ChatRoom[]>(dmKey);
      queryClient.setQueryData<ChatRoom[]>(roomsKey, (current) =>
        flip(current, payload.roomId),
      );
      queryClient.setQueryData<ChatRoom[]>(dmKey, (current) =>
        flip(current, payload.roomId),
      );
      return { prevRooms, prevDms, roomsKey, dmKey };
    },
    onError: (_error, _payload, context) => {
      if (!context) return;
      if (context.prevRooms) {
        queryClient.setQueryData(context.roomsKey, context.prevRooms);
      }
      if (context.prevDms) {
        queryClient.setQueryData(context.dmKey, context.prevDms);
      }
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
