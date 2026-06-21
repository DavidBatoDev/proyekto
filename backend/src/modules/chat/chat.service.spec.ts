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
      searchRoomMessages: jest.fn().mockResolvedValue([]),
      listRoomAttachments: jest.fn().mockResolvedValue([]),
      listRoomLinks: jest.fn().mockResolvedValue([]),
      listReactionsForMessages: jest.fn().mockResolvedValue(new Map()),
      toggleMessageReaction: jest.fn().mockResolvedValue(undefined),
      toggleRoomStar: jest.fn().mockResolvedValue({ starred: true }),
      listStarredRoomIds: jest.fn().mockResolvedValue(new Set<string>()),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
      markRoomRead: jest.fn().mockResolvedValue(new Date().toISOString()),
      ...overrides,
    }) as ChatRepository;

  const r2Config = {
    publicBucket: 'proyekto-media',
    privateBucket: 'proyekto-private',
    publicBaseUrl: 'https://cdn.proyekto.tech',
  };

  const buildNotifications = (overrides = {}) =>
    ({
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      ...overrides,
    }) as unknown as import('../notifications/notifications.service').NotificationsService;

  const makeService = (
    repo: ChatRepository,
    authOverrides = {},
    notifications = buildNotifications(),
  ) =>
    new ChatService(
      repo,
      buildRealtime(),
      buildAuthorization(authOverrides),
      buildAudit(),
      r2Config,
      notifications,
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

  // ── Channel member list ───────────────────────────────────────────────────
  it('listChannelMembers returns the full project roster for a public channel', async () => {
    const participant = {
      room_id: 'room-open',
      user_id: 'p1',
      joined_at: 't',
      last_read_at: null,
      user: { id: 'p1', display_name: 'P One', avatar_url: null, email: null },
    };
    const listProjectMemberCandidates = jest.fn().mockResolvedValue([
      { user_id: 'p1', role: 'member', position: null, user: participant.user },
      {
        user_id: 'p2',
        role: 'member',
        position: null,
        user: { id: 'p2', display_name: 'P Two', avatar_url: null, email: null },
      },
      {
        user_id: 'viewer-1',
        role: 'client',
        position: 'Client',
        user: { id: 'viewer-1', display_name: 'Me', avatar_url: null, email: null },
      },
    ]);
    const repo = buildRepo({
      findRoomById: jest.fn().mockResolvedValue(channel('open', false)),
      listRoomParticipants: jest.fn().mockResolvedValue([participant]),
      listProjectMemberCandidates,
    });

    const members = await makeService(repo).listChannelMembers(
      'room-open',
      'viewer-1',
    );

    expect(members.map((m) => m.user_id).sort()).toEqual([
      'p1',
      'p2',
      'viewer-1',
    ]);
    // The already-joined row is reused; the rest are synthesized (no joined_at).
    expect(members.find((m) => m.user_id === 'p1')?.joined_at).toBe('t');
    expect(members.find((m) => m.user_id === 'p2')?.joined_at).toBe('');
  });

  it('listChannelMembers returns only explicit participants for a private channel', async () => {
    const participants = [
      {
        room_id: 'room-secret',
        user_id: 'p1',
        joined_at: 't',
        last_read_at: null,
        user: { id: 'p1', display_name: 'P One', avatar_url: null, email: null },
      },
    ];
    const listProjectMemberCandidates = jest.fn();
    const repo = buildRepo({
      findRoomById: jest.fn().mockResolvedValue(channel('secret', true)),
      listRoomParticipants: jest.fn().mockResolvedValue(participants),
      listProjectMemberCandidates,
    });

    const members = await makeService(repo).listChannelMembers(
      'room-secret',
      'viewer-1',
    );

    expect(members).toEqual(participants);
    expect(listProjectMemberCandidates).not.toHaveBeenCalled();
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

  // ── Attachments ───────────────────────────────────────────────────────────
  it('rejects a channel message with neither content nor attachments', async () => {
    const room = buildRoom({
      id: 'room-chan',
      project_id: 'project-1',
      type: 'channel',
      slug: 'general',
    });
    const createMessage = jest.fn();
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(room),
      createMessage,
    });
    const service = makeService(repo);

    await expect(
      service.sendChannelMessage('project-1', 'actor-1', {
        room_id: 'room-chan',
        content: '',
      }),
    ).rejects.toThrow();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('rejects an attachment URL outside the sender chat_attachments prefix', async () => {
    const createMessage = jest.fn();
    const repo = buildRepo({ createMessage });
    const service = makeService(repo);

    await expect(
      service.sendChannelMessage('project-1', 'actor-1', {
        room_id: 'room-chan',
        content: '',
        attachments: [
          {
            // Belongs to a different user's prefix → must be rejected.
            url: 'https://cdn.proyekto.tech/chat_attachments/other-user/1.png',
            name: '1.png',
            content_type: 'image/png',
            size: 100,
          },
        ],
      }),
    ).rejects.toThrow();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('persists an attachment-only message with a valid CDN URL', async () => {
    const room = buildRoom({
      id: 'room-chan',
      project_id: 'project-1',
      type: 'channel',
      slug: 'general',
    });
    const createMessage = jest.fn().mockResolvedValue({
      id: 'msg-1',
      room_id: 'room-chan',
      project_id: 'project-1',
      sender_id: 'actor-1',
      content: '',
      attachments: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(room),
      createMessage,
    });
    const service = makeService(repo);

    const url = 'https://cdn.proyekto.tech/chat_attachments/actor-1/1.png';
    await service.sendChannelMessage('project-1', 'actor-1', {
      room_id: 'room-chan',
      content: '',
      attachments: [
        { url, name: '1.png', content_type: 'image/png', size: 100, width: 10, height: 20 },
      ],
    });

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ url, width: 10, height: 20 }),
        ],
      }),
    );
  });

  // ── Mentions ────────────────────────────────────────────────────────────────
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const channelForMentions = () =>
    buildRoom({
      id: 'room-chan',
      project_id: 'project-1',
      type: 'channel',
      slug: 'general',
      name: 'General',
    });

  it('stores mentions and pings the mentioned member, never the sender', async () => {
    const createMessage = jest.fn().mockResolvedValue({
      id: 'msg-1',
      room_id: 'room-chan',
      project_id: 'project-1',
      sender_id: 'actor-1',
      content: 'hi @M Two',
      attachments: [],
      mentions: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(channelForMentions()),
      createMessage,
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'm2', 'm3']),
    });
    const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });

    await makeService(repo, {}, buildNotifications({ createNotification })).sendChannelMessage(
      'project-1',
      'actor-1',
      {
        room_id: 'room-chan',
        content: 'hi @M Two',
        mentions: [{ user_id: 'm2', name: 'M Two', offset: 3, length: 6 }],
      },
    );

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mentions: [{ user_id: 'm2', name: 'M Two', offset: 3, length: 6 }],
      }),
    );

    await flush();
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'm2', type_name: 'chat_mention' }),
    );
  });

  it('@everyone expands to every project member except the sender', async () => {
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(channelForMentions()),
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'm2', 'm3']),
    });
    const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });

    await makeService(repo, {}, buildNotifications({ createNotification })).sendChannelMessage(
      'project-1',
      'actor-1',
      {
        room_id: 'room-chan',
        content: 'heads up @everyone',
        mentions: [{ user_id: 'everyone', name: 'everyone', offset: 9, length: 9 }],
      },
    );

    await flush();
    const notified = createNotification.mock.calls.map((c) => c[0].user_id).sort();
    expect(notified).toEqual(['m2', 'm3']);
  });

  it('drops a mention of someone who is not a room member', async () => {
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(channelForMentions()),
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'm2']),
    });
    const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });

    await makeService(repo, {}, buildNotifications({ createNotification })).sendChannelMessage(
      'project-1',
      'actor-1',
      {
        room_id: 'room-chan',
        content: 'hi @Outsider',
        mentions: [{ user_id: 'stranger', name: 'Outsider', offset: 3, length: 9 }],
      },
    );

    await flush();
    expect(createNotification).not.toHaveBeenCalled();
  });

  // ── Search + library ──────────────────────────────────────────────────────
  const accessibleDmRepo = (overrides: Partial<ChatRepository>) =>
    buildRepo({
      findRoomById: jest.fn().mockResolvedValue(buildRoom({ id: 'room-1' })),
      isRoomParticipant: jest.fn().mockResolvedValue(true),
      ...overrides,
    });

  it('getRoomLibrary splits attachments into media vs files and asserts access', async () => {
    const listRoomAttachments = jest.fn().mockResolvedValue([
      {
        message_id: 'm1', sender_id: 'u1', created_at: 't',
        url: 'cdn/a.png', name: 'a.png', content_type: 'image/png',
        size: 1, width: 2, height: 3,
      },
      {
        message_id: 'm2', sender_id: 'u1', created_at: 't',
        url: 'cdn/b.pdf', name: 'b.pdf', content_type: 'application/pdf',
        size: 4, width: null, height: null,
      },
    ]);
    const listRoomLinks = jest
      .fn()
      .mockResolvedValue([
        { message_id: 'm3', sender_id: 'u1', created_at: 't', url: 'https://x.dev' },
      ]);
    const repo = accessibleDmRepo({ listRoomAttachments, listRoomLinks });

    const result = await makeService(repo).getRoomLibrary('room-1', 'viewer-1');

    expect(result.media.map((m) => m.url)).toEqual(['cdn/a.png']);
    expect(result.files.map((f) => f.url)).toEqual(['cdn/b.pdf']);
    expect(result.links).toHaveLength(1);
  });

  it('getRoomLibrary rejects a non-participant', async () => {
    const repo = buildRepo({
      findRoomById: jest.fn().mockResolvedValue(buildRoom({ id: 'room-1' })),
      isRoomParticipant: jest.fn().mockResolvedValue(false),
    });
    await expect(
      makeService(repo).getRoomLibrary('room-1', 'stranger-1'),
    ).rejects.toThrow();
  });

  it('searchRoomMessages skips the repo for a blank query', async () => {
    const searchRoomMessages = jest.fn();
    const repo = accessibleDmRepo({ searchRoomMessages });

    const result = await makeService(repo).searchRoomMessages(
      'room-1',
      'viewer-1',
      '   ',
    );

    expect(result.results).toEqual([]);
    expect(searchRoomMessages).not.toHaveBeenCalled();
  });

  it('searchRoomMessages delegates a real query to the repo', async () => {
    const searchRoomMessages = jest
      .fn()
      .mockResolvedValue([{ id: 'm1', content: 'hello world', score: 1 }]);
    const repo = accessibleDmRepo({ searchRoomMessages });

    const result = await makeService(repo).searchRoomMessages(
      'room-1',
      'viewer-1',
      'hello',
    );

    expect(searchRoomMessages).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-1', query: 'hello', limit: 30 }),
    );
    expect(result.results).toHaveLength(1);
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
