import { ChatService } from './chat.service';
import type { ChatRepository, ChatRoom } from './repositories/chat.repository.interface';

describe('ChatService', () => {
  const buildRoom = (overrides: Partial<ChatRoom> = {}): ChatRoom => ({
    id: 'room-1',
    project_id: 'project-1',
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
      findRoomById: jest.fn().mockResolvedValue(null),
      findRoomBySlug: jest.fn().mockResolvedValue(null),
      upsertRoom: jest.fn().mockResolvedValue(buildRoom()),
      upsertParticipants: jest.fn().mockResolvedValue(undefined),
      isRoomParticipant: jest.fn().mockResolvedValue(true),
      listRecentRooms: jest.fn().mockResolvedValue([]),
      listRoomMessages: jest.fn().mockResolvedValue([]),
      createMessage: jest.fn().mockResolvedValue({
        id: 'msg-1',
        room_id: 'room-1',
        project_id: 'project-1',
        sender_id: 'actor-1',
        content: 'hello',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      ...overrides,
    }) as ChatRepository;

  it('creates and reuses DM rooms by deterministic slug', async () => {
    const upsertRoom = jest.fn().mockResolvedValue(buildRoom({ slug: 'actor-1_rec-1' }));
    const repo = buildRepo({
      resolveProjectRole: jest.fn().mockImplementation((_projectId, userId) => {
        if (userId === 'actor-1') return Promise.resolve('consultant');
        if (userId === 'rec-1') return Promise.resolve('freelancer');
        return Promise.resolve(null);
      }),
      upsertRoom,
    });
    const service = new ChatService(repo);

    await service.sendMessage('project-1', 'actor-1', {
      kind: 'dm',
      recipient_id: 'rec-1',
      content: 'first',
    });

    await service.sendMessage('project-1', 'actor-1', {
      kind: 'dm',
      recipient_id: 'rec-1',
      content: 'second',
    });

    expect(upsertRoom).toHaveBeenCalledTimes(2);
    expect(upsertRoom).toHaveBeenNthCalledWith(1, {
      projectId: 'project-1',
      type: 'dm',
      slug: 'actor-1_rec-1',
      name: null,
    });
  });

  it('creates general channel just-in-time and seeds participants', async () => {
    const upsertRoom = jest.fn().mockResolvedValue(
      buildRoom({
        id: 'general-room',
        type: 'channel',
        slug: 'general',
        name: 'General',
      }),
    );
    const upsertParticipants = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({
      upsertRoom,
      upsertParticipants,
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'client-1', 'member-1']),
    });
    const service = new ChatService(repo);

    await service.sendMessage('project-1', 'actor-1', {
      kind: 'channel',
      slug: 'general',
      content: 'hello general',
    });

    expect(upsertRoom).toHaveBeenCalledWith({
      projectId: 'project-1',
      type: 'channel',
      slug: 'general',
      name: 'General',
    });
    expect(upsertParticipants).toHaveBeenCalledWith(
      'general-room',
      'project-1',
      ['actor-1', 'client-1', 'member-1'],
    );
  });

  it('allows DMs between any two project members regardless of role flavor', async () => {
    // Soft-isolation update: the legacy persona matrix
    // (client ↔ consultant only, freelancer ↔ consultant+freelancer) was
    // dropped — any project member can DM any other project member. The
    // marketplace mediation lives elsewhere.
    const upsertRoom = jest.fn().mockResolvedValue({
      id: 'room-1',
      project_id: 'project-1',
      type: 'dm',
      slug: 'a_b',
      name: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const repo = buildRepo({
      upsertRoom,
      resolveProjectRole: jest
        .fn()
        .mockResolvedValueOnce('freelancer')
        .mockResolvedValueOnce('client'),
    });
    const service = new ChatService(repo);

    await expect(
      service.sendMessage('project-1', 'freelancer-1', {
        kind: 'dm',
        recipient_id: 'client-1',
        content: 'now allowed',
      }),
    ).resolves.toBeTruthy();
  });
});
