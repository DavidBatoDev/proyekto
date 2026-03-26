export type ChatRole = 'consultant' | 'client' | 'freelancer';

export type ChatRoomType = 'channel' | 'dm';

export type ChatRoom = {
  id: string;
  project_id: string;
  type: ChatRoomType;
  slug: string;
  name: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  room_id: string;
  project_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type ChatUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

export type ChatParticipant = {
  room_id: string;
  user_id: string;
  project_id: string;
  joined_at: string;
  last_read_at: string | null;
  user: ChatUser | null;
};

export type ChatRoomWithLastMessage = ChatRoom & {
  last_message: ChatMessage | null;
  participants: ChatParticipant[];
};

export type ChatMemberCandidate = {
  user_id: string;
  role: ChatRole;
  position: string | null;
  user: ChatUser | null;
};

export interface ChatRepository {
  isProjectMember(projectId: string, userId: string): Promise<boolean>;
  resolveProjectRole(projectId: string, userId: string): Promise<ChatRole | null>;
  listProjectMemberCandidates(projectId: string): Promise<ChatMemberCandidate[]>;
  listProjectParticipantUserIds(projectId: string): Promise<string[]>;
  findRoomById(projectId: string, roomId: string): Promise<ChatRoom | null>;
  findRoomBySlug(
    projectId: string,
    type: ChatRoomType,
    slug: string,
  ): Promise<ChatRoom | null>;
  upsertRoom(params: {
    projectId: string;
    type: ChatRoomType;
    slug: string;
    name?: string | null;
  }): Promise<ChatRoom>;
  upsertParticipants(
    roomId: string,
    projectId: string,
    userIds: string[],
  ): Promise<void>;
  isRoomParticipant(roomId: string, userId: string): Promise<boolean>;
  listRecentRooms(
    projectId: string,
    userId: string,
  ): Promise<ChatRoomWithLastMessage[]>;
  listRoomMessages(params: {
    projectId: string;
    roomId: string;
    before?: string;
    limit: number;
  }): Promise<ChatMessage[]>;
  createMessage(params: {
    roomId: string;
    projectId: string;
    senderId: string;
    content: string;
  }): Promise<ChatMessage>;
}
