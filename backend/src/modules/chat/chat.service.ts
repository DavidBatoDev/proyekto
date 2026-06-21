import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateChannelDto,
  SendChannelMessageDto,
  SendDmMessageDto,
  UpdateChannelDto,
} from './dto/chat.dto';
import { MissingPermissionException } from '../projects/authorization/missing-permission.exception';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import type {
  ChatRepository,
  ChatRoom,
  ChatRoomWithLastMessage,
} from './repositories/chat.repository.interface';
import {
  type ChatEventKind,
  RealtimePublisher,
} from '../realtime/realtime-publisher.service';
import { AuditService } from '../audit/audit.service';

export const CHAT_REPOSITORY = Symbol('CHAT_REPOSITORY');

type SystemRoomSpec = {
  slug: string;
  name: string;
  isPrivate: boolean;
};

/**
 * Both normal projects and personal workspaces auto-provision a single public
 * #general now. The 4 PRD persona rooms (Client Project Room / Internal Team /
 * Consultant & Client / Consultant & PM) are no longer auto-created — they're
 * offered as opt-in presets in the web "Create channel" modal
 * (`CHANNEL_SUGGESTIONS` in web/src/components/project/chat/channelSuggestions.ts).
 */
const PROJECT_SYSTEM_ROOMS: SystemRoomSpec[] = [
  { slug: 'general', name: 'General', isPrivate: false },
];

/** Personal (solo) workspaces just get a single public #general. */
const PERSONAL_SYSTEM_ROOMS: SystemRoomSpec[] = [
  { slug: 'general', name: 'General', isPrivate: false },
];

/**
 * Slugs of the auto-provisioned default rooms (both modes). Default rooms are
 * identified by slug now that the system_key column is gone — used to keep them
 * un-archivable. `uniqueChannelSlug` prevents user channels from taking these.
 */
const DEFAULT_CHANNEL_SLUGS = new Set<string>(
  [...PROJECT_SYSTEM_ROOMS, ...PERSONAL_SYSTEM_ROOMS].map((r) => r.slug),
);

@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chatRepo: ChatRepository,
    private readonly realtime: RealtimePublisher,
    private readonly authorization: ProjectAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Fan a chat change out to every room participant's inbox DO. Fully
   * off the response path (the participant lookup + publish run detached) so
   * it never adds latency to the send/react hot path.
   */
  private fanoutChat(
    roomId: string,
    projectId: string | null,
    kind: ChatEventKind,
  ): void {
    void (async () => {
      try {
        const recipientIds =
          await this.chatRepo.listRoomParticipantUserIds(roomId);
        this.realtime.publishChatEvent({
          recipientIds,
          roomId,
          projectId,
          kind,
        });
      } catch {
        // best-effort; realtime is non-critical
      }
    })();
  }

  private sortDmSlug(userA: string, userB: string): string {
    return [userA, userB].sort((a, b) => a.localeCompare(b)).join('_');
  }

  private async assertProjectAccess(projectId: string, userId: string): Promise<void> {
    const isMember = await this.chatRepo.isProjectMember(projectId, userId);
    if (!isMember) {
      throw new MissingPermissionException({
        path: 'access.chat',
        message: 'You are not a member of this project.',
      });
    }
  }

  /**
   * Resolve the viewer's persona context on a project. Consultant/client come
   * from the chat persona resolver; PM is approximated by the IAM admin/owner
   * role (no dedicated PM role exists yet).
   */
  /** True when the viewer is the project's consultant (all-channel access). */
  private async isProjectConsultant(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    return (
      (await this.chatRepo.resolveProjectRole(projectId, userId)) ===
      'consultant'
    );
  }

  /**
   * Whether the viewer may see `room` (Slack-style membership). The consultant
   * keeps all-channel access; public channels are visible to every project
   * member; private channels only to explicit participants.
   */
  private canViewChannel(
    room: ChatRoom,
    isConsultant: boolean,
    isParticipant: boolean,
  ): boolean {
    if (isConsultant) return true;
    if (!room.is_private) return true;
    return isParticipant;
  }

  /**
   * For a single channel, lazily join the viewer if they're allowed to see it
   * (membership powers realtime fan-out + unread). No-op for DMs and for
   * channels the viewer cannot access.
   */
  private async ensureChannelAccess(
    room: ChatRoom,
    userId: string,
  ): Promise<void> {
    if (room.type !== 'channel' || !room.project_id) return;
    if (await this.chatRepo.isRoomParticipant(room.id, userId)) return;
    if (!(await this.chatRepo.isProjectMember(room.project_id, userId))) return;

    const isConsultant = await this.isProjectConsultant(room.project_id, userId);
    if (this.canViewChannel(room, isConsultant, false)) {
      await this.chatRepo.upsertParticipants(room.id, [userId]);
    }
  }

  private decorateRooms(
    rooms: ChatRoomWithLastMessage[],
    userId: string,
  ) {
    return rooms
      .sort((a, b) => {
        const aTime = a.last_message?.created_at ?? a.updated_at;
        const bTime = b.last_message?.created_at ?? b.updated_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      })
      .map((room) => {
        const viewerParticipant =
          room.participants.find((p) => p.user_id === userId) ?? null;
        const viewerLastReadAt = viewerParticipant?.last_read_at ?? null;
        const latestMessage = room.last_message;
        const hasUnread = latestMessage
          ? viewerLastReadAt
            ? new Date(latestMessage.created_at).getTime() >
              new Date(viewerLastReadAt).getTime()
            : latestMessage.sender_id !== userId
          : false;

        if (room.type !== 'dm') {
          return {
            ...room,
            viewer_last_read_at: viewerLastReadAt,
            has_unread: hasUnread,
          };
        }
        const counterpart =
          room.participants.find((p) => p.user_id !== userId) ?? null;
        return {
          ...room,
          counterpart,
          viewer_last_read_at: viewerLastReadAt,
          has_unread: hasUnread,
        };
      });
  }

  /** Project chat: channels only (DMs are now global). */
  async listRooms(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);

    // Default rooms are provisioned at project creation (and lazily on a
    // no-room send); no backfill here.
    const channels = await this.chatRepo.listProjectChannels(projectId);

    const isConsultant = await this.isProjectConsultant(projectId, userId);
    const channelIds = channels.map((room) => room.id);
    const myParticipantRoomIds = new Set(
      await this.chatRepo.listParticipantRoomIds(userId, channelIds),
    );

    const visibleIds: string[] = [];
    const toJoin: string[] = [];
    for (const room of channels) {
      const isParticipant = myParticipantRoomIds.has(room.id);
      if (!this.canViewChannel(room, isConsultant, isParticipant)) continue;
      visibleIds.push(room.id);
      if (!isParticipant) toJoin.push(room.id);
    }

    // Lazy-join the viewer to every channel they may see (powers realtime
    // fan-out + unread). After the first list these are already joined, so
    // subsequent calls do no writes.
    if (toJoin.length > 0) {
      await Promise.all(
        toJoin.map((roomId) =>
          this.chatRepo.upsertParticipants(roomId, [userId]),
        ),
      );
    }

    const hydrated = await this.chatRepo.hydrateRoomsByIds(visibleIds, userId);
    return this.decorateRooms(hydrated, userId);
  }

  /** Global DM list for the current user. */
  async listDmRooms(userId: string) {
    const rooms = await this.chatRepo.listDmRoomsForUser(userId);
    const filtered = rooms.filter((room) => !!room.last_message);
    return this.decorateRooms(filtered, userId);
  }

  async listMembers(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);
    const actorRole = await this.chatRepo.resolveProjectRole(projectId, userId);
    if (!actorRole) {
      throw new MissingPermissionException({
        path: 'access.chat',
        message: 'You are not a member of this project.',
      });
    }

    const members = await this.chatRepo.listProjectMemberCandidates(projectId);
    return members
      .filter((member) => member.user_id !== userId)
      .sort((a, b) => {
        const aName = a.user?.display_name || a.user?.email || a.user_id;
        const bName = b.user?.display_name || b.user?.email || b.user_id;
        return aName.localeCompare(bName);
      });
  }

  /** DM-eligible members of a project (for the in-project chat sidebar). */
  async listDmEligibleMembers(projectId: string, userId: string) {
    return this.listMembers(projectId, userId);
  }

  private async assertRoomAccess(roomId: string, userId: string): Promise<ChatRoom> {
    const room = await this.chatRepo.findRoomById(roomId);
    if (!room) {
      throw new NotFoundException('Chat room not found.');
    }

    if (room.type === 'channel') {
      if (!room.project_id) {
        throw new NotFoundException('Chat room not found.');
      }
      await this.assertProjectAccess(room.project_id, userId);
      await this.ensureChannelAccess(room, userId);
    }

    const isParticipant = await this.chatRepo.isRoomParticipant(room.id, userId);
    if (!isParticipant) {
      throw new MissingPermissionException({
        path: 'chat.view_channels',
        message: 'You are not a participant in this room.',
      });
    }

    return room;
  }

  /**
   * Boolean room-access check for the realtime authorize endpoint. Wraps the
   * same membership rules as message reads (assertRoomAccess) but returns a
   * boolean instead of throwing, so the Worker can map it to allow/deny.
   */
  async canAccessRoom(roomId: string, userId: string): Promise<boolean> {
    try {
      await this.assertRoomAccess(roomId, userId);
      return true;
    } catch {
      return false;
    }
  }

  async listRoomMessages(
    roomId: string,
    userId: string,
    before?: string,
    limit = 30,
  ) {
    await this.assertRoomAccess(roomId, userId);

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const messages = await this.chatRepo.listRoomMessages({
      roomId,
      before,
      limit: safeLimit,
    });

    const chronologicalMessages = [...messages].reverse();
    const messageIds = chronologicalMessages.map((m) => m.id);
    const reactionsByMessage =
      messageIds.length > 0
        ? await this.chatRepo.listReactionsForMessages({
            messageIds,
            viewerUserId: userId,
          })
        : new Map<string, { emoji: string; count: number; reacted_by_me: boolean }[]>();

    const enrichedMessages = chronologicalMessages.map((message) => ({
      ...message,
      reactions: reactionsByMessage.get(message.id) ?? [],
    }));

    const nextBefore =
      messages.length === safeLimit ? messages[messages.length - 1]?.created_at : null;

    return {
      room_id: roomId,
      messages: enrichedMessages,
      next_before: nextBefore,
    };
  }

  async sendChannelMessage(
    projectId: string,
    senderId: string,
    dto: SendChannelMessageDto,
  ) {
    await this.assertProjectAccess(projectId, senderId);

    const content = dto.content?.trim();
    if (!content) {
      throw new BadRequestException('Message content is required.');
    }

    let room: ChatRoom;

    if (dto.room_id) {
      // Fast path: the sender is already a participant (true right after
      // listRooms joined them — the common case).
      const joined = await this.chatRepo.findRoomForParticipant(
        dto.room_id,
        senderId,
      );
      if (
        joined &&
        joined.type === 'channel' &&
        joined.project_id === projectId &&
        !joined.is_archived
      ) {
        room = joined;
      } else {
        // Not yet joined: resolve the room, confirm it's a non-archived channel
        // in this project, and grant access per the visibility rules.
        const existing = await this.chatRepo.findRoomById(dto.room_id);
        if (
          !existing ||
          existing.type !== 'channel' ||
          existing.project_id !== projectId ||
          existing.is_archived
        ) {
          throw new NotFoundException('Chat room not found.');
        }
        await this.ensureChannelAccess(existing, senderId);
        if (!(await this.chatRepo.isRoomParticipant(existing.id, senderId))) {
          throw new MissingPermissionException({
            path: 'chat.send_messages',
            message: 'You cannot post to this channel.',
          });
        }
        room = existing;
      }
    } else {
      // Legacy / no-room send → resolve a default channel. Provisioning is
      // idempotent, so this also self-heals a project missing default rooms.
      await this.provisionDefaultChannels(projectId, senderId);
      const slug = (dto.slug || '').trim().toLowerCase();
      const resolved =
        (slug ? await this.chatRepo.findChannelBySlug(projectId, slug) : null) ??
        (await this.chatRepo.findChannelBySlug(projectId, 'general'));
      if (!resolved) {
        throw new NotFoundException('Chat room not found.');
      }
      await this.ensureChannelAccess(resolved, senderId);
      room = resolved;
    }

    const message = await this.chatRepo.createMessage({
      roomId: room.id,
      projectId,
      senderId,
      content,
    });

    this.fanoutChat(room.id, projectId, 'message');

    return {
      room,
      message: {
        ...message,
        reactions: [],
      },
    };
  }

  async sendDmMessage(senderId: string, dto: SendDmMessageDto) {
    const content = dto.content?.trim();
    if (!content) {
      throw new BadRequestException('Message content is required.');
    }

    let room: ChatRoom;
    if (dto.room_id) {
      // One round-trip: resolves the room and confirms participation together.
      const existing = await this.chatRepo.findRoomForParticipant(
        dto.room_id,
        senderId,
      );
      if (!existing || existing.type !== 'dm') {
        throw new MissingPermissionException({
          path: 'chat.send_dm',
          message: 'You are not a participant in this DM.',
        });
      }
      room = existing;
    } else {
      if (!dto.recipient_id) {
        throw new BadRequestException('recipient_id is required for DM messages.');
      }
      if (dto.recipient_id === senderId) {
        throw new BadRequestException('Cannot DM yourself.');
      }

      const canDm = await this.chatRepo.usersShareAnyProject(senderId, dto.recipient_id);
      if (!canDm) {
        throw new MissingPermissionException({
          path: 'chat.send_dm',
          message: 'You can only DM people you share a project with.',
        });
      }

      const slug = this.sortDmSlug(senderId, dto.recipient_id);
      room = await this.chatRepo.upsertDm({ slug });
      await this.chatRepo.upsertParticipants(room.id, [
        senderId,
        dto.recipient_id,
      ]);
    }

    const message = await this.chatRepo.createMessage({
      roomId: room.id,
      projectId: null,
      senderId,
      content,
    });

    this.fanoutChat(room.id, null, 'message');

    return {
      room,
      message: {
        ...message,
        reactions: [],
      },
    };
  }

  /**
   * Resolve (or create) the global DM room with a specific recipient — useful
   * for the web UI when the user clicks "Message X" before sending any text.
   */
  async resolveDmRoom(senderId: string, recipientId: string) {
    if (!recipientId || recipientId === senderId) {
      throw new BadRequestException('A valid recipient_id is required.');
    }

    const canDm = await this.chatRepo.usersShareAnyProject(senderId, recipientId);
    if (!canDm) {
      throw new MissingPermissionException({
        path: 'chat.send_dm',
        message: 'You can only DM people you share a project with.',
      });
    }

    const slug = this.sortDmSlug(senderId, recipientId);
    const room = await this.chatRepo.upsertDm({ slug });
    await this.chatRepo.upsertParticipants(room.id, [senderId, recipientId]);
    return room;
  }

  async toggleMessageReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ) {
    const normalizedEmoji = emoji?.trim();
    if (!normalizedEmoji) {
      throw new BadRequestException('Emoji is required.');
    }

    const message = await this.chatRepo.findMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Chat message not found.');
    }

    await this.assertRoomAccess(message.room_id, userId);

    await this.chatRepo.toggleMessageReaction({
      messageId,
      userId,
      emoji: normalizedEmoji,
    });

    this.fanoutChat(message.room_id, message.project_id, 'reaction');

    return { ok: true };
  }

  async unsendMessage(messageId: string, userId: string) {
    const message = await this.chatRepo.findMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Chat message not found.');
    }

    await this.assertRoomAccess(message.room_id, userId);

    if (message.sender_id !== userId) {
      throw new MissingPermissionException({
        path: null,
        message: 'You can only unsend your own messages.',
        label: 'unsend another member’s message',
      });
    }

    await this.chatRepo.deleteMessage({
      messageId,
      senderId: userId,
    });

    this.fanoutChat(message.room_id, message.project_id, 'message');

    return { ok: true };
  }

  async markRoomRead(roomId: string, userId: string) {
    const room = await this.assertRoomAccess(roomId, userId);

    const lastReadAt = await this.chatRepo.markRoomRead({
      roomId,
      userId,
      readAt: new Date().toISOString(),
    });

    // Read pointers are personal — only notify the reader's own inbox (their
    // other tabs/devices) so unread badges sync without bothering others.
    this.realtime.publishChatEvent({
      recipientIds: [userId],
      roomId,
      projectId: room.project_id,
      kind: 'read',
    });

    return {
      ok: true,
      room_id: roomId,
      last_read_at: lastReadAt,
    };
  }

  // ── Channel management ────────────────────────────────────────────────────

  /**
   * Idempotently create the default channel(s) for a project. Both normal
   * projects and personal workspaces now get a single public #general; the
   * creator is seeded as a participant. The 4 PRD persona rooms are opt-in
   * presets in the web create-channel modal, not auto-provisioned.
   */
  async provisionDefaultChannels(
    projectId: string,
    creatorId: string,
    mode?: 'project' | 'personal',
  ): Promise<void> {
    const resolvedMode =
      mode ??
      ((await this.chatRepo.getProjectIsPersonal(projectId))
        ? 'personal'
        : 'project');
    const specs =
      resolvedMode === 'personal'
        ? PERSONAL_SYSTEM_ROOMS
        : PROJECT_SYSTEM_ROOMS;

    for (const spec of specs) {
      const room = await this.chatRepo.upsertChannel({
        projectId,
        slug: spec.slug,
        name: spec.name,
        isPrivate: spec.isPrivate,
        createdBy: creatorId,
      });
      // Seed the creator so the private default rooms are visible to them
      // immediately — visibility is now pure membership. Idempotent.
      await this.chatRepo.upsertParticipants(room.id, [creatorId]);
    }
  }

  async createChannel(
    projectId: string,
    userId: string,
    dto: CreateChannelDto,
  ): Promise<ChatRoomWithLastMessage> {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'chat.create_channels',
    );

    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException('Channel name is required.');
    }

    const slug = await this.uniqueChannelSlug(projectId, name);
    const room = await this.chatRepo.upsertChannel({
      projectId,
      slug,
      name,
      isPrivate: !!dto.is_private,
      createdBy: userId,
    });
    await this.chatRepo.upsertParticipants(room.id, [userId]);

    this.audit.log({
      projectId,
      actorId: userId,
      action: 'channel.created',
      entityType: 'chat_channel',
      entityId: room.id,
      metadata: { name, slug, is_private: !!dto.is_private },
    });
    this.notifyProjectRoomsChanged(projectId, room.id);

    const [hydrated] = await this.chatRepo.hydrateRoomsByIds([room.id], userId);
    return hydrated ?? { ...room, last_message: null, participants: [] };
  }

  async updateChannel(
    projectId: string,
    userId: string,
    roomId: string,
    dto: UpdateChannelDto,
  ): Promise<ChatRoom> {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'chat.manage_channels',
    );

    const room = await this.chatRepo.findRoomById(roomId);
    if (!room || room.type !== 'channel' || room.project_id !== projectId) {
      throw new NotFoundException('Chat room not found.');
    }
    if (DEFAULT_CHANNEL_SLUGS.has(room.slug) && dto.is_archived === true) {
      throw new BadRequestException(
        'Default project channels cannot be archived.',
      );
    }

    const name = typeof dto.name === 'string' ? dto.name.trim() : undefined;
    if (name !== undefined && name.length === 0) {
      throw new BadRequestException('Channel name cannot be empty.');
    }

    const updated = await this.chatRepo.updateRoom(roomId, {
      name,
      is_archived: dto.is_archived,
      is_private: dto.is_private,
    });

    this.audit.log({
      projectId,
      actorId: userId,
      action: dto.is_archived === true ? 'channel.archived' : 'channel.updated',
      entityType: 'chat_channel',
      entityId: roomId,
      metadata: { name, is_archived: dto.is_archived, is_private: dto.is_private },
    });
    this.notifyProjectRoomsChanged(projectId, roomId);

    return updated;
  }

  async listChannelMembers(roomId: string, userId: string) {
    await this.assertRoomAccess(roomId, userId);
    return this.chatRepo.listRoomParticipants(roomId);
  }

  async addChannelMember(
    projectId: string,
    userId: string,
    roomId: string,
    memberId: string,
  ): Promise<{ ok: true }> {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'chat.manage_channels',
    );

    const room = await this.chatRepo.findRoomById(roomId);
    if (!room || room.type !== 'channel' || room.project_id !== projectId) {
      throw new NotFoundException('Chat room not found.');
    }
    if (!(await this.chatRepo.isProjectMember(projectId, memberId))) {
      throw new BadRequestException('User is not a member of this project.');
    }

    await this.chatRepo.upsertParticipants(roomId, [memberId]);

    this.audit.log({
      projectId,
      actorId: userId,
      action: 'channel.member_added',
      entityType: 'chat_channel',
      entityId: roomId,
      metadata: { member_id: memberId },
    });
    this.notifyProjectRoomsChanged(projectId, roomId);

    return { ok: true };
  }

  async removeChannelMember(
    projectId: string,
    userId: string,
    roomId: string,
    memberId: string,
  ): Promise<{ ok: true }> {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'chat.manage_channels',
    );

    const room = await this.chatRepo.findRoomById(roomId);
    if (!room || room.type !== 'channel' || room.project_id !== projectId) {
      throw new NotFoundException('Chat room not found.');
    }

    await this.chatRepo.removeParticipant(roomId, memberId);

    this.audit.log({
      projectId,
      actorId: userId,
      action: 'channel.member_removed',
      entityType: 'chat_channel',
      entityId: roomId,
      metadata: { member_id: memberId },
    });
    this.notifyProjectRoomsChanged(projectId, roomId);

    return { ok: true };
  }

  /**
   * Self-service: the caller leaves a channel they're in. No `manage_channels`
   * permission required (unlike removeChannelMember). Public channels re-add the
   * viewer on the next listRooms (lazy-join), so this is mainly for private ones.
   */
  async leaveChannel(
    projectId: string,
    userId: string,
    roomId: string,
  ): Promise<{ ok: true }> {
    await this.assertProjectAccess(projectId, userId);

    const room = await this.chatRepo.findRoomById(roomId);
    if (!room || room.type !== 'channel' || room.project_id !== projectId) {
      throw new NotFoundException('Chat room not found.');
    }

    await this.chatRepo.removeParticipant(roomId, userId);

    this.audit.log({
      projectId,
      actorId: userId,
      action: 'channel.left',
      entityType: 'chat_channel',
      entityId: roomId,
      metadata: {},
    });
    this.notifyProjectRoomsChanged(projectId, roomId);

    return { ok: true };
  }

  /** Project activity timeline (dispute-resolution history). */
  async listActivity(
    projectId: string,
    userId: string,
    opts: { limit?: number; offset?: number },
  ) {
    await this.authorization.assertPermission(userId, projectId, 'logs.view');
    return this.audit.list(projectId, opts);
  }

  /**
   * Notify every project member's inbox that the channel list changed so their
   * sidebar/inbox refetches (a brand-new or renamed channel has no message
   * event to piggyback on). Best-effort, off the response path.
   */
  private notifyProjectRoomsChanged(projectId: string, roomId: string): void {
    void (async () => {
      try {
        const recipientIds =
          await this.chatRepo.listProjectParticipantUserIds(projectId);
        this.realtime.publishChatEvent({
          recipientIds,
          roomId,
          projectId,
          kind: 'message',
        });
      } catch {
        // realtime is non-critical
      }
    })();
  }

  /** Slugify a channel name and ensure it's unique within the project. */
  private async uniqueChannelSlug(
    projectId: string,
    name: string,
  ): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'channel';

    let slug = base;
    let n = 1;
    while (await this.chatRepo.findChannelBySlug(projectId, slug)) {
      n += 1;
      if (n > 50) {
        slug = `${base}-${Date.now().toString(36)}`;
        break;
      }
      slug = `${base}-${n}`;
    }
    return slug;
  }
}
