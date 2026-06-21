import { ChatService } from './chat.service';
import type { RealtimePublisher } from '../realtime/realtime-publisher.service';
import type { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import type { AuditService } from '../audit/audit.service';
import type {
  ChatRepository,
  ChatRoom,
  ChatRoomWithLastMessage,
} from './repositories/chat.repository.interface';

describe('ChatService', () => {
  const buildRealtime = (): RealtimePublisher =>
    ({
      publishChatEvent: jest.fn(),
      publishRoadmapChange: jest.fn(),
    }) as unknown as RealtimePublisher;

  const buildAuthorization = (
    overrides: Partial<ProjectAuthorizationService> = {},
  ): ProjectAuthorizationService =>
    ({
      getUserProjectRole: jest.fn().mockResolvedValue('editor'),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as unknown as ProjectAuthorizationService;

  const buildAudit = (): AuditService =>
    ({
      log: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
    }) as unknown as AuditService;

  const buildRoom = (overrides: Partial<ChatRoom> = {}): ChatRoom => ({
    id: 'room-1',
    project_id: null,
    type: 'dm',
    slug: 'a_b',
    name: null,
    is_private: false,
    is_archived: false,
    archived_at: null,
    created_by: null,
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
      upsertChannel: jest
        .fn()
        .mockImplementation((p) =>
          Promise.resolve(
            buildRoom({
              id: `room-${p.slug}`,
              project_id: p.projectId,
              type: 'channel',
              slug: p.slug,
              name: p.name ?? null,
              is_private: p.isPrivate ?? false,
            }),
          ),
        ),
      updateRoom: jest.fn().mockResolvedValue(buildRoom()),
      getProjectIsPersonal: jest.fn().mockResolvedValue(false),
      listProjectChannels: jest.fn().mockResolvedValue([]),
      listParticipantRoomIds: jest.fn().mockResolvedValue([]),
      hydrateRoomsByIds: jest.fn().mockResolvedValue([]),
      listRoomParticipants: jest.fn().mockResolvedValue([]),
      upsertDm: jest.fn().mockResolvedValue(buildRoom()),
      upsertParticipants: jest.fn().mockResolvedValue(undefined),
      removeParticipant: jest.fn().mockResolvedValue(undefined),
      isRoomParticipant: jest.fn().mockResolvedValue(true),
      listRoomParticipantUserIds: jest.fn().mockResolvedValue([]),
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

  const makeService = (repo: ChatRepository, authOverrides = {}) =>
    new ChatService(
      repo,
      buildRealtime(),
      buildAuthorization(authOverrides),
      buildAudit(),
    );

  // ── Channels: arbitrary channel fixtures for visibility tests ──────────────
  const channel = (slug: string, isPrivate: boolean): ChatRoom =>
    buildRoom({
      id: `room-${slug}`,
      project_id: 'project-1',
      type: 'channel',
      slug,
      is_private: isPrivate,
    });

  const personaRooms = (): ChatRoom[] => [
    channel('client-room', false),
    channel('internal-team', true),
    channel('consultant-client', true),
    channel('consultant-pm', true),
  ];

  // hydrateRoomsByIds echoes back the requested rooms as hydrated.
  const hydrateFrom = (all: ChatRoom[]) =>
    jest.fn((ids: string[]) =>
      Promise.resolve(
        ids
          .map((id) => all.find((r) => r.id === id))
          .filter((r): r is ChatRoom => Boolean(r))
          .map((r) => ({
            ...r,
            last_message: null,
            participants: [],
          })) as ChatRoomWithLastMessage[],
      ),
    );

  const visibleSlugs = async (
    persona: 'consultant' | 'client' | 'freelancer',
    rooms: ChatRoom[],
    participantRoomIds: string[] = [],
  ): Promise<string[]> => {
    const repo = buildRepo({
      resolveProjectRole: jest.fn().mockResolvedValue(persona),
      listProjectChannels: jest.fn().mockResolvedValue(rooms),
      listParticipantRoomIds: jest.fn().mockResolvedValue(participantRoomIds),
      hydrateRoomsByIds: hydrateFrom(rooms),
    });
    const result = await makeService(repo).listRooms('project-1', 'viewer-1');
    return result.map((r) => r.slug).sort();
  };

  it('consultant sees every channel including private ones', async () => {
    const slugs = await visibleSlugs('consultant', personaRooms());
    expect(slugs).toEqual(
      ['client-room', 'consultant-client', 'consultant-pm', 'internal-team'].sort(),
    );
  });

  it('a non-consultant member sees only public channels until added to private ones', async () => {
    // Visibility is pure membership now: with no participant rows a freelancer
    // only sees the public client-room; the 3 private default rooms are hidden.
    const base = await visibleSlugs('freelancer', personaRooms());
    expect(base).toEqual(['client-room']);

    // Once added to internal-team (private) it becomes visible too.
    const withMembership = await visibleSlugs('freelancer', personaRooms(), [
      'room-internal-team',
    ]);
    expect(withMembership).toEqual(['client-room', 'internal-team'].sort());
  });

  it('hides a private user channel unless the viewer is a participant', async () => {
    const priv = buildRoom({
      id: 'room-priv',
      project_id: 'project-1',
      type: 'channel',
      slug: 'secret',
      is_private: true,
    });
    const pub = buildRoom({
      id: 'room-pub',
      project_id: 'project-1',
      type: 'channel',
      slug: 'open',
      is_private: false,
    });
    const rooms = [priv, pub];

    // Not a participant of the private channel → hidden.
    const hidden = buildRepo({
      resolveProjectRole: jest.fn().mockResolvedValue('freelancer'),
      listProjectChannels: jest.fn().mockResolvedValue(rooms),
      listParticipantRoomIds: jest.fn().mockResolvedValue([]),
      hydrateRoomsByIds: hydrateFrom(rooms),
    });
    const hiddenResult = await makeService(hidden).listRooms(
      'project-1',
      'viewer-1',
    );
    expect(hiddenResult.map((r) => r.id).sort()).toEqual(['room-pub']);

    // Participant of the private channel → visible.
    const shown = buildRepo({
      resolveProjectRole: jest.fn().mockResolvedValue('freelancer'),
      listProjectChannels: jest.fn().mockResolvedValue(rooms),
      listParticipantRoomIds: jest.fn().mockResolvedValue(['room-priv']),
      hydrateRoomsByIds: hydrateFrom(rooms),
    });
    const shownResult = await makeService(shown).listRooms(
      'project-1',
      'viewer-1',
    );
    expect(shownResult.map((r) => r.id).sort()).toEqual(['room-priv', 'room-pub']);
  });

  it('provisionDefaultChannels seeds the creator into the single #general room', async () => {
    const upsertParticipants = jest.fn().mockResolvedValue(undefined);
    const upsertChannel = jest
      .fn()
      .mockImplementation((p) =>
        Promise.resolve(channel(p.slug, p.isPrivate ?? false)),
      );
    const repo = buildRepo({
      getProjectIsPersonal: jest.fn().mockResolvedValue(false),
      upsertChannel,
      upsertParticipants,
    });

    await makeService(repo).provisionDefaultChannels(
      'project-1',
      'creator-1',
      'project',
    );

    // Persona rooms are no longer auto-provisioned — only #general.
    expect(upsertChannel).toHaveBeenCalledTimes(1);
    expect(upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'general', isPrivate: false }),
    );
    expect(upsertParticipants).toHaveBeenCalledTimes(1);
    expect(upsertParticipants).toHaveBeenCalledWith('room-general', [
      'creator-1',
    ]);
  });

  // ── Channel creation ────────────────────────────────────────────────────
  it('createChannel checks the create permission and audits', async () => {
    const assertPermission = jest.fn().mockResolvedValue(undefined);
    const upsertChannel = jest.fn().mockResolvedValue(
      buildRoom({
        id: 'room-new',
        project_id: 'project-1',
        type: 'channel',
        slug: 'design-review',
        name: 'Design Review',
      }),
    );
    const repo = buildRepo({
      upsertChannel,
      hydrateRoomsByIds: jest
        .fn()
        .mockResolvedValue([
          { ...buildRoom({ id: 'room-new' }), last_message: null, participants: [] },
        ]),
    });
    const service = makeService(repo, { assertPermission });

    await service.createChannel('project-1', 'actor-1', {
      name: 'Design Review',
    });

    expect(assertPermission).toHaveBeenCalledWith(
      'actor-1',
      'project-1',
      'chat.create_channels',
    );
    expect(upsertChannel).toHaveBeenCalledTimes(1);
  });

  it('updateChannel toggles visibility via manage_channels', async () => {
    const assertPermission = jest.fn().mockResolvedValue(undefined);
    const updateRoom = jest
      .fn()
      .mockResolvedValue(channel('design-review', true));
    const repo = buildRepo({
      findRoomById: jest.fn().mockResolvedValue(channel('design-review', false)),
      updateRoom,
    });
    const service = makeService(repo, { assertPermission });

    await service.updateChannel('project-1', 'actor-1', 'room-design-review', {
      is_private: true,
    });

    expect(assertPermission).toHaveBeenCalledWith(
      'actor-1',
      'project-1',
      'chat.manage_channels',
    );
    expect(updateRoom).toHaveBeenCalledWith('room-design-review', {
      name: undefined,
      is_archived: undefined,
      is_private: true,
    });
  });

  it('leaveChannel removes the caller without manage_channels', async () => {
    const assertPermission = jest.fn().mockResolvedValue(undefined);
    const removeParticipant = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({
      findRoomById: jest.fn().mockResolvedValue(channel('internal-team', true)),
      removeParticipant,
    });
    const service = makeService(repo, { assertPermission });

    await service.leaveChannel('project-1', 'viewer-1', 'room-internal-team');

    expect(assertPermission).not.toHaveBeenCalled();
    expect(removeParticipant).toHaveBeenCalledWith(
      'room-internal-team',
      'viewer-1',
    );
  });

  // ── DMs (unchanged behavior) ──────────────────────────────────────────────
  it('creates and reuses DM rooms by deterministic slug, no project_id', async () => {
    const upsertDm = jest.fn().mockResolvedValue(
      buildRoom({ slug: 'actor-1_rec-1' }),
    );
    const repo = buildRepo({ upsertDm });
    const service = makeService(repo);

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
    const service = makeService(repo);

    await expect(
      service.sendDmMessage('actor-1', {
        recipient_id: 'stranger-1',
        content: 'hi',
      }),
    ).rejects.toThrow();
  });

  it('sendChannelMessage uses the participant fast path for room_id', async () => {
    const room = buildRoom({
      id: 'room-chan',
      project_id: 'project-1',
      type: 'channel',
      slug: 'client-room',
    });
    const createMessage = jest.fn().mockResolvedValue({
      id: 'msg-1',
      room_id: 'room-chan',
      project_id: 'project-1',
      sender_id: 'actor-1',
      content: 'hello',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(room),
      createMessage,
    });
    const service = makeService(repo);

    const result = await service.sendChannelMessage('project-1', 'actor-1', {
      room_id: 'room-chan',
      content: 'hello',
    });

    expect(result.room.id).toBe('room-chan');
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it('resolveDmRoom creates and seeds participants for a fresh pair', async () => {
    const upsertDm = jest.fn().mockResolvedValue(
      buildRoom({ slug: 'actor-1_rec-1' }),
    );
    const upsertParticipants = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({ upsertDm, upsertParticipants });
    const service = makeService(repo);

    const room = await service.resolveDmRoom('actor-1', 'rec-1');
    expect(room.slug).toBe('actor-1_rec-1');
    expect(upsertParticipants).toHaveBeenCalledWith(room.id, ['actor-1', 'rec-1']);
  });
});
