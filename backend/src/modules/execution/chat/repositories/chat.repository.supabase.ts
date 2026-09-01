import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { isActiveSellerEnrollment } from '../../../../common/auth/consultant-capability';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { DEFAULT_CHAT_NOTIFICATION_LEVEL } from './chat.repository.interface';
import type {
  ChatAttachment,
  ChatLibraryAttachment,
  ChatLibraryLink,
  ChatMemberCandidate,
  ChatMention,
  ChatMessage,
  ChatMessageReaction,
  ChatMessageReactionSummary,
  ChatMessageSearchHit,
  ChatNotificationLevel,
  ChatParticipant,
  ChatRepository,
  ChatRoom,
  ChatRoomNotificationPreference,
  ChatRoomWithLastMessage,
} from './chat.repository.interface';

// Full column list for chat_rooms selects — kept in one place so the
// flexible-channel fields (is_private / is_archived / ...) are always
// hydrated everywhere a room is read.
const ROOM_COLUMNS =
  'id, project_id, type, slug, name, is_private, is_archived, archived_at, created_by, created_at, updated_at';

const MESSAGE_COLUMNS =
  'id, room_id, project_id, sender_id, content, attachments, mentions, edited_at, deleted_at, reply_to_id, created_at, updated_at';

type ProjectMemberRow = {
  user_id: string | null;
  role?: string | null;
  origin?: string | null;
  position?: string | null;
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

type ProjectTeamMemberRow = {
  user_id: string;
  team_id: string;
};

type ProjectTeamRow = {
  team_id: string;
  is_primary: boolean;
  attached_at: string;
};

type TeamSummaryRow = {
  id: string;
  name: string;
  avatar_url: string | null;
};

type RawParticipantRow = {
  room_id: string;
  user_id: string;
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
  project_id: string | null;
  user_id: string;
  emoji: string;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class SupabaseChatRepository implements ChatRepository {
  private readonly logger = new Logger(SupabaseChatRepository.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  private pickSingle<T>(value: T | T[] | null | undefined): T | null {
    if (!value) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .limit(1);

    return !error && Boolean(data && data.length > 0);
  }

  async listProjectMemberCandidates(
    projectId: string,
  ): Promise<ChatMemberCandidate[]> {
    const membersQuery = this.supabase
      .from('project_access')
      .select(
        `
        user_id,
        role,
        origin,
        position,
        user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, email)
      `,
      )
      .eq('project_id', projectId)
      .not('user_id', 'is', null);

    const curatedMembersQuery = this.supabase
      .from('project_team_members')
      .select('user_id, team_id')
      .eq('project_id', projectId);

    const projectTeamsQuery = this.supabase
      .from('project_teams')
      .select('team_id, is_primary, attached_at')
      .eq('project_id', projectId);

    const [
      { data: memberRows, error: membersError },
      { data: curatedMemberRows, error: curatedMembersError },
      { data: projectTeamRows, error: projectTeamsError },
    ] = await Promise.all([
      membersQuery,
      curatedMembersQuery,
      projectTeamsQuery,
    ]);

    if (membersError) {
      throw new Error(membersError.message);
    }
    if (curatedMembersError) throw new Error(curatedMembersError.message);
    if (projectTeamsError) throw new Error(projectTeamsError.message);

    const teamIds = Array.from(
      new Set(
        ((projectTeamRows ?? []) as ProjectTeamRow[]).map((row) => row.team_id),
      ),
    );
    const teamById = new Map<string, TeamSummaryRow>();
    if (teamIds.length > 0) {
      const { data: teamRows, error: teamsError } = await this.supabase
        .from('teams')
        .select('id, name, avatar_url')
        .in('id', teamIds);
      if (teamsError) throw new Error(teamsError.message);
      for (const team of (teamRows ?? []) as TeamSummaryRow[]) {
        teamById.set(team.id, team);
      }
    }

    const attachmentRank = new Map(
      ((projectTeamRows ?? []) as ProjectTeamRow[]).map((row) => [
        row.team_id,
        { isPrimary: row.is_primary, attachedAt: row.attached_at },
      ]),
    );
    const teamIdsByUser = new Map<string, string[]>();
    for (const row of (curatedMemberRows ?? []) as ProjectTeamMemberRow[]) {
      const current = teamIdsByUser.get(row.user_id) ?? [];
      current.push(row.team_id);
      teamIdsByUser.set(row.user_id, current);
    }
    for (const ids of teamIdsByUser.values()) {
      ids.sort((a, b) => {
        const aRank = attachmentRank.get(a);
        const bRank = attachmentRank.get(b);
        if (aRank?.isPrimary !== bRank?.isPrimary) {
          return aRank?.isPrimary ? -1 : 1;
        }
        return (aRank?.attachedAt ?? '').localeCompare(bRank?.attachedAt ?? '');
      });
    }

    const teamForUser = (userId: string): TeamSummaryRow | null => {
      const teamId = teamIdsByUser.get(userId)?.[0];
      return teamId ? (teamById.get(teamId) ?? null) : null;
    };

    const map = new Map<string, ChatMemberCandidate>();
    for (const row of (memberRows || []) as ProjectMemberRow[]) {
      if (!row.user_id) continue;

      const existing = map.get(row.user_id);
      if (existing) {
        const rowUser = this.pickSingle(row.user);
        if (!existing.user && rowUser) {
          existing.user = rowUser;
        }
        if (row.role) {
          existing.access_role = row.role as ChatMemberCandidate['access_role'];
        }
        if (row.position?.trim()) existing.position = row.position.trim();
        existing.team = teamForUser(row.user_id);
        continue;
      }

      map.set(row.user_id, {
        user_id: row.user_id,
        access_role: (row.role ??
          'member') as ChatMemberCandidate['access_role'],
        position: row.position?.trim() || null,
        team: teamForUser(row.user_id),
        user: this.pickSingle(row.user),
      });
    }

    return Array.from(map.values());
  }

  async listProjectParticipantUserIds(projectId: string): Promise<string[]> {
    const candidates = await this.listProjectMemberCandidates(projectId);
    return Array.from(
      new Set(candidates.map((candidate) => candidate.user_id)),
    );
  }

  async recipientIsActiveSeller(recipientId: string): Promise<boolean> {
    return isActiveSellerEnrollment(this.supabase, recipientId);
  }

  async usersShareAnyProject(userA: string, userB: string): Promise<boolean> {
    if (userA === userB) return false;

    const { data: accessA, error: accessErr } = await this.supabase
      .from('project_access')
      .select('project_id')
      .eq('user_id', userA);

    if (accessErr || !accessA || accessA.length === 0) return false;

    const projectIds = Array.from(
      new Set(accessA.map((row) => String(row.project_id)).filter(Boolean)),
    );
    if (projectIds.length === 0) return false;

    const { data: accessB, error: accessErrB } = await this.supabase
      .from('project_access')
      .select('project_id')
      .eq('user_id', userB)
      .in('project_id', projectIds)
      .limit(1);

    if (accessErrB) return false;
    return Boolean(accessB && accessB.length > 0);
  }

  async findRoomById(roomId: string): Promise<ChatRoom | null> {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .select(ROOM_COLUMNS)
      .eq('id', roomId)
      .maybeSingle();

    if (error || !data) return null;
    return data as ChatRoom;
  }

  async findRoomForParticipant(
    roomId: string,
    userId: string,
  ): Promise<ChatRoom | null> {
    const { data, error } = await this.supabase
      .from('chat_room_participants')
      .select(`room:chat_rooms!inner(${ROOM_COLUMNS})`)
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return this.pickSingle(
      (data as { room: ChatRoom | ChatRoom[] | null }).room,
    );
  }

  async findChannelBySlug(
    projectId: string,
    slug: string,
  ): Promise<ChatRoom | null> {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .select(ROOM_COLUMNS)
      .eq('project_id', projectId)
      .eq('type', 'channel')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data) return null;
    return data as ChatRoom;
  }

  async findDmBySlug(slug: string): Promise<ChatRoom | null> {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .select(ROOM_COLUMNS)
      .is('project_id', null)
      .eq('type', 'dm')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data) return null;
    return data as ChatRoom;
  }

  async upsertChannel(params: {
    projectId: string;
    slug: string;
    name?: string | null;
    isPrivate?: boolean;
    createdBy?: string | null;
  }): Promise<ChatRoom> {
    // Channels (including the auto-provisioned defaults) are keyed on
    // (project_id, slug), so a re-run is idempotent and races re-fetch cleanly.
    const findExisting = () =>
      this.findChannelBySlug(params.projectId, params.slug);

    const existing = await findExisting();
    if (existing) return existing;

    const { data, error } = await this.supabase
      .from('chat_rooms')
      .insert({
        project_id: params.projectId,
        type: 'channel',
        slug: params.slug,
        name: params.name ?? null,
        is_private: params.isPrivate ?? false,
        created_by: params.createdBy ?? null,
      })
      .select(ROOM_COLUMNS)
      .single();

    if (error) {
      // Could be a unique-key race — re-fetch.
      const retry = await findExisting();
      if (retry) return retry;
      throw new Error(error.message || 'Failed to upsert channel');
    }
    if (!data) throw new Error('Failed to upsert channel');
    return data as ChatRoom;
  }

  async updateRoom(
    roomId: string,
    patch: { name?: string; is_archived?: boolean; is_private?: boolean },
  ): Promise<ChatRoom> {
    const update: Record<string, unknown> = {};
    if (typeof patch.name === 'string') update.name = patch.name;
    if (typeof patch.is_private === 'boolean')
      update.is_private = patch.is_private;
    if (typeof patch.is_archived === 'boolean') {
      update.is_archived = patch.is_archived;
      update.archived_at = patch.is_archived ? new Date().toISOString() : null;
    }

    const { data, error } = await this.supabase
      .from('chat_rooms')
      .update(update)
      .eq('id', roomId)
      .select(ROOM_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to update channel');
    }
    return data as ChatRoom;
  }

  async getProjectIsPersonal(projectId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('personal_projects')
      .select('project_id')
      .eq('project_id', projectId)
      .maybeSingle();

    if (error || !data) return false;
    return true;
  }

  async listProjectChannels(projectId: string): Promise<ChatRoom[]> {
    const { data, error } = await this.supabase
      .from('chat_rooms')
      .select(ROOM_COLUMNS)
      .eq('project_id', projectId)
      .eq('type', 'channel')
      .eq('is_archived', false);

    if (error) throw new Error(error.message);
    return (data || []) as ChatRoom[];
  }

  async listParticipantRoomIds(
    userId: string,
    roomIds: string[],
  ): Promise<string[]> {
    if (roomIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_room_participants')
      .select('room_id')
      .eq('user_id', userId)
      .in('room_id', roomIds);

    if (error || !data) return [];
    return Array.from(new Set(data.map((row) => String(row.room_id))));
  }

  async hydrateRoomsByIds(
    roomIds: string[],
    userId: string,
  ): Promise<ChatRoomWithLastMessage[]> {
    return this.hydrateRooms(roomIds, userId);
  }

  async listRoomParticipants(roomId: string): Promise<ChatParticipant[]> {
    const { data, error } = await this.supabase
      .from('chat_room_participants')
      .select(
        `
        room_id, user_id, joined_at, last_read_at,
        user:profiles!chat_room_participants_user_id_fkey(id, display_name, avatar_url, email)
      `,
      )
      .eq('room_id', roomId);

    if (error) throw new Error(error.message);
    return ((data || []) as RawParticipantRow[]).map((row) => ({
      room_id: row.room_id,
      user_id: row.user_id,
      joined_at: row.joined_at,
      last_read_at: row.last_read_at,
      user: this.pickSingle(row.user),
    }));
  }

  async upsertDm(params: { slug: string }): Promise<ChatRoom> {
    const existing = await this.findDmBySlug(params.slug);
    if (existing) return existing;

    const { data, error } = await this.supabase
      .from('chat_rooms')
      .insert({
        project_id: null,
        type: 'dm',
        slug: params.slug,
        name: null,
      })
      .select(ROOM_COLUMNS)
      .single();

    if (error) {
      const retry = await this.findDmBySlug(params.slug);
      if (retry) return retry;
      throw new Error(error.message || 'Failed to upsert DM');
    }
    if (!data) throw new Error('Failed to upsert DM');
    return data as ChatRoom;
  }

  async upsertParticipants(roomId: string, userIds: string[]): Promise<void> {
    const deduped = Array.from(new Set(userIds.filter(Boolean)));
    if (deduped.length === 0) return;

    const payload = deduped.map((userId) => ({
      room_id: roomId,
      user_id: userId,
    }));

    const { error } = await this.supabase
      .from('chat_room_participants')
      .upsert(payload, { onConflict: 'room_id,user_id' });

    if (error) {
      throw new Error(error.message);
    }
  }

  async removeParticipant(roomId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chat_room_participants')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
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

  async listRoomParticipantUserIds(roomId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('chat_room_participants')
      .select('user_id')
      .eq('room_id', roomId);

    if (error || !data) return [];
    return Array.from(new Set(data.map((row) => row.user_id as string)));
  }

  async listRoomParticipantReadState(
    roomId: string,
  ): Promise<{ user_id: string; last_read_at: string | null }[]> {
    const { data, error } = await this.supabase
      .from('chat_room_participants')
      .select('user_id, last_read_at')
      .eq('room_id', roomId);

    if (error || !data) return [];
    return data.map((row) => ({
      user_id: row.user_id as string,
      last_read_at: (row.last_read_at as string | null) ?? null,
    }));
  }

  private async hydrateRooms(
    roomIds: string[],
    viewerUserId: string,
  ): Promise<ChatRoomWithLastMessage[]> {
    if (roomIds.length === 0) return [];

    const [roomsResult, messagesResult, roomParticipantsResult] =
      await Promise.all([
        this.supabase.from('chat_rooms').select(ROOM_COLUMNS).in('id', roomIds),
        // One row per room (the newest) via DISTINCT ON inside
        // chat_latest_messages_by_room -- avoids pulling every message in every
        // room just to find the last one. See migration 20260617140000.
        this.supabase.rpc('chat_latest_messages_by_room', {
          p_room_ids: roomIds,
        }),
        this.supabase
          .from('chat_room_participants')
          .select(
            `
          room_id, user_id, joined_at, last_read_at,
          user:profiles!chat_room_participants_user_id_fkey(id, display_name, avatar_url, email)
        `,
          )
          .in('room_id', roomIds),
      ]);

    void viewerUserId;

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
    for (const row of (roomParticipantsResult.data ||
      []) as RawParticipantRow[]) {
      const list = participantsByRoom.get(row.room_id) ?? [];
      list.push({
        room_id: row.room_id,
        user_id: row.user_id,
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

  async listRoomsForProject(
    projectId: string,
    userId: string,
  ): Promise<ChatRoomWithLastMessage[]> {
    const { data: participantRows, error: participantsError } =
      await this.supabase
        .from('chat_room_participants')
        .select('room_id, chat_rooms!inner(project_id, type)')
        .eq('user_id', userId)
        .eq('chat_rooms.project_id', projectId)
        .eq('chat_rooms.type', 'channel');

    if (participantsError) {
      throw new Error(participantsError.message);
    }

    const roomIds = Array.from(
      new Set(
        (participantRows || [])
          .map((row) => String((row as { room_id: string }).room_id))
          .filter(Boolean),
      ),
    );

    return this.hydrateRooms(roomIds, userId);
  }

  async listDmRoomsForUser(userId: string): Promise<ChatRoomWithLastMessage[]> {
    const { data: participantRows, error: participantsError } =
      await this.supabase
        .from('chat_room_participants')
        .select('room_id, chat_rooms!inner(type)')
        .eq('user_id', userId)
        .eq('chat_rooms.type', 'dm');

    if (participantsError) {
      throw new Error(participantsError.message);
    }

    const roomIds = Array.from(
      new Set(
        (participantRows || [])
          .map((row) => String((row as { room_id: string }).room_id))
          .filter(Boolean),
      ),
    );

    return this.hydrateRooms(roomIds, userId);
  }

  async listRoomMessages(params: {
    roomId: string;
    before?: string;
    limit: number;
  }): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('chat_room_messages')
      .select(MESSAGE_COLUMNS)
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
    projectId: string | null;
    senderId: string;
    content: string;
    attachments?: ChatAttachment[];
    mentions?: ChatMention[];
    replyToId?: string | null;
  }): Promise<ChatMessage> {
    const { data, error } = await this.supabase
      .from('chat_room_messages')
      .insert({
        room_id: params.roomId,
        project_id: params.projectId,
        sender_id: params.senderId,
        content: params.content,
        attachments: params.attachments ?? [],
        mentions: params.mentions ?? [],
        reply_to_id: params.replyToId ?? null,
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to send message');
    }

    return data as ChatMessage;
  }

  async searchRoomMessages(params: {
    roomId: string;
    query: string;
    limit: number;
  }): Promise<ChatMessageSearchHit[]> {
    const { data, error } = await this.supabase.rpc(
      'chat_search_room_messages',
      {
        p_room_id: params.roomId,
        p_query: params.query,
        p_limit: params.limit,
      },
    );
    if (error) throw new Error(error.message);
    return (data || []) as ChatMessageSearchHit[];
  }

  async listRoomAttachments(roomId: string): Promise<ChatLibraryAttachment[]> {
    const { data, error } = await this.supabase.rpc('chat_room_attachments', {
      p_room_id: roomId,
    });
    if (error) throw new Error(error.message);
    return (data || []) as ChatLibraryAttachment[];
  }

  async listRoomLinks(roomId: string): Promise<ChatLibraryLink[]> {
    const { data, error } = await this.supabase.rpc('chat_room_links', {
      p_room_id: roomId,
    });
    if (error) throw new Error(error.message);
    return (data || []) as ChatLibraryLink[];
  }

  async findMessageById(messageId: string): Promise<ChatMessage | null> {
    const { data, error } = await this.supabase
      .from('chat_room_messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', messageId)
      .maybeSingle();

    if (error || !data) return null;
    return data as ChatMessage;
  }

  async updateMessageContent(params: {
    messageId: string;
    senderId: string;
    content: string;
    mentions: ChatMention[];
    editedAt: string;
  }): Promise<ChatMessage> {
    const { data, error } = await this.supabase
      .from('chat_room_messages')
      .update({
        content: params.content,
        mentions: params.mentions,
        edited_at: params.editedAt,
      })
      .eq('id', params.messageId)
      .eq('sender_id', params.senderId)
      .is('deleted_at', null)
      .select(MESSAGE_COLUMNS)
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to edit message');
    }
    return data as ChatMessage;
  }

  async listReactionsForMessages(params: {
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
    messageId: string;
    userId: string;
    emoji: string;
  }): Promise<void> {
    const message = await this.findMessageById(params.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    const { data: existing, error: existingError } = await this.supabase
      .from('chat_room_message_reactions')
      .select('id')
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
        project_id: message.project_id,
        user_id: params.userId,
        emoji: params.emoji,
      } satisfies Omit<
        ChatMessageReaction,
        'id' | 'created_at' | 'updated_at'
      >);

    if (insertError) throw new Error(insertError.message);
  }

  async toggleRoomStar(params: {
    roomId: string;
    userId: string;
  }): Promise<{ starred: boolean }> {
    const { data: existing, error: existingError } = await this.supabase
      .from('chat_room_stars')
      .select('id')
      .eq('room_id', params.roomId)
      .eq('user_id', params.userId)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      throw new Error(existingError.message);
    }

    if (existing?.id) {
      const { error: deleteError } = await this.supabase
        .from('chat_room_stars')
        .delete()
        .eq('id', existing.id);
      if (deleteError) throw new Error(deleteError.message);
      return { starred: false };
    }

    const { error: insertError } = await this.supabase
      .from('chat_room_stars')
      .insert({ room_id: params.roomId, user_id: params.userId });

    if (insertError) throw new Error(insertError.message);
    return { starred: true };
  }

  async listStarredRoomIds(
    userId: string,
    roomIds: string[],
  ): Promise<Set<string>> {
    const starred = new Set<string>();
    if (roomIds.length === 0) return starred;

    const { data, error } = await this.supabase
      .from('chat_room_stars')
      .select('room_id')
      .eq('user_id', userId)
      .in('room_id', roomIds);

    if (error) throw new Error(error.message);
    for (const row of (data || []) as { room_id: string }[]) {
      starred.add(row.room_id);
    }
    return starred;
  }

  async listRoomNotificationLevels(
    roomId: string,
  ): Promise<Map<string, ChatNotificationLevel>> {
    const levels = new Map<string, ChatNotificationLevel>();

    const { data, error } = await this.supabase
      .from('chat_room_notification_prefs')
      .select('user_id, level')
      .eq('room_id', roomId);

    // FAIL OPEN. Returning an empty map means "no overrides", which resolves
    // every recipient to the default and notifies them — the opposite of the
    // `[]`-on-error convention used by the read projections above, and
    // deliberate: a lookup blip must never silently mute a whole room.
    if (error) {
      this.logger.warn(
        `listRoomNotificationLevels failed for room ${roomId}: ${error.message}`,
      );
      return levels;
    }

    for (const row of (data || []) as {
      user_id: string;
      level: ChatNotificationLevel;
    }[]) {
      levels.set(row.user_id, row.level);
    }
    return levels;
  }

  async listUserNotificationLevels(
    userId: string,
    roomIds: string[],
  ): Promise<Map<string, ChatNotificationLevel>> {
    const levels = new Map<string, ChatNotificationLevel>();
    if (roomIds.length === 0) return levels;

    const { data, error } = await this.supabase
      .from('chat_room_notification_prefs')
      .select('room_id, level')
      .eq('user_id', userId)
      .in('room_id', roomIds);

    if (error) throw new Error(error.message);
    for (const row of (data || []) as {
      room_id: string;
      level: ChatNotificationLevel;
    }[]) {
      levels.set(row.room_id, row.level);
    }
    return levels;
  }

  async setRoomNotificationLevel(params: {
    roomId: string;
    userId: string;
    level: ChatNotificationLevel;
  }): Promise<ChatRoomNotificationPreference> {
    // Back to the default? Delete the row rather than storing it. The table is
    // sparse by design, and a stored 'all' would be indistinguishable from an
    // override the user actually chose.
    if (params.level === DEFAULT_CHAT_NOTIFICATION_LEVEL) {
      const { error } = await this.supabase
        .from('chat_room_notification_prefs')
        .delete()
        .eq('room_id', params.roomId)
        .eq('user_id', params.userId);
      if (error) throw new Error(error.message);
      return {
        room_id: params.roomId,
        level: DEFAULT_CHAT_NOTIFICATION_LEVEL,
        is_default: true,
      };
    }

    const { error } = await this.supabase
      .from('chat_room_notification_prefs')
      .upsert(
        {
          room_id: params.roomId,
          user_id: params.userId,
          level: params.level,
        },
        { onConflict: 'room_id,user_id' },
      );

    if (error) throw new Error(error.message);
    return { room_id: params.roomId, level: params.level, is_default: false };
  }

  async softDeleteMessage(params: {
    messageId: string;
    senderId: string;
    deletedAt: string;
  }): Promise<void> {
    // Soft delete: keep the row (and its content) for the audit/dispute
    // foundation; the read projection masks content before it reaches clients.
    const { error } = await this.supabase
      .from('chat_room_messages')
      .update({ deleted_at: params.deletedAt })
      .eq('id', params.messageId)
      .eq('sender_id', params.senderId);

    if (error) throw new Error(error.message);
  }

  async findReplyTargets(messageIds: string[]): Promise<ChatMessage[]> {
    if (messageIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_room_messages')
      .select(MESSAGE_COLUMNS)
      .in('id', messageIds);

    if (error) throw new Error(error.message);
    return (data || []) as ChatMessage[];
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

    if (
      existingReadAt &&
      new Date(existingReadAt).getTime() >= new Date(readAt).getTime()
    ) {
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
