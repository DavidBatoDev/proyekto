import {
  chatService,
  type ChatMemberCandidate,
  type ChatMessagesPage,
  type ChatRoom,
} from "@/services/chat.service";

export const chatKeys = {
  all: ["chat"] as const,
  rooms: (projectId: string) => ["chat", "rooms", projectId] as const,
  dmRooms: () => ["chat", "dm-rooms"] as const,
  members: (projectId: string) => ["chat", "members", projectId] as const,
  dmEligibleMembers: (projectId: string) =>
    ["chat", "dm-eligible-members", projectId] as const,
  roomMessages: (roomId: string) => ["chat", "room-messages", roomId] as const,
};

export function fetchProjectChatRooms(projectId: string): Promise<ChatRoom[]> {
  return chatService.listRooms(projectId);
}

export function fetchDmRooms(): Promise<ChatRoom[]> {
  return chatService.listDmRooms();
}

export function fetchProjectChatMembers(
  projectId: string,
): Promise<ChatMemberCandidate[]> {
  return chatService.listMembers(projectId);
}

export function fetchDmEligibleMembers(
  projectId: string,
): Promise<ChatMemberCandidate[]> {
  return chatService.listDmEligibleMembers(projectId);
}

export function fetchRoomMessages(
  roomId: string,
  options?: { before?: string; limit?: number },
): Promise<ChatMessagesPage> {
  return chatService.listRoomMessages(roomId, options);
}
