import type { ChatRoom } from "@/services/chat.service";

export const CHANNEL_GENERAL_REF = "channel-general";
const DM_REF_PREFIX = "dm-";

export function toDmRef(userId: string): string {
  return `${DM_REF_PREFIX}${userId}`;
}

export function toChannelRef(): string {
  return CHANNEL_GENERAL_REF;
}

export function isUuidRef(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export type ParsedChatRef =
  | { kind: "channel" }
  | { kind: "dm"; userId: string }
  | { kind: "room"; roomId: string }
  | { kind: "invalid" };

export function parseChatRef(chatRef: string): ParsedChatRef {
  if (chatRef === CHANNEL_GENERAL_REF) {
    return { kind: "channel" };
  }

  if (chatRef.startsWith(DM_REF_PREFIX)) {
    const userId = chatRef.slice(DM_REF_PREFIX.length).trim();
    if (userId) {
      return { kind: "dm", userId };
    }
    return { kind: "invalid" };
  }

  if (isUuidRef(chatRef)) {
    return { kind: "room", roomId: chatRef };
  }

  return { kind: "invalid" };
}

export function roomRef(room: ChatRoom): string {
  return room.id;
}
