import { ChatService } from './chat.service';
import type {
  ChatRepository,
  ChatRoom,
} from './repositories/chat.repository.interface';

describe('ChatService', () => {
  const buildRoom = (overrides: Partial<ChatRoom> = {}): ChatRoom => ({
    id: 'room-1',
    project_id: null,
    type: 'dm',
    slug: 'a_b',
    name: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  });

  const buildRepo = (overrides: Partial<ChatRepository>): ChatRepository =>
    ({
      isProjectMember: jest.fn().mockResolvedValue(true),
      resolveProjectRole: jest.fn().mockResolvedValue('consultant'),
      listProjectMemberCandidates: jest.fn().mockResolvedValue([]),
      listProjectParticipantUserIds: jest.fn().mockResolvedValue([]),
      usersShareAnyProject: jest.fn().mockResolvedValue(true),
      findRoomById: jest.fn().mockResolvedValue(null),
      findRoomForParticipant: jest.fn().mockResolvedValue(null),
      findChannelBySlug: jest.fn().mockResolvedValue(null),
      findDmBySlug: jest.fn().mockResolvedValue(null),
      upsertChannel: jest.fn().mockResolvedValue(
        buildRoom({ project_id: 'project-1', type: 'channel', slug: 'general' }),
      ),
      upsertDm: jest.fn().mockResolvedValue(buildRoom()),
      upsertParticipants: jest.fn().mockResolvedValue(undefined),
      isRoomParticipant: jest.fn().mockResolvedValue(true),
      listRoomsForProject: jest.fn().mockResolvedValue([]),
      listDmRoomsForUser: jest.fn().mockResolvedValue([]),
      listRoomMessages: jest.fn().mockResolvedValue([]),
      createMessage: jest.fn().mockResolvedValue({
        id: 'msg-1',
        room_id: 'room-1',
        project_id: null,
        sender_id: 'actor-1',
        content: 'hello',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      findMessageById: jest.fn().mockResolvedValue(null),
      listReactionsForMessages: jest.fn().mockResolvedValue(new Map()),
      toggleMessageReaction: jest.fn().mockResolvedValue(undefined),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
      markRoomRead: jest.fn().mockResolvedValue(new Date().toISOString()),
      ...overrides,
    }) as ChatRepository;

  it('creates and reuses DM rooms by deterministic slug, no project_id', async () => {
    const upsertDm = jest.fn().mockResolvedValue(
      buildRoom({ slug: 'actor-1_rec-1' }),
    );
    const repo = buildRepo({ upsertDm });
    const service = new ChatService(repo);

    await service.sendDmMessage('actor-1', {
      recipient_id: 'rec-1',
      content: 'first',
    });
    await service.sendDmMessage('actor-1', {
      recipient_id: 'rec-1',
      content: 'second',
    });

    expect(upsertDm).toHaveBeenCalledTimes(2);
    expect(upsertDm).toHaveBeenNthCalledWith(1, { slug: 'actor-1_rec-1' });
  });

  it('rejects DM when users do not share any project', async () => {
    const repo = buildRepo({
      usersShareAnyProject: jest.fn().mockResolvedValue(false),
    });
    const service = new ChatService(repo);

    await expect(
      service.sendDmMessage('actor-1', {
        recipient_id: 'stranger-1',
        content: 'hi',
      }),
    ).rejects.toThrow();
  });

  it('creates general channel just-in-time and seeds participants', async () => {
    const upsertChannel = jest.fn().mockResolvedValue(
      buildRoom({
        id: 'general-room',
        project_id: 'project-1',
        type: 'channel',
        slug: 'general',
        name: 'General',
      }),
    );
    const upsertParticipants = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({
      upsertChannel,
      upsertParticipants,
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'client-1', 'member-1']),
    });
    const service = new ChatService(repo);

    await service.sendChannelMessage('project-1', 'actor-1', {
      slug: 'general',
      content: 'hello general',
    });

    expect(upsertChannel).toHaveBeenCalledWith({
      projectId: 'project-1',
      slug: 'general',
      name: 'General',
    });
    expect(upsertParticipants).toHaveBeenCalledWith(
      'general-room',
      'project-1',
      ['actor-1', 'client-1', 'member-1'],
    );
  });

  it('resolveDmRoom creates and seeds participants for a fresh pair', async () => {
    const upsertDm = jest.fn().mockResolvedValue(
      buildRoom({ slug: 'actor-1_rec-1' }),
    );
    const upsertParticipants = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({ upsertDm, upsertParticipants });
    const service = new ChatService(repo);

    const room = await service.resolveDmRoom('actor-1', 'rec-1');
    expect(room.slug).toBe('actor-1_rec-1');
    expect(upsertParticipants).toHaveBeenCalledWith(room.id, null, [
      'actor-1',
      'rec-1',
    ]);
  });
});
