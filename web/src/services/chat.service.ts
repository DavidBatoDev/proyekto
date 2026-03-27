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
  project_id: string;
  joined_at: string;
  last_read_at: string | null;
  user: ChatUser | null;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  project_id: string;
  sender_id: string;
  content: string;
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
  project_id: string;
  type: ChatRoomType;
  slug: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  last_message: ChatMessage | null;
  participants: ChatParticipant[];
  counterpart?: ChatParticipant | null;
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

type SendMessagePayload =
  | {
      room_id: string;
      content: string;
    }
  | {
      kind: "dm";
      recipient_id: string;
      content: string;
    }
  | {
      kind: "channel";
      slug?: "general";
      content: string;
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

  listRoomMessages(
    projectId: string,
    roomId: string,
    options?: { before?: string; limit?: number },
  ): Promise<ChatMessagesPage> {
    const query = new URLSearchParams();
    if (options?.before) query.set("before", options.before);
    if (options?.limit) query.set("limit", String(options.limit));

    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<ChatMessagesPage>(
      `/projects/${projectId}/chat/rooms/${roomId}/messages${suffix}`,
      {
        method: "GET",
      },
    );
  }

  sendMessage(
    projectId: string,
    payload: SendMessagePayload,
  ): Promise<{ room: ChatRoom; message: ChatMessage }> {
    return this.request<{ room: ChatRoom; message: ChatMessage }>(
      `/projects/${projectId}/chat/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
  }

  toggleReaction(
    projectId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/projects/${projectId}/chat/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ emoji }),
      },
    );
  }

  deleteMessage(projectId: string, messageId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/projects/${projectId}/chat/messages/${messageId}`,
      {
        method: "DELETE",
      },
    );
  }
}

export const chatService = new ChatService();
