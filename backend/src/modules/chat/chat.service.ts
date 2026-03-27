import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SendChatMessageDto } from './dto/chat.dto';
import type {
  ChatRepository,
  ChatRole,
  ChatRoom,
} from './repositories/chat.repository.interface';

export const CHAT_REPOSITORY = Symbol('CHAT_REPOSITORY');

@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chatRepo: ChatRepository,
  ) {}

  private canDirectMessage(actorRole: ChatRole, targetRole: ChatRole): boolean {
    if (actorRole === 'consultant') return true;
    if (actorRole === 'client') return targetRole === 'consultant';
    return targetRole === 'consultant' || targetRole === 'freelancer';
  }

  private sortDmSlug(userA: string, userB: string): string {
    return [userA, userB].sort((a, b) => a.localeCompare(b)).join('_');
  }

  private async assertProjectAccess(projectId: string, userId: string): Promise<void> {
    const isMember = await this.chatRepo.isProjectMember(projectId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this project.');
    }
  }

  private async ensureChannelMembership(
    room: ChatRoom,
    projectId: string,
    userId: string,
  ): Promise<void> {
    if (room.type !== 'channel') return;
    const isMember = await this.chatRepo.isProjectMember(projectId, userId);
    if (!isMember) return;

    const isParticipant = await this.chatRepo.isRoomParticipant(room.id, userId);
    if (isParticipant) return;

    await this.chatRepo.upsertParticipants(room.id, projectId, [userId]);
  }

  async listRooms(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);

    const generalRoom = await this.chatRepo.findRoomBySlug(
      projectId,
      'channel',
      'general',
    );
    if (generalRoom) {
      await this.ensureChannelMembership(generalRoom, projectId, userId);
    }

    const rooms = await this.chatRepo.listRecentRooms(projectId, userId);
    return rooms
      .filter((room) => {
        if (room.type === 'dm') return !!room.last_message;
        if (room.type === 'channel' && room.slug === 'general') {
          return !!room.last_message;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = a.last_message?.created_at ?? a.updated_at;
        const bTime = b.last_message?.created_at ?? b.updated_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      })
      .map((room) => {
        const viewerParticipant =
          room.participants.find((participant) => participant.user_id === userId) ??
          null;
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
          room.participants.find((participant) => participant.user_id !== userId) ??
          null;
        return {
          ...room,
          counterpart,
          viewer_last_read_at: viewerLastReadAt,
          has_unread: hasUnread,
        };
      });
  }

  async listMembers(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);
    const actorRole = await this.chatRepo.resolveProjectRole(projectId, userId);
    if (!actorRole) {
      throw new ForbiddenException('You are not a member of this project.');
    }

    const members = await this.chatRepo.listProjectMemberCandidates(projectId);
    return members
      .filter((member) => member.user_id !== userId)
      .filter((member) => this.canDirectMessage(actorRole, member.role))
      .sort((a, b) => {
        const aName = a.user?.display_name || a.user?.email || a.user_id;
        const bName = b.user?.display_name || b.user?.email || b.user_id;
        return aName.localeCompare(bName);
      });
  }

  async listRoomMessages(
    projectId: string,
    roomId: string,
    userId: string,
    before?: string,
    limit = 30,
  ) {
    await this.assertProjectAccess(projectId, userId);

    const room = await this.chatRepo.findRoomById(projectId, roomId);
    if (!room) {
      throw new NotFoundException('Chat room not found.');
    }

    await this.ensureChannelMembership(room, projectId, userId);

    const isParticipant = await this.chatRepo.isRoomParticipant(roomId, userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this room.');
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const messages = await this.chatRepo.listRoomMessages({
      projectId,
      roomId,
      before,
      limit: safeLimit,
    });

    const chronologicalMessages = [...messages].reverse();
    const messageIds = chronologicalMessages.map((message) => message.id);
    const reactionsByMessage =
      messageIds.length > 0
        ? await this.chatRepo.listReactionsForMessages({
            projectId,
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

  private async resolveRoomForSend(params: {
    projectId: string;
    senderId: string;
    dto: SendChatMessageDto;
  }): Promise<ChatRoom> {
    const { projectId, senderId, dto } = params;

    if (dto.room_id) {
      const room = await this.chatRepo.findRoomById(projectId, dto.room_id);
      if (!room) {
        throw new NotFoundException('Chat room not found.');
      }

      await this.ensureChannelMembership(room, projectId, senderId);

      const isParticipant = await this.chatRepo.isRoomParticipant(room.id, senderId);
      if (!isParticipant) {
        throw new ForbiddenException('You are not a participant in this room.');
      }
      return room;
    }

    if (!dto.kind) {
      throw new BadRequestException('Either room_id or kind must be provided.');
    }

    if (dto.kind === 'channel') {
      const slug = (dto.slug || 'general').trim().toLowerCase();
      if (slug !== 'general') {
        throw new BadRequestException('Only the general channel is supported.');
      }

      const room = await this.chatRepo.upsertRoom({
        projectId,
        type: 'channel',
        slug: 'general',
        name: 'General',
      });
      const participantIds = await this.chatRepo.listProjectParticipantUserIds(
        projectId,
      );
      await this.chatRepo.upsertParticipants(room.id, projectId, participantIds);
      await this.chatRepo.upsertParticipants(room.id, projectId, [senderId]);
      return room;
    }

    if (!dto.recipient_id) {
      throw new BadRequestException('recipient_id is required for DM messages.');
    }

    const actorRole = await this.chatRepo.resolveProjectRole(projectId, senderId);
    const recipientRole = await this.chatRepo.resolveProjectRole(
      projectId,
      dto.recipient_id,
    );

    if (!actorRole || !recipientRole) {
      throw new ForbiddenException('Both users must be project participants.');
    }

    if (!this.canDirectMessage(actorRole, recipientRole)) {
      throw new ForbiddenException(
        'This direct message is not allowed by project governance.',
      );
    }

    const slug = this.sortDmSlug(senderId, dto.recipient_id);
    const room = await this.chatRepo.upsertRoom({
      projectId,
      type: 'dm',
      slug,
      name: null,
    });

    await this.chatRepo.upsertParticipants(room.id, projectId, [
      senderId,
      dto.recipient_id,
    ]);
    return room;
  }

  async sendMessage(projectId: string, senderId: string, dto: SendChatMessageDto) {
    await this.assertProjectAccess(projectId, senderId);

    const content = dto.content?.trim();
    if (!content) {
      throw new BadRequestException('Message content is required.');
    }

    const room = await this.resolveRoomForSend({ projectId, senderId, dto });
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

  async toggleMessageReaction(
    projectId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ) {
    await this.assertProjectAccess(projectId, userId);

    const normalizedEmoji = emoji?.trim();
    if (!normalizedEmoji) {
      throw new BadRequestException('Emoji is required.');
    }

    const message = await this.chatRepo.findMessageById(projectId, messageId);
    if (!message) {
      throw new NotFoundException('Chat message not found.');
    }

    const isParticipant = await this.chatRepo.isRoomParticipant(message.room_id, userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this room.');
    }

    await this.chatRepo.toggleMessageReaction({
      projectId,
      messageId,
      userId,
      emoji: normalizedEmoji,
    });

    return { ok: true };
  }

  async unsendMessage(projectId: string, messageId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);

    const message = await this.chatRepo.findMessageById(projectId, messageId);
    if (!message) {
      throw new NotFoundException('Chat message not found.');
    }

    const isParticipant = await this.chatRepo.isRoomParticipant(message.room_id, userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this room.');
    }

    if (message.sender_id !== userId) {
      throw new ForbiddenException('You can only unsend your own messages.');
    }

    await this.chatRepo.deleteMessage({
      projectId,
      messageId,
      senderId: userId,
    });

    return { ok: true };
  }

  async markRoomRead(projectId: string, roomId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);

    const room = await this.chatRepo.findRoomById(projectId, roomId);
    if (!room) {
      throw new NotFoundException('Chat room not found.');
    }

    await this.ensureChannelMembership(room, projectId, userId);

    const isParticipant = await this.chatRepo.isRoomParticipant(roomId, userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this room.');
    }

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
