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

export function useRoomMessagesQuery(projectId: string, roomId: string, limit = 30) {
  return useInfiniteQuery({
    queryKey: chatKeys.roomMessages(projectId, roomId),
    queryFn: ({ pageParam }) =>
      fetchRoomMessages(projectId, roomId, {
        before: pageParam as string | undefined,
        limit,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before || undefined,
    enabled: Boolean(projectId && roomId),
    staleTime: 5 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useSendChatMessageMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      payload:
        | { room_id: string; content: string }
        | { kind: "dm"; recipient_id: string; content: string }
        | { kind: "channel"; slug?: "general"; content: string },
    ) => chatService.sendMessage(projectId, payload),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
      await queryClient.invalidateQueries({
        queryKey: chatKeys.roomMessages(projectId, result.room.id),
      });
    },
  });
}

export function useToggleChatReactionMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { roomId: string; messageId: string; emoji: string }) =>
      chatService.toggleReaction(projectId, payload.messageId, payload.emoji),
    onMutate: async (payload) => {
      const key = chatKeys.roomMessages(projectId, payload.roomId);
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
        queryKey: chatKeys.roomMessages(projectId, payload.roomId),
      });
      await queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
    },
  });
}

export function useDeleteChatMessageMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { roomId: string; messageId: string }) =>
      chatService.deleteMessage(projectId, payload.messageId),
    onMutate: async (payload) => {
      const key = chatKeys.roomMessages(projectId, payload.roomId);
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
        queryKey: chatKeys.roomMessages(projectId, payload.roomId),
      });
      await queryClient.invalidateQueries({ queryKey: chatKeys.rooms(projectId) });
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
