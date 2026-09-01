import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { truncatePromptText } from '../../../common/utils/html-to-text.util';
import { MENTION_EXCERPT_MAX_CHARS } from '../../shared/notifications/notification-content';
import { buildChatHeadline } from '../../shared/push/notification-push';
import type { PushTarget } from '../../shared/push/push.service';
import { PushService } from '../../shared/push/push.service';
import { CHAT_REPOSITORY, EVERYONE_MENTION_ID } from './chat.tokens';
import {
  type ChatMention,
  type ChatMessage,
  type ChatNotificationLevel,
  type ChatRepository,
  type ChatRoom,
  DEFAULT_CHAT_NOTIFICATION_LEVEL,
} from './repositories/chat.repository.interface';

export interface ChatPushParams {
  room: ChatRoom;
  message: ChatMessage;
  senderId: string;
  actorName: string | null;
  mentions: ChatMention[];
  /** Everyone who can see this room, sender included; filtered here. */
  recipientIds: string[];
}

/**
 * Owns push for chat messages.
 *
 * Push used to be a side effect of inserting a `notifications` row, and that row
 * is deduped to one per room per read-cycle (`findLiveChatRoomNotification`).
 * The consequence was a silent, long-lived bug: one unread bell row suppressed
 * every later message in that conversation, so a DM thread went quiet after its
 * first message and only `@mentions` — which have no dedup — got through.
 *
 * So push moved here and runs per MESSAGE, while the bell row and the email
 * digest keep their dedup. Chat call sites pass `skipPush` to
 * `createNotification`; without that, message one of a burst would push twice.
 *
 * Called inside `runNotifyWork`, so it is awaited and bounded — Cloud Run
 * throttles CPU once the response flushes, and a detached tail can be frozen and
 * killed with no trace the notification was ever attempted.
 */
@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);

  constructor(
    @Inject(CHAT_REPOSITORY) private readonly chatRepo: ChatRepository,
    private readonly push: PushService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A one-line stand-in for a message with no text, so an attachment-only
   * message is not delivered as a blank notification. Fixes a real gap on the
   * mention path, which produced no excerpt at all in that case.
   */
  private describeAttachments(message: ChatMessage): string | null {
    const first = message.attachments?.[0];
    if (!first) return null;
    const extra = (message.attachments?.length ?? 0) - 1;
    const suffix = extra > 0 ? ` +${extra}` : '';
    return (first.content_type ?? '').startsWith('image/')
      ? `📷 Photo${suffix}`
      : `📎 ${first.name}${suffix}`;
  }

  /** `#general` for a channel; null for a DM, where the sender is the whole title. */
  roomLabel(room: ChatRoom): string | null {
    return room.type === 'channel' ? `#${room.name || room.slug}` : null;
  }

  /** The message text as a notification body, or an attachment stand-in. */
  previewText(message: ChatMessage): string | null {
    const body = (message.content ?? '').trim();
    if (body.length > 0) {
      return truncatePromptText(body, MENTION_EXCERPT_MAX_CHARS);
    }
    return this.describeAttachments(message);
  }

  private isMentioned(userId: string, mentions: ChatMention[]): boolean {
    return mentions.some(
      (m) => m.user_id === userId || m.user_id === EVERYONE_MENTION_ID,
    );
  }

  private allows(level: ChatNotificationLevel, mentioned: boolean): boolean {
    if (level === 'none') return false;
    if (level === 'mentions') return mentioned;
    return true;
  }

  async sendForMessage(params: ChatPushParams): Promise<void> {
    const { room, message, senderId, actorName, mentions } = params;

    try {
      const recipients = Array.from(new Set(params.recipientIds)).filter(
        (id) => id !== senderId,
      );
      if (recipients.length === 0) return;

      // Sparse: only users who set an override appear. Everyone else resolves to
      // the default, which is `all` — every message notifies until muted.
      const levels = await this.chatRepo.listRoomNotificationLevels(room.id);

      const audience = recipients.filter((userId) =>
        this.allows(
          levels.get(userId) ?? DEFAULT_CHAT_NOTIFICATION_LEVEL,
          this.isMentioned(userId, mentions),
        ),
      );
      if (audience.length === 0) return;

      const headline = buildChatHeadline({
        actorName,
        roomLabel: this.roomLabel(room),
        text: this.previewText(message),
      });

      const linkUrl =
        room.type === 'channel' && room.project_id
          ? `/project/${room.project_id}/chat/${room.id}`
          : // `r`, not `room` — the search param /inbox validates. Without it the
            // tap lands on the inbox list instead of the thread.
            `/inbox?r=${room.id}`;

      const data: Record<string, string> = {
        type: 'chat_message',
        room_id: room.id,
        message_id: message.id,
        sender_id: senderId,
        link_url: linkUrl,
      };
      if (room.project_id) data.project_id = room.project_id;

      const channelId = this.config.get<string>('PUSH_ANDROID_CHAT_CHANNEL_ID');

      const targets: PushTarget[] = audience.map((userId) => ({
        userId,
        message: {
          ...headline,
          data,
          threadKey: `chat:${room.id}`,
          ...(channelId ? { channelId } : {}),
        },
      }));

      await this.push.sendToUsers(targets);
    } catch (err) {
      // Never fail the send that triggered it.
      this.logger.warn(
        `chat push failed for room ${room.id}: ${(err as Error)?.message}`,
      );
    }
  }
}
