import { chatService, type ChatMemberCandidate, type ChatMessagesPage, type ChatRoom } from "@/services/chat.service";

export const chatKeys = {
  all: ["chat"] as const,
  rooms: (projectId: string) => ["chat", "rooms", projectId] as const,
  members: (projectId: string) => ["chat", "members", projectId] as const,
  roomMessages: (projectId: string, roomId: string) =>
    ["chat", "room-messages", projectId, roomId] as const,
};

export function fetchProjectChatRooms(projectId: string): Promise<ChatRoom[]> {
  return chatService.listRooms(projectId);
}

export function fetchProjectChatMembers(
  projectId: string,
): Promise<ChatMemberCandidate[]> {
  return chatService.listMembers(projectId);
}

export function fetchRoomMessages(
  projectId: string,
  roomId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessagesPage> {
  return chatService.listRoomMessages(projectId, roomId, options);
}
