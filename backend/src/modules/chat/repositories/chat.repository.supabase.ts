import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type {
  ChatMemberCandidate,
  ChatMessage,
  ChatMessageReaction,
  ChatMessageReactionSummary,
  ChatParticipant,
  ChatRepository,
  ChatRole,
  ChatRoom,
  ChatRoomType,
  ChatRoomWithLastMessage,
} from './chat.repository.interface';

type ProjectRoleData = {
  client_id: string;
  consultant_id: string | null;
};

type ProjectMemberRow = {
  user_id: string | null;
  // Slice 3b: shape now sourced from project_shares; `origin` carries the
  // legacy "role bucket" semantics (client | consultant | invited |
  // personal_workspace). `position` is no longer stored — UI uses
  // display_name only.
  origin?: string | null;
  user?:
    | {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }
    | Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }>
    | null;
};

type RawProjectSelect = {
  client_id: string;
  consultant_id: string | null;
  client?:
    | {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }
    | Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }>
    | null;
  consultant?:
    | {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }
    | Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }>
    | null;
};

type RawParticipantRow = {
  room_id: string;
  user_id: string;
  project_id: string;
  joined_at: string;
  last_read_at: string | null;
  user?:
    | {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }
    | Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      }>
    | null;
};

type RawReactionRow = {
  id: string;
  message_id: string;
  room_id: string;
  project_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class SupabaseChatRepository implements ChatRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  private pickSingle<T>(value: T | T[] | null | undefined): T | null {
    if (!value) return null;
    return Array.isArray(value) ? value[0] ?? null : value;
  }

  private normalizeRole(params: {
    userId: string;
    project: ProjectRoleData;
    memberRole?: string | null;
  }): ChatRole {
    if (params.userId === params.project.consultant_id) return 'consultant';
    if (params.userId === params.project.client_id) return 'client';

    const role = String(params.memberRole ?? '')
      .trim()
      .toLowerCase();
    if (role === 'consultant') return 'consultant';
    if (role === 'client') return 'client';
    return 'freelancer';
  }

  private async getProjectRoleData(projectId: string): Promise<ProjectRoleData | null> {
    const { data, error } = await this.supabase
      .from('projects')
      .select('client_id, consultant_id')
      .eq('id', projectId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      client_id: String(data.client_id),
      consultant_id:
        typeof data.consultant_id === 'string' ? data.consultant_id : null,
    };
  }

  async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    // Slice 3b: any project_shares grant counts as membership.
    const { data, error } = await this.supabase
      .from('project_access')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    return !error && !!data;
  }

  async resolveProjectRole(
    projectId: string,
    userId: string,
  ): Promise<ChatRole | null> {
    const project = await this.getProjectRoleData(projectId);
    if (!project) return null;

    // Origin metadata on project_shares preserves the chat-relevant
    // distinction between client (origin='client'/'personal_workspace') and
    // consultant (origin='consultant'). Fall back to active_persona-style
    // bucketing via normalizeRole for invited members.
    const { data, error } = await this.supabase
      .from('project_access')
      .select('role, origin')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;

    // Map origin → legacy chat-role bucket so normalizeRole keeps working
    // unchanged downstream.
    const memberRole =
      data.origin === 'consultant'
        ? 'consultant'
        : data.origin === 'client' || data.origin === 'personal_workspace'
          ? 'client'
          : 'member';

    return this.normalizeRole({
      userId,
      project,
      memberRole,
    });
  }

  async listProjectMemberCandidates(
    projectId: string,
  ): Promise<ChatMemberCandidate[]> {
    const projectQuery = this.supabase
      .from('projects')
      .select(
        `
        client_id,
        consultant_id,
        client:profiles!projects_client_id_fkey(id, display_name, avatar_url, email),
        consultant:profiles!projects_consultant_id_fkey(id, display_name, avatar_url, email)
      `,
      )
      .eq('id', projectId)
      .single();

    // Slice 3b: pull members from project_shares. Use `origin` as the
    // legacy "role" bucket for chat normalization. Position field is
    // dropped (project_shares has no equivalent; UI shows display_name).
    const membersQuery = this.supabase
      .from('project_access')
      .select(
        `
        user_id,
        origin,
        user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, email)
      `,
      )
      .eq('project_id', projectId)
      .not('user_id', 'is', null);

    const [{ data: projectData, error: projectError }, { data: memberRows, error: membersError }] =
      await Promise.all([projectQuery, membersQuery]);

    if (projectError || !projectData) {
      throw new Error(projectError?.message || 'Project not found');
    }

    if (membersError) {
      throw new Error(membersError.message);
    }

    const rawProject = projectData as unknown as RawProjectSelect;
    const project = {
      client_id: String(rawProject.client_id),
      consultant_id:
        typeof rawProject.consultant_id === 'string'
          ? rawProject.consultant_id
          : null,
    } satisfies ProjectRoleData;

    const map = new Map<string, ChatMemberCandidate>();
    const clientProfile = this.pickSingle(rawProject.client);
    if (clientProfile?.id) {
      map.set(clientProfile.id, {
        user_id: clientProfile.id,
        role: this.normalizeRole({
          userId: clientProfile.id,
          project,
          memberRole: 'client',
        }),
        position: 'Client',
        user: clientProfile,
      });
    }

    const consultantProfile = this.pickSingle(rawProject.consultant);
    if (consultantProfile?.id) {
      map.set(consultantProfile.id, {
        user_id: consultantProfile.id,
        role: this.normalizeRole({
          userId: consultantProfile.id,
          project,
          memberRole: 'consultant',
        }),
        position: 'Consultant',
        user: consultantProfile,
      });
    }

    for (const row of (memberRows || []) as ProjectMemberRow[]) {
      if (!row.user_id) continue;
      // Map origin → legacy memberRole bucket for normalizeRole.
      const memberRole =
        row.origin === 'consultant'
          ? 'consultant'
          : row.origin === 'client' || row.origin === 'personal_workspace'
            ? 'client'
            : 'member';

      const existing = map.get(row.user_id);
      if (existing) {
        const rowUser = this.pickSingle(row.user);
        if (!existing.user && rowUser) {
          existing.user = rowUser;
        }
        continue;
      }

      map.set(row.user_id, {
        user_id: row.user_id,
        role: this.normalizeRole({
          userId: row.user_id,
          project,
          memberRole,
        }),
        position: null,
        user: this.pickSingle(row.user),
      });
    }

    return Array.from(map.values());
  }

  async listProjectParticipantUserIds(projectId: string): Promise<string[]> {
    const candidates = await this.listProjectMemberCandidates(projectId);
    return Array.from(new Set(candidates.map((candidate) => candidate.user_id)));
  }

  async findRoomById(projectId: string, roomId: string): Promise<ChatRoom | null> {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .select('id, project_id, type, slug, name, created_at, updated_at')
      .eq('id', roomId)
      .eq('project_id', projectId)
      .maybeSingle();

    if (error || !data) return null;
    return data as ChatRoom;
  }

  async findRoomBySlug(
    projectId: string,
    type: ChatRoomType,
    slug: string,
  ): Promise<ChatRoom | null> {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .select('id, project_id, type, slug, name, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('type', type)
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data) return null;
    return data as ChatRoom;
  }

  async upsertRoom(params: {
    projectId: string;
    type: ChatRoomType;
    slug: string;
    name?: string | null;
  }): Promise<ChatRoom> {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .upsert(
        {
          project_id: params.projectId,
          type: params.type,
          slug: params.slug,
          name: params.name ?? null,
        },
        { onConflict: 'project_id,type,slug' },
      )
      .select('id, project_id, type, slug, name, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to upsert room');
    }
    return data as ChatRoom;
  }

  async upsertParticipants(
    roomId: string,
    projectId: string,
    userIds: string[],
  ): Promise<void> {
    const deduped = Array.from(new Set(userIds.filter(Boolean)));
    if (deduped.length === 0) return;

    const payload = deduped.map((userId) => ({
      room_id: roomId,
      user_id: userId,
      project_id: projectId,
    }));

    const { error } = await this.supabase
      .from('chat_room_participants')
      .upsert(payload, { onConflict: 'room_id,user_id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async isRoomParticipant(roomId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chat_room_participants')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();

    return !error && !!data;
  }

  async listRecentRooms(
    projectId: string,
    userId: string,
  ): Promise<ChatRoomWithLastMessage[]> {
    const { data: participantRows, error: participantsError } = await this.supabase
      .from('chat_room_participants')
      .select('room_id')
      .eq('project_id', projectId)
      .eq('user_id', userId);

    if (participantsError) {
      throw new Error(participantsError.message);
    }

    const roomIds = (participantRows || []).map((row) => String(row.room_id));
    if (roomIds.length === 0) return [];

    const [roomsResult, messagesResult, roomParticipantsResult] = await Promise.all([
      this.supabase
        .from('chat_rooms')
        .select('id, project_id, type, slug, name, created_at, updated_at')
        .eq('project_id', projectId)
        .in('id', roomIds),
      this.supabase
        .from('chat_room_messages')
        .select('id, room_id, project_id, sender_id, content, created_at, updated_at')
        .eq('project_id', projectId)
        .in('room_id', roomIds)
        .order('created_at', { ascending: false }),
      this.supabase
        .from('chat_room_participants')
        .select(
          `
          room_id, user_id, project_id, joined_at, last_read_at,
          user:profiles!chat_room_participants_user_id_fkey(id, display_name, avatar_url, email)
        `,
        )
        .eq('project_id', projectId)
        .in('room_id', roomIds),
    ]);

    if (roomsResult.error) throw new Error(roomsResult.error.message);
    if (messagesResult.error) throw new Error(messagesResult.error.message);
    if (roomParticipantsResult.error) {
      throw new Error(roomParticipantsResult.error.message);
    }

    const latestMessageByRoom = new Map<string, ChatMessage>();
    for (const row of (messagesResult.data || []) as ChatMessage[]) {
      if (!latestMessageByRoom.has(row.room_id)) {
        latestMessageByRoom.set(row.room_id, row);
      }
    }

    const participantsByRoom = new Map<string, ChatParticipant[]>();
    for (const row of (roomParticipantsResult.data || []) as RawParticipantRow[]) {
      const list = participantsByRoom.get(row.room_id) ?? [];
      list.push({
        room_id: row.room_id,
        user_id: row.user_id,
        project_id: row.project_id,
        joined_at: row.joined_at,
        last_read_at: row.last_read_at,
        user: this.pickSingle(row.user),
      });
      participantsByRoom.set(row.room_id, list);
    }

    return ((roomsResult.data || []) as ChatRoom[]).map((room) => ({
      ...room,
      last_message: latestMessageByRoom.get(room.id) ?? null,
      participants: participantsByRoom.get(room.id) ?? [],
    }));
  }

  async listRoomMessages(params: {
    projectId: string;
    roomId: string;
    before?: string;
    limit: number;
  }): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('chat_room_messages')
      .select('id, room_id, project_id, sender_id, content, created_at, updated_at')
      .eq('project_id', params.projectId)
      .eq('room_id', params.roomId)
      .order('created_at', { ascending: false })
      .limit(params.limit);

    if (params.before) {
      query = query.lt('created_at', params.before);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []) as ChatMessage[];
  }

  async createMessage(params: {
    roomId: string;
    projectId: string;
    senderId: string;
    content: string;
  }): Promise<ChatMessage> {
    const { data, error } = await this.supabase
      .from('chat_room_messages')
      .insert({
        room_id: params.roomId,
        project_id: params.projectId,
        sender_id: params.senderId,
        content: params.content,
      })
      .select('id, room_id, project_id, sender_id, content, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to send message');
    }

    return data as ChatMessage;
  }

  async findMessageById(
    projectId: string,
    messageId: string,
  ): Promise<ChatMessage | null> {
    const { data, error } = await this.supabase
      .from('chat_room_messages')
      .select('id, room_id, project_id, sender_id, content, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('id', messageId)
      .maybeSingle();

    if (error || !data) return null;
    return data as ChatMessage;
  }

  async listReactionsForMessages(params: {
    projectId: string;
    messageIds: string[];
    viewerUserId: string;
  }): Promise<Map<string, ChatMessageReactionSummary[]>> {
    const map = new Map<string, ChatMessageReactionSummary[]>();
    if (params.messageIds.length === 0) return map;

    const { data, error } = await this.supabase
      .from('chat_room_message_reactions')
      .select(
        'id, message_id, room_id, project_id, user_id, emoji, created_at, updated_at',
      )
      .eq('project_id', params.projectId)
      .in('message_id', params.messageIds);

    if (error) {
      throw new Error(error.message);
    }

    const grouped = new Map<string, Map<string, ChatMessageReactionSummary>>();
    for (const row of (data || []) as RawReactionRow[]) {
      const byEmoji = grouped.get(row.message_id) ?? new Map();
      const existing = byEmoji.get(row.emoji);
      if (existing) {
        existing.count += 1;
        if (row.user_id === params.viewerUserId) {
          existing.reacted_by_me = true;
        }
      } else {
        byEmoji.set(row.emoji, {
          emoji: row.emoji,
          count: 1,
          reacted_by_me: row.user_id === params.viewerUserId,
        });
      }
      grouped.set(row.message_id, byEmoji);
    }

    for (const [messageId, byEmoji] of grouped.entries()) {
      map.set(
        messageId,
        Array.from(byEmoji.values()).sort((a, b) =>
          a.emoji.localeCompare(b.emoji),
        ),
      );
    }

    return map;
  }

  async toggleMessageReaction(params: {
    projectId: string;
    messageId: string;
    userId: string;
    emoji: string;
  }): Promise<void> {
    const message = await this.findMessageById(params.projectId, params.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const { data: existing, error: existingError } = await this.supabase
      .from('chat_room_message_reactions')
      .select('id')
      .eq('project_id', params.projectId)
      .eq('message_id', params.messageId)
      .eq('user_id', params.userId)
      .eq('emoji', params.emoji)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      throw new Error(existingError.message);
    }

    if (existing?.id) {
      const { error: deleteError } = await this.supabase
        .from('chat_room_message_reactions')
        .delete()
        .eq('id', existing.id);
      if (deleteError) throw new Error(deleteError.message);
      return;
    }

    const { error: insertError } = await this.supabase
      .from('chat_room_message_reactions')
      .insert({
        message_id: params.messageId,
        room_id: message.room_id,
        project_id: params.projectId,
        user_id: params.userId,
        emoji: params.emoji,
      } satisfies Omit<ChatMessageReaction, 'id' | 'created_at' | 'updated_at'>);

    if (insertError) throw new Error(insertError.message);
  }

  async deleteMessage(params: {
    projectId: string;
    messageId: string;
    senderId: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('chat_room_messages')
      .delete()
      .eq('project_id', params.projectId)
      .eq('id', params.messageId)
      .eq('sender_id', params.senderId);

    if (error) throw new Error(error.message);
  }

  async markRoomRead(params: {
    roomId: string;
    userId: string;
    readAt?: string;
  }): Promise<string> {
    const readAt = params.readAt ?? new Date().toISOString();

    const { data: existing, error: existingError } = await this.supabase
      .from('chat_room_participants')
      .select('last_read_at')
      .eq('room_id', params.roomId)
      .eq('user_id', params.userId)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      throw new Error(existingError.message);
    }

    const existingReadAt =
      existing?.last_read_at && typeof existing.last_read_at === 'string'
        ? existing.last_read_at
        : null;

    if (existingReadAt && new Date(existingReadAt).getTime() >= new Date(readAt).getTime()) {
      return existingReadAt;
    }

    const { data, error } = await this.supabase
      .from('chat_room_participants')
      .update({ last_read_at: readAt })
      .eq('room_id', params.roomId)
      .eq('user_id', params.userId)
      .select('last_read_at')
      .single();

    if (error) throw new Error(error.message);

    return typeof data?.last_read_at === 'string' ? data.last_read_at : readAt;
  }
}
