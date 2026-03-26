import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chatService, type ChatMemberCandidate, type ChatMessage, type ChatRoom } from "@/services/chat.service";
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
