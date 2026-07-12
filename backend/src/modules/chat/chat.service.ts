import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ChatAttachmentDto,
  ChatMentionDto,
  CreateChannelDto,
  EditMessageDto,
  SendChannelMessageDto,
  SendDmMessageDto,
  UpdateChannelDto,
} from './dto/chat.dto';
import { MissingPermissionException } from '../projects/authorization/missing-permission.exception';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { R2_CONFIG, type R2Config } from '../../config/r2.module';
import type {
  ChatAttachment,
  ChatMention,
  ChatMessage,
  ChatReplyPreview,
  ChatRepository,
  ChatRoom,
  ChatRoomWithLastMessage,
} from './repositories/chat.repository.interface';
import {
  type ChatEventKind,
  RealtimePublisher,
} from '../realtime/realtime-publisher.service';
import { AuditService } from '../audit/audit.service';
import { KnowledgeOutboxService } from '../knowledge/knowledge-outbox.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Sentinel `user_id` for an @everyone mention (expands to all room members). */
const EVERYONE_MENTION_ID = 'everyone';

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
    @Inject(R2_CONFIG) private readonly r2Config: R2Config,
    private readonly notifications: NotificationsService,
    private readonly knowledgeOutbox: KnowledgeOutboxService,
  ) {}

  /**
   * Normalize client-supplied @mention spans for storage. Validity of each
   * `user_id` is enforced lazily at notify time (`fireMentionNotifications`),
   * never on the send hot path — a bogus span at worst renders a chip and is
   * dropped before any ping.
   */
  private buildMentions(
    mentions: ChatMentionDto[] | undefined,
  ): ChatMention[] {
    if (!mentions || mentions.length === 0) return [];
    return mentions.map((mention) => ({
      user_id: mention.user_id,
      name: mention.name,
      offset: mention.offset,
      length: mention.length,
    }));
  }

  /**
   * Best-effort, non-blocking mention pings (mirrors the task-comment mention
   * flow). Expands @everyone to all room members, filters individual mentions to
   * real members, drops the sender, and creates a `chat_mention` notification per
   * recipient. Runs detached so it never adds latency to send.
   */
  private fireMentionNotifications(
    room: ChatRoom,
    message: ChatMessage,
    senderId: string,
    mentions: ChatMention[],
  ): void {
    if (!mentions.length) return;

    void (async () => {
      try {
        const wantsEveryone = mentions.some(
          (m) => m.user_id === EVERYONE_MENTION_ID,
        );
        const individualIds = mentions
          .map((m) => m.user_id)
          .filter((id) => id !== EVERYONE_MENTION_ID);
        if (!wantsEveryone && individualIds.length === 0) return;

        // Resolve who actually belongs to this room so a crafted payload can't
        // ping outsiders. Channels span the whole project; DMs the two members.
        const memberIds =
          room.type === 'channel' && room.project_id
            ? await this.chatRepo.listProjectParticipantUserIds(room.project_id)
            : await this.chatRepo.listRoomParticipantUserIds(room.id);
        const memberSet = new Set(memberIds);

        const targets = new Set<string>();
        if (wantsEveryone) {
          for (const id of memberIds) targets.add(id);
        }
        for (const id of individualIds) {
          if (memberSet.has(id)) targets.add(id);
        }
        targets.delete(senderId);
        if (targets.size === 0) return;

        const roomLabel =
          room.type === 'channel'
            ? `#${room.name || room.slug}`
            : 'a direct message';
        const linkUrl =
          room.type === 'channel' && room.project_id
            ? `/project/${room.project_id}/chat/${room.id}`
            : '/inbox';

        await Promise.allSettled(
          Array.from(targets).map((userId) =>
            this.notifications.createNotification({
              user_id: userId,
              actor_id: senderId,
              project_id: room.project_id || undefined,
              type_name: 'chat_mention',
              content: {
                message: `You were mentioned in ${roomLabel}`,
                room_id: room.id,
                message_id: message.id,
              },
              link_url: linkUrl,
            }),
          ),
        );
      } catch {
        // notifications are non-critical
      }
    })();
  }

  /**
   * Validate + normalize client-supplied attachments. Each `url` must point at
   * our CDN under `chat_attachments/<senderId>/` — the prefix the realtime
   * Worker writes when this user uploads — so a client can't attach an
   * arbitrary external URL or reference another user's object.
   */
  private buildAttachments(
    attachments: ChatAttachmentDto[] | undefined,
    senderId: string,
  ): ChatAttachment[] {
    if (!attachments || attachments.length === 0) return [];

    const prefix = `${this.r2Config.publicBaseUrl}/chat_attachments/${senderId}/`;
    return attachments.map((attachment) => {
      if (!attachment.url.startsWith(prefix)) {
        throw new BadRequestException('Invalid attachment URL.');
      }
      return {
        url: attachment.url,
        name: attachment.name,
        content_type: attachment.content_type,
        size: attachment.size,
        ...(attachment.width != null ? { width: attachment.width } : {}),
        ...(attachment.height != null ? { height: attachment.height } : {}),
      };
    });
  }

  /**
   * Lean preview of a reply target for the quote UI. Truncated, and content is
   * blanked when the target is itself soft-deleted (so a deleted message's text
   * can't leak through a reply that quotes it).
   */
  private toReplyPreview(target: ChatMessage): ChatReplyPreview {
    return {
      id: target.id,
      sender_id: target.sender_id,
      content: target.deleted_at ? '' : target.content.slice(0, 200),
      deleted_at: target.deleted_at,
    };
  }

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

  private async decorateRooms(
    rooms: ChatRoomWithLastMessage[],
    userId: string,
  ) {
    const starredRoomIds =
      rooms.length > 0
        ? await this.chatRepo.listStarredRoomIds(
            userId,
            rooms.map((room) => room.id),
          )
        : new Set<string>();

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
        const isStarred = starredRoomIds.has(room.id);
        // Mask a soft-deleted last message so the sidebar shows a tombstone
        // preview ("Message deleted") instead of leaking the original text.
        const maskedLastMessage =
          latestMessage && latestMessage.deleted_at
            ? { ...latestMessage, content: '', attachments: [], mentions: [] }
            : latestMessage;

        if (room.type !== 'dm') {
          return {
            ...room,
            last_message: maskedLastMessage,
            is_starred: isStarred,
            viewer_last_read_at: viewerLastReadAt,
            has_unread: hasUnread,
          };
        }
        const counterpart =
          room.participants.find((p) => p.user_id !== userId) ?? null;
        return {
          ...room,
          last_message: maskedLastMessage,
          is_starred: isStarred,
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

    // Hydrate a lean preview of any quoted (reply target) messages so the thread
    // can render the quote without a second round-trip per reply.
    const replyTargetIds = Array.from(
      new Set(
        chronologicalMessages
          .map((m) => m.reply_to_id)
          .filter((id): id is string => !!id),
      ),
    );
    const replyById = new Map(
      (replyTargetIds.length > 0
        ? await this.chatRepo.findReplyTargets(replyTargetIds)
        : []
      ).map((target) => [target.id, target]),
    );

    const enrichedMessages = chronologicalMessages.map((message) => {
      const target = message.reply_to_id
        ? replyById.get(message.reply_to_id) ?? null
        : null;
      const reply_to = target ? this.toReplyPreview(target) : null;
      // Soft-deleted: never ship the original content/attachments/mentions to
      // the client — only the tombstone marker (deleted_at).
      if (message.deleted_at) {
        return {
          ...message,
          content: '',
          attachments: [],
          mentions: [],
          reactions: [],
          reply_to,
        };
      }
      return {
        ...message,
        reactions: reactionsByMessage.get(message.id) ?? [],
        reply_to,
      };
    });

    const nextBefore =
      messages.length === safeLimit ? messages[messages.length - 1]?.created_at : null;

    return {
      room_id: roomId,
      messages: enrichedMessages,
      next_before: nextBefore,
    };
  }

  /** Word + fuzzy search of a room's messages (Messenger-style in-chat search). */
  async searchRoomMessages(
    roomId: string,
    userId: string,
    query: string,
    limit = 30,
  ) {
    await this.assertRoomAccess(roomId, userId);

    const q = query?.trim() ?? '';
    if (!q) {
      return { room_id: roomId, query: '', results: [] };
    }

    const results = await this.chatRepo.searchRoomMessages({
      roomId,
      query: q,
      limit: Math.min(Math.max(limit, 1), 50),
    });

    return { room_id: roomId, query: q, results };
  }

  /** Shared media / files / links for a room (the chat info panel library). */
  async getRoomLibrary(roomId: string, userId: string) {
    await this.assertRoomAccess(roomId, userId);

    const [attachments, links] = await Promise.all([
      this.chatRepo.listRoomAttachments(roomId),
      this.chatRepo.listRoomLinks(roomId),
    ]);

    const isImage = (contentType: string | null) =>
      (contentType ?? '').startsWith('image/');

    return {
      room_id: roomId,
      media: attachments.filter((a) => isImage(a.content_type)),
      files: attachments.filter((a) => !isImage(a.content_type)),
      links,
    };
  }

  async sendChannelMessage(
    projectId: string,
    senderId: string,
    dto: SendChannelMessageDto,
  ) {
    await this.assertProjectAccess(projectId, senderId);

    const content = dto.content?.trim() ?? '';
    const attachments = this.buildAttachments(dto.attachments, senderId);
    const mentions = this.buildMentions(dto.mentions);
    if (!content && attachments.length === 0) {
      throw new BadRequestException(
        'Message content or an attachment is required.',
      );
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
      attachments,
      mentions,
      replyToId: dto.reply_to_id ?? null,
    });

    this.fanoutChat(room.id, projectId, 'message');
    this.fireMentionNotifications(room, message, senderId, mentions);
    this.knowledgeOutbox.enqueue({
      sourceType: 'chat_message',
      sourceId: message.id,
      projectId,
      op: 'upsert',
    });

    return {
      room,
      message: {
        ...message,
        reactions: [],
      },
    };
  }

  async sendDmMessage(senderId: string, dto: SendDmMessageDto) {
    const content = dto.content?.trim() ?? '';
    const attachments = this.buildAttachments(dto.attachments, senderId);
    const mentions = this.buildMentions(dto.mentions);
    if (!content && attachments.length === 0) {
      throw new BadRequestException(
        'Message content or an attachment is required.',
      );
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
      attachments,
      mentions,
      replyToId: dto.reply_to_id ?? null,
    });

    this.fanoutChat(room.id, null, 'message');
    this.fireMentionNotifications(room, message, senderId, mentions);

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

  /**
   * Toggle a personal star on a whole room (favorite channel/DM). No fanout —
   * stars are per-user; the client updates optimistically.
   */
  async toggleRoomStar(roomId: string, userId: string) {
    await this.assertRoomAccess(roomId, userId);
    return this.chatRepo.toggleRoomStar({ roomId, userId });
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

    await this.chatRepo.softDeleteMessage({
      messageId,
      senderId: userId,
      deletedAt: new Date().toISOString(),
    });

    this.fanoutChat(message.room_id, message.project_id, 'message');
    if (message.project_id) {
      this.knowledgeOutbox.enqueue({
        sourceType: 'chat_message',
        sourceId: messageId,
        projectId: message.project_id,
        op: 'delete',
      });
    }

    return { ok: true };
  }

  /**
   * Edit a message's text + @mentions (sender-only). Attachments are unchanged
   * and a deleted message can't be edited. Stamps edited_at to drive the
   * "(edited)" label, then fans the change out so every viewer refetches.
   */
  async editMessage(messageId: string, userId: string, dto: EditMessageDto) {
    const message = await this.chatRepo.findMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Chat message not found.');
    }

    await this.assertRoomAccess(message.room_id, userId);

    if (message.sender_id !== userId) {
      throw new MissingPermissionException({
        path: null,
        message: 'You can only edit your own messages.',
        label: 'edit another member’s message',
      });
    }
    if (message.deleted_at) {
      throw new BadRequestException('You cannot edit a deleted message.');
    }

    const content = dto.content?.trim() ?? '';
    const mentions = this.buildMentions(dto.mentions);
    const hasAttachments = (message.attachments?.length ?? 0) > 0;
    if (!content && !hasAttachments) {
      throw new BadRequestException(
        'Message content or an attachment is required.',
      );
    }

    const updated = await this.chatRepo.updateMessageContent({
      messageId,
      senderId: userId,
      content,
      mentions,
      editedAt: new Date().toISOString(),
    });

    this.fanoutChat(message.room_id, message.project_id, 'message');
    if (message.project_id) {
      this.knowledgeOutbox.enqueue({
        sourceType: 'chat_message',
        sourceId: messageId,
        projectId: message.project_id,
        op: 'upsert',
      });
    }

    const reactionsByMessage = await this.chatRepo.listReactionsForMessages({
      messageIds: [messageId],
      viewerUserId: userId,
    });

    return {
      message: {
        ...updated,
        reactions: reactionsByMessage.get(messageId) ?? [],
      },
    };
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
    const room = await this.assertRoomAccess(roomId, userId);
    const participants = await this.chatRepo.listRoomParticipants(roomId);

    // Private channel: membership is explicit — return the real participants.
    if (room.is_private || !room.project_id) return participants;

    // Public channel: open to the whole project, so list the full roster, not
    // just whoever has lazy-joined by opening it. Reuse already-joined rows
    // (keeps joined_at/last_read_at) and synthesize a display-only row for
    // members who haven't opened the channel yet.
    const candidates = await this.chatRepo.listProjectMemberCandidates(
      room.project_id,
    );
    const joined = new Map(participants.map((p) => [p.user_id, p]));
    return candidates.map(
      (c) =>
        joined.get(c.user_id) ?? {
          room_id: roomId,
          user_id: c.user_id,
          joined_at: '',
          last_read_at: null,
          user: c.user,
        },
    );
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
