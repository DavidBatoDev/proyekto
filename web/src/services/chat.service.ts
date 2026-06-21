import { supabase } from "@/lib/supabase";

export type ChatRoomType = "channel" | "dm";

export interface ChatUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export interface ChatParticipant {
  room_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
  user: ChatUser | null;
}

export interface ChatAttachment {
  url: string;
  name: string;
  content_type: string;
  size: number;
  width?: number;
  height?: number;
}

/**
 * One @mention span inside a message. `user_id` is a member UUID, or the literal
 * `"everyone"` sentinel for @everyone. `offset`/`length` locate the "@Name" run
 * inside `content` so the thread can render a chip.
 */
export interface ChatMention {
  user_id: string;
  name: string;
  offset: number;
  length: number;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  project_id: string | null;
  sender_id: string;
  content: string;
  attachments?: ChatAttachment[];
  mentions?: ChatMention[];
  created_at: string;
  updated_at: string;
  reactions?: ChatMessageReaction[];
}

export interface ChatMessageReaction {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
}

export interface ChatRoom {
  id: string;
  project_id: string | null;
  type: ChatRoomType;
  slug: string;
  name: string | null;
  is_private: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  last_message: ChatMessage | null;
  participants: ChatParticipant[];
  counterpart?: ChatParticipant | null;
  viewer_last_read_at?: string | null;
  has_unread?: boolean;
  is_starred?: boolean;
}

export type ChatMemberRole = "consultant" | "client" | "freelancer";

export interface ChatMemberCandidate {
  user_id: string;
  role: ChatMemberRole;
  position: string | null;
  user: ChatUser | null;
}

export interface ChatMessagesPage {
  room_id: string;
  messages: ChatMessage[];
  next_before: string | null;
}

export interface ChatLibraryAttachment {
  message_id: string;
  sender_id: string;
  created_at: string;
  url: string;
  name: string | null;
  content_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
}

export interface ChatLibraryLink {
  message_id: string;
  sender_id: string;
  created_at: string;
  url: string;
}

export interface ChatRoomLibrary {
  room_id: string;
  media: ChatLibraryAttachment[];
  files: ChatLibraryAttachment[];
  links: ChatLibraryLink[];
}

export interface ChatMessageSearchHit extends ChatMessage {
  score: number;
}

export interface ChatMessageSearchResponse {
  room_id: string;
  query: string;
  results: ChatMessageSearchHit[];
}

type SendChannelPayload =
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
    };

type SendDmPayload =
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
    };

class ChatService {
  private async getAccessToken(): Promise<string> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Authentication required");
    return session.access_token;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error?.message || error?.message || "Chat request failed");
    }

    const payload = (await response.json()) as { data?: T } | T;
    if (payload && typeof payload === "object" && "data" in payload) {
      return (payload as { data: T }).data;
    }
    return payload as T;
  }

  // ── Project (channel) endpoints ─────────────────────────────────────────
  listRooms(projectId: string): Promise<ChatRoom[]> {
    return this.request<ChatRoom[]>(`/projects/${projectId}/chat/rooms`, {
      method: "GET",
    });
  }

  listMembers(projectId: string): Promise<ChatMemberCandidate[]> {
    return this.request<ChatMemberCandidate[]>(`/projects/${projectId}/chat/members`, {
      method: "GET",
    });
  }

  // ── Channel management ──────────────────────────────────────────────────
  createChannel(
    projectId: string,
    payload: { name: string; is_private?: boolean },
  ): Promise<ChatRoom> {
    return this.request<ChatRoom>(`/projects/${projectId}/chat/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  updateChannel(
    projectId: string,
    roomId: string,
    payload: { name?: string; is_archived?: boolean; is_private?: boolean },
  ): Promise<ChatRoom> {
    return this.request<ChatRoom>(
      `/projects/${projectId}/chat/channels/${roomId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }

  leaveChannel(projectId: string, roomId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/projects/${projectId}/chat/channels/${roomId}/leave`,
      { method: "DELETE" },
    );
  }

  listChannelMembers(
    projectId: string,
    roomId: string,
  ): Promise<ChatParticipant[]> {
    return this.request<ChatParticipant[]>(
      `/projects/${projectId}/chat/channels/${roomId}/members`,
      { method: "GET" },
    );
  }

  addChannelMember(
    projectId: string,
    roomId: string,
    userId: string,
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/projects/${projectId}/chat/channels/${roomId}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      },
    );
  }

  removeChannelMember(
    projectId: string,
    roomId: string,
    userId: string,
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/projects/${projectId}/chat/channels/${roomId}/members/${userId}`,
      { method: "DELETE" },
    );
  }

  sendChannelMessage(
    projectId: string,
    payload: SendChannelPayload,
  ): Promise<{ room: ChatRoom; message: ChatMessage }> {
    return this.request<{ room: ChatRoom; message: ChatMessage }>(
      `/projects/${projectId}/chat/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }

  // ── Global DM endpoints ─────────────────────────────────────────────────
  listDmRooms(): Promise<ChatRoom[]> {
    return this.request<ChatRoom[]>(`/chat/dm/rooms`, { method: "GET" });
  }

  listDmEligibleMembers(projectId: string): Promise<ChatMemberCandidate[]> {
    const qs = new URLSearchParams({ projectId }).toString();
    return this.request<ChatMemberCandidate[]>(
      `/chat/dm/eligible-members?${qs}`,
      { method: "GET" },
    );
  }

  resolveDm(recipientId: string): Promise<ChatRoom> {
    return this.request<ChatRoom>(`/chat/dm/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: recipientId }),
    });
  }

  sendDmMessage(
    payload: SendDmPayload,
  ): Promise<{ room: ChatRoom; message: ChatMessage }> {
    return this.request<{ room: ChatRoom; message: ChatMessage }>(
      `/chat/dm/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }

  // ── Room-agnostic endpoints ─────────────────────────────────────────────
  // Work for both channels and DMs; service verifies access by room.
  listRoomMessages(
    roomId: string,
    options?: { before?: string; limit?: number },
  ): Promise<ChatMessagesPage> {
    const query = new URLSearchParams();
    if (options?.before) query.set("before", options.before);
    if (options?.limit) query.set("limit", String(options.limit));

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<ChatMessagesPage>(
      `/chat/rooms/${roomId}/messages${suffix}`,
      { method: "GET" },
    );
  }

  /** Shared media / files / links for a room (chat info panel library). */
  getRoomLibrary(roomId: string): Promise<ChatRoomLibrary> {
    return this.request<ChatRoomLibrary>(`/chat/rooms/${roomId}/library`, {
      method: "GET",
    });
  }

  /** Word + fuzzy search of a room's messages. */
  searchRoomMessages(
    roomId: string,
    q: string,
    limit = 30,
  ): Promise<ChatMessageSearchResponse> {
    const query = new URLSearchParams({ q });
    if (limit) query.set("limit", String(limit));
    return this.request<ChatMessageSearchResponse>(
      `/chat/rooms/${roomId}/messages/search?${query.toString()}`,
      { method: "GET" },
    );
  }

  toggleReaction(
    messageId: string,
    emoji: string,
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/chat/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      },
    );
  }

  toggleRoomStar(roomId: string): Promise<{ starred: boolean }> {
    return this.request<{ starred: boolean }>(
      `/chat/rooms/${roomId}/star`,
      { method: "POST" },
    );
  }

  deleteMessage(messageId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/chat/messages/${messageId}`, {
      method: "DELETE",
    });
  }

  markRoomRead(
    roomId: string,
  ): Promise<{ ok: boolean; room_id: string; last_read_at: string }> {
    return this.request<{ ok: boolean; room_id: string; last_read_at: string }>(
      `/chat/rooms/${roomId}/read`,
      { method: "POST" },
    );
  }
}

export const chatService = new ChatService();
