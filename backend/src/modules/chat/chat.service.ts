import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  SendChannelMessageDto,
  SendDmMessageDto,
} from './dto/chat.dto';
import { MissingPermissionException } from '../projects/authorization/missing-permission.exception';
import type {
  ChatRepository,
  ChatRoom,
  ChatRoomWithLastMessage,
} from './repositories/chat.repository.interface';

export const CHAT_REPOSITORY = Symbol('CHAT_REPOSITORY');

@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chatRepo: ChatRepository,
  ) {}

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

  private async ensureChannelMembership(
    room: ChatRoom,
    userId: string,
  ): Promise<void> {
    if (room.type !== 'channel') return;
    if (!room.project_id) return;
    const isMember = await this.chatRepo.isProjectMember(room.project_id, userId);
    if (!isMember) return;

    const isParticipant = await this.chatRepo.isRoomParticipant(room.id, userId);
    if (isParticipant) return;

    await this.chatRepo.upsertParticipants(room.id, room.project_id, [userId]);
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

    const generalRoom = await this.chatRepo.findChannelBySlug(
      projectId,
      'general',
    );
    if (generalRoom) {
      await this.ensureChannelMembership(generalRoom, userId);
    }

    const rooms = await this.chatRepo.listRoomsForProject(projectId, userId);
    const filtered = rooms.filter((room) => {
      if (room.type === 'channel' && room.slug === 'general') {
        return !!room.last_message;
      }
      return true;
    });
    return this.decorateRooms(filtered, userId);
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
      await this.ensureChannelMembership(room, userId);
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
    // Whether the sender is already (or just became) a room participant, so the
    // hot path can skip a redundant membership read.
    let senderIsParticipant = false;

    if (dto.room_id) {
      const existing = await this.chatRepo.findRoomById(dto.room_id);
      if (!existing || existing.type !== 'channel' || existing.project_id !== projectId) {
        throw new NotFoundException('Chat room not found.');
      }
      room = existing;
    } else {
      const slug = (dto.slug || 'general').trim().toLowerCase();
      if (slug !== 'general') {
        throw new BadRequestException('Only the general channel is supported.');
      }

      room = await this.chatRepo.upsertChannel({
        projectId,
        slug: 'general',
        name: 'General',
      });
      const participantIds =
        await this.chatRepo.listProjectParticipantUserIds(projectId);
      await this.chatRepo.upsertParticipants(room.id, projectId, participantIds);
      senderIsParticipant = participantIds.includes(senderId);
    }

    // assertProjectAccess above already confirmed the sender is a project
    // member, so for a channel we just need them joined to the room (that is
    // what surfaces it in their sidebar). One read + conditional join instead
    // of the previous duplicate membership/participant round-trips.
    if (!senderIsParticipant) {
      const alreadyParticipant = await this.chatRepo.isRoomParticipant(
        room.id,
        senderId,
      );
      if (!alreadyParticipant) {
        await this.chatRepo.upsertParticipants(room.id, projectId, [senderId]);
      }
    }

    const message = await this.chatRepo.createMessage({
      roomId: room.id,
      projectId,
      senderId,
      content,
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
      await this.chatRepo.upsertParticipants(room.id, null, [
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
    await this.chatRepo.upsertParticipants(room.id, null, [senderId, recipientId]);
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

    return { ok: true };
  }

  async markRoomRead(roomId: string, userId: string) {
    await this.assertRoomAccess(roomId, userId);

    const lastReadAt = await this.chatRepo.markRoomRead({
      roomId,
      userId,
      readAt: new Date().toISOString(),
    });

    return {
      ok: true,
      room_id: roomId,
      last_read_at: lastReadAt,
    };
  }
}
