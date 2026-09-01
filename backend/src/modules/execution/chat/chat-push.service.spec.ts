import { ChatPushService } from './chat-push.service';
import type {
  ChatMessage,
  ChatNotificationLevel,
  ChatRepository,
  ChatRoom,
} from './repositories/chat.repository.interface';

describe('ChatPushService', () => {
  const dmRoom: ChatRoom = {
    id: 'room-dm',
    project_id: null,
    type: 'dm',
    slug: 'a__b',
    name: null,
    is_private: true,
    is_archived: false,
    archived_at: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  };

  const channelRoom: ChatRoom = {
    ...dmRoom,
    id: 'room-chan',
    project_id: 'project-1',
    type: 'channel',
    slug: 'general',
    name: 'General',
  };

  const message = (overrides: Partial<ChatMessage> = {}): ChatMessage =>
    ({
      id: 'msg-1',
      room_id: 'room-dm',
      project_id: null,
      sender_id: 'sender',
      content: 'are you free at 3?',
      attachments: [],
      mentions: [],
      edited_at: null,
      deleted_at: null,
      reply_to_id: null,
      created_at: '',
      updated_at: '',
      ...overrides,
    }) as ChatMessage;

  const build = (levels: Record<string, ChatNotificationLevel> = {}) => {
    const sendToUsers = jest.fn().mockResolvedValue(undefined);
    const repo = {
      listRoomNotificationLevels: jest
        .fn()
        .mockResolvedValue(new Map(Object.entries(levels))),
    } as unknown as ChatRepository;
    const service = new ChatPushService(
      repo,
      { sendToUsers } as never,
      { get: () => undefined } as never,
    );
    return { service, sendToUsers, repo };
  };

  const send = (
    service: ChatPushService,
    overrides: Partial<Parameters<ChatPushService['sendForMessage']>[0]> = {},
  ) =>
    service.sendForMessage({
      room: dmRoom,
      message: message(),
      senderId: 'sender',
      actorName: 'Ada Lovelace',
      mentions: [],
      recipientIds: ['sender', 'r1'],
      ...overrides,
    });

  it('sends the sender name and the actual message text', async () => {
    const { service, sendToUsers } = build();

    await send(service);

    expect(sendToUsers).toHaveBeenCalledTimes(1);
    const [targets] = sendToUsers.mock.calls[0];
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      userId: 'r1',
      message: {
        title: 'Ada Lovelace',
        body: 'are you free at 3?',
        threadKey: 'chat:room-dm',
      },
    });
  });

  // The bug this service exists for: the bell row is deduped to one per room
  // per read-cycle, which used to suppress push too. Push must not consult it.
  it('pushes every message, with no dedup of its own', async () => {
    const { service, sendToUsers } = build();

    await send(service);
    await send(service, {
      message: message({ id: 'msg-2', content: 'still there?' }),
    });
    await send(service, {
      message: message({ id: 'msg-3', content: 'hello?' }),
    });

    expect(sendToUsers).toHaveBeenCalledTimes(3);
  });

  it('names the channel for a channel message', async () => {
    const { service, sendToUsers } = build();

    await send(service, { room: channelRoom, recipientIds: ['sender', 'r1'] });

    expect(sendToUsers.mock.calls[0][0][0].message).toMatchObject({
      title: 'Ada Lovelace in #General',
      body: 'are you free at 3?',
    });
  });

  it('never notifies the sender', async () => {
    const { service, sendToUsers } = build();

    await send(service, { recipientIds: ['sender'] });

    expect(sendToUsers).not.toHaveBeenCalled();
  });

  describe('per-room level', () => {
    it('notifies everyone by default, with no row present', async () => {
      const { service, sendToUsers } = build();

      await send(service, { recipientIds: ['sender', 'r1', 'r2'] });

      expect(sendToUsers.mock.calls[0][0]).toHaveLength(2);
    });

    it('drops a recipient set to none', async () => {
      const { service, sendToUsers } = build({ r1: 'none' });

      await send(service);

      expect(sendToUsers).not.toHaveBeenCalled();
    });

    it('holds a mentions-only recipient back until they are mentioned', async () => {
      const quiet = build({ r1: 'mentions' });
      await send(quiet.service);
      expect(quiet.sendToUsers).not.toHaveBeenCalled();

      const pinged = build({ r1: 'mentions' });
      await send(pinged.service, {
        mentions: [{ user_id: 'r1', start: 0, length: 3 }] as never,
      });
      expect(pinged.sendToUsers).toHaveBeenCalledTimes(1);
    });

    it('treats @everyone as a mention for a mentions-only recipient', async () => {
      const { service, sendToUsers } = build({ r1: 'mentions' });

      await send(service, {
        mentions: [{ user_id: 'everyone', start: 0, length: 9 }] as never,
      });

      expect(sendToUsers).toHaveBeenCalledTimes(1);
    });

    // A lookup blip must never silently mute a whole room.
    it('fails open to notifying when the level lookup returns nothing', async () => {
      const { service, sendToUsers, repo } = build();
      (repo.listRoomNotificationLevels as jest.Mock).mockResolvedValue(
        new Map(),
      );

      await send(service);

      expect(sendToUsers).toHaveBeenCalledTimes(1);
    });
  });

  describe('messages with no text', () => {
    it('describes an image', async () => {
      const { service, sendToUsers } = build();

      await send(service, {
        message: message({
          content: '',
          attachments: [
            { url: 'u', name: 'a.png', content_type: 'image/png', size: 1 },
          ],
        }),
      });

      expect(sendToUsers.mock.calls[0][0][0].message.body).toBe('📷 Photo');
    });

    it('names a file, and counts the rest', async () => {
      const { service, sendToUsers } = build();

      await send(service, {
        message: message({
          content: '',
          attachments: [
            {
              url: 'u',
              name: 'report.pdf',
              content_type: 'application/pdf',
              size: 1,
            },
            {
              url: 'u2',
              name: 'notes.txt',
              content_type: 'text/plain',
              size: 1,
            },
          ],
        }),
      });

      expect(sendToUsers.mock.calls[0][0][0].message.body).toBe(
        '📎 report.pdf +1',
      );
    });
  });

  it('swallows a send failure rather than failing the message', async () => {
    const { service, sendToUsers } = build();
    sendToUsers.mockRejectedValue(new Error('fcm exploded'));

    await expect(send(service)).resolves.toBeUndefined();
  });
});
