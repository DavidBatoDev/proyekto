export type ChatRole = 'consultant' | 'client' | 'freelancer';

export type ChatRoomType = 'channel' | 'dm';

export type ChatRoom = {
  id: string;
  project_id: string | null;
  type: ChatRoomType;
  slug: string;
  name: string | null;
  is_private: boolean;
  is_archived: boolean;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatAttachment = {
  url: string;
  name: string;
  content_type: string;
  size: number;
  width?: number;
  height?: number;
};

export type ChatMessage = {
  id: string;
  room_id: string;
  project_id: string | null;
  sender_id: string;
  content: string;
  attachments: ChatAttachment[];
  created_at: string;
  updated_at: string;
  reactions?: ChatMessageReactionSummary[];
};

export type ChatMessageReaction = {
  id: string;
  message_id: string;
  room_id: string;
  project_id: string | null;
  user_id: string;
  emoji: string;
  created_at: string;
  updated_at: string;
};

export type ChatMessageReactionSummary = {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
};

export type ChatMessageSearchHit = ChatMessage & { score: number };

export type ChatLibraryAttachment = {
  message_id: string;
  sender_id: string;
  created_at: string;
  url: string;
  name: string | null;
  content_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
};

export type ChatLibraryLink = {
  message_id: string;
  sender_id: string;
  created_at: string;
  url: string;
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
  joined_at: string;
  last_read_at: string | null;
  user: ChatUser | null;
};

export type ChatRoomWithLastMessage = ChatRoom & {
  last_message: ChatMessage | null;
  participants: ChatParticipant[];
  is_starred?: boolean;
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
  usersShareAnyProject(userA: string, userB: string): Promise<boolean>;
  findRoomById(roomId: string): Promise<ChatRoom | null>;
  /**
   * Single-query lookup that returns the room only if `userId` is a
   * participant of it. Collapses the separate "find room" + "is participant"
   * round-trips into one on the message-send hot path.
   */
  findRoomForParticipant(
    roomId: string,
    userId: string,
  ): Promise<ChatRoom | null>;
  findChannelBySlug(
    projectId: string,
    slug: string,
  ): Promise<ChatRoom | null>;
  findDmBySlug(slug: string): Promise<ChatRoom | null>;
  upsertChannel(params: {
    projectId: string;
    slug: string;
    name?: string | null;
    isPrivate?: boolean;
    createdBy?: string | null;
  }): Promise<ChatRoom>;
  /** Update mutable room fields (rename / archive). */
  updateRoom(
    roomId: string,
    patch: { name?: string; is_archived?: boolean; is_private?: boolean },
  ): Promise<ChatRoom>;
  /** Whether the project is a personal (solo) workspace. */
  getProjectIsPersonal(projectId: string): Promise<boolean>;
  /** Every non-archived channel of a project (visibility resolved in service). */
  listProjectChannels(projectId: string): Promise<ChatRoom[]>;
  /** Subset of `roomIds` that `userId` already participates in. */
  listParticipantRoomIds(userId: string, roomIds: string[]): Promise<string[]>;
  /** Hydrate the given rooms with last message + participants. */
  hydrateRoomsByIds(
    roomIds: string[],
    userId: string,
  ): Promise<ChatRoomWithLastMessage[]>;
  /** Participants of a single room (for the channel member list). */
  listRoomParticipants(roomId: string): Promise<ChatParticipant[]>;
  upsertDm(params: {
    slug: string;
  }): Promise<ChatRoom>;
  upsertParticipants(roomId: string, userIds: string[]): Promise<void>;
  removeParticipant(roomId: string, userId: string): Promise<void>;
  isRoomParticipant(roomId: string, userId: string): Promise<boolean>;
  /** All user ids participating in a room (for realtime inbox fan-out). */
  listRoomParticipantUserIds(roomId: string): Promise<string[]>;
  listRoomsForProject(
    projectId: string,
    userId: string,
  ): Promise<ChatRoomWithLastMessage[]>;
  listDmRoomsForUser(userId: string): Promise<ChatRoomWithLastMessage[]>;
  listRoomMessages(params: {
    roomId: string;
    before?: string;
    limit: number;
  }): Promise<ChatMessage[]>;
  createMessage(params: {
    roomId: string;
    projectId: string | null;
    senderId: string;
    content: string;
    attachments?: ChatAttachment[];
  }): Promise<ChatMessage>;
  findMessageById(messageId: string): Promise<ChatMessage | null>;
  /** Word + fuzzy (pg_trgm) search of a single room's messages. */
  searchRoomMessages(params: {
    roomId: string;
    query: string;
    limit: number;
  }): Promise<ChatMessageSearchHit[]>;
  /** Every attachment shared in a room (newest first). */
  listRoomAttachments(roomId: string): Promise<ChatLibraryAttachment[]>;
  /** Every URL found in a room's message text (newest first). */
  listRoomLinks(roomId: string): Promise<ChatLibraryLink[]>;
  listReactionsForMessages(params: {
    messageIds: string[];
    viewerUserId: string;
  }): Promise<Map<string, ChatMessageReactionSummary[]>>;
  toggleMessageReaction(params: {
    messageId: string;
    userId: string;
    emoji: string;
  }): Promise<void>;
  /** Toggle a personal star on a whole room (channel/DM); returns new state. */
  toggleRoomStar(params: {
    roomId: string;
    userId: string;
  }): Promise<{ starred: boolean }>;
  /** Subset of `roomIds` that `userId` has starred. */
  listStarredRoomIds(userId: string, roomIds: string[]): Promise<Set<string>>;
  deleteMessage(params: {
    messageId: string;
    senderId: string;
  }): Promise<void>;
  markRoomRead(params: {
    roomId: string;
    userId: string;
    readAt?: string;
  }): Promise<string>;
}
