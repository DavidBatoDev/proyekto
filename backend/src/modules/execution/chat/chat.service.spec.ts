import { ChatService } from './chat.service';
import type { RealtimePublisher } from '../../shared/realtime/realtime-publisher.service';
import type { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import type { AuditService } from '../../shared/audit/audit.service';
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
      // G9: sendChannelMessage now asserts chat.send_messages; default the mock
      // to a member who has it so existing happy-path send tests still pass.
      resolvePermissions: jest
        .fn()
        .mockResolvedValue({ chat: { send_messages: true } }),
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
      listProjectMemberCandidates: jest.fn().mockResolvedValue([]),
      listProjectParticipantUserIds: jest.fn().mockResolvedValue([]),
      usersShareAnyProject: jest.fn().mockResolvedValue(true),
      recipientIsActiveSeller: jest.fn().mockResolvedValue(false),
      findRoomById: jest.fn().mockResolvedValue(null),
      findRoomForParticipant: jest.fn().mockResolvedValue(null),
      findChannelBySlug: jest.fn().mockResolvedValue(null),
      findDmBySlug: jest.fn().mockResolvedValue(null),
      upsertChannel: jest.fn().mockImplementation((p) =>
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
      listRoomParticipantReadState: jest.fn().mockResolvedValue([]),
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
      updateMessageContent: jest.fn().mockResolvedValue({
        id: 'msg-1',
        room_id: 'room-1',
        project_id: null,
        sender_id: 'actor-1',
        content: 'edited',
        attachments: [],
        mentions: [],
        edited_at: new Date().toISOString(),
        deleted_at: null,
        reply_to_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      findReplyTargets: jest.fn().mockResolvedValue([]),
      searchRoomMessages: jest.fn().mockResolvedValue([]),
      listRoomAttachments: jest.fn().mockResolvedValue([]),
      listRoomLinks: jest.fn().mockResolvedValue([]),
      listReactionsForMessages: jest.fn().mockResolvedValue(new Map()),
      toggleMessageReaction: jest.fn().mockResolvedValue(undefined),
      toggleRoomStar: jest.fn().mockResolvedValue({ starred: true }),
      listStarredRoomIds: jest.fn().mockResolvedValue(new Set<string>()),
      softDeleteMessage: jest.fn().mockResolvedValue(undefined),
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
      resolveActorName: jest.fn().mockResolvedValue('Ada Lovelace'),
      // Default: no live notification, so a DM notifies.
      findLiveChatRoomNotification: jest.fn().mockResolvedValue(null),
      ...overrides,
    }) as unknown as import('../../shared/notifications/notifications.service').NotificationsService;

  const buildKnowledgeOutbox = () =>
    ({
      enqueue: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(false),
    }) as unknown as import('../../shared/knowledge/knowledge-outbox.service').KnowledgeOutboxService;

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
      buildKnowledgeOutbox(),
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

  /**
   * The four rooms older projects were auto-provisioned with. They are ordinary
   * channels now — nothing keys off these slugs — but real projects still hold
   * them, so visibility is worth asserting against the shape that exists in
   * production rather than an invented one.
   */
  const legacyRooms = (): ChatRoom[] => [
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
    rooms: ChatRoom[],
    participantRoomIds: string[] = [],
  ): Promise<string[]> => {
    const repo = buildRepo({
      listProjectChannels: jest.fn().mockResolvedValue(rooms),
      listParticipantRoomIds: jest.fn().mockResolvedValue(participantRoomIds),
      hydrateRoomsByIds: hydrateFrom(rooms),
    });
    const result = await makeService(repo).listRooms('project-1', 'viewer-1');
    return result.map((r) => r.slug).sort();
  };

  /**
   * No member sees a private channel they were not added to — not even the person
   * who used to be the project's consultant.
   *
   * This replaces a "consultant sees every channel including private ones" case.
   * That bypass was worse than it looked: because `listRooms` lazily joins
   * whatever it makes visible, the consultant was silently written into every
   * private channel on each sidebar load, which also made removing them or having
   * them leave impossible to make stick.
   */
  it('shows nobody a private channel they are not a participant of', async () => {
    const slugs = await visibleSlugs(legacyRooms());

    expect(slugs).toEqual(['client-room']);
  });

  it('shows a private channel once the member is a participant', async () => {
    const withMembership = await visibleSlugs(legacyRooms(), [
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
      listProjectChannels: jest.fn().mockResolvedValue(rooms),
      listParticipantRoomIds: jest.fn().mockResolvedValue(['room-priv']),
      hydrateRoomsByIds: hydrateFrom(rooms),
    });
    const shownResult = await makeService(shown).listRooms(
      'project-1',
      'viewer-1',
    );
    expect(shownResult.map((r) => r.id).sort()).toEqual([
      'room-priv',
      'room-pub',
    ]);
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
      hydrateRoomsByIds: jest.fn().mockResolvedValue([
        {
          ...buildRoom({ id: 'room-new' }),
          last_message: null,
          participants: [],
        },
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

  /**
   * A private channel starts with its creator and nobody else.
   *
   * This replaces a test for the `kind: 'client_project'` preset, which forced the
   * room private and auto-seeded whoever resolved to the consultant or client
   * persona plus the project owner. Membership of a private channel is now
   * something a person grants, not something an identity confers.
   */
  it('creates a private channel with only its creator as a participant', async () => {
    const upsertParticipants = jest.fn().mockResolvedValue(undefined);
    const upsertChannel = jest
      .fn()
      .mockImplementation((params) =>
        Promise.resolve(channel(params.slug, params.isPrivate ?? false)),
      );
    const listProjectMemberCandidates = jest.fn().mockResolvedValue([]);
    const repo = buildRepo({
      listProjectMemberCandidates,
      upsertChannel,
      upsertParticipants,
    });

    await makeService(repo).createChannel('project-1', 'admin-1', {
      name: 'Stakeholders',
      is_private: true,
    });

    expect(upsertChannel).toHaveBeenCalledWith(
      expect.objectContaining({ isPrivate: true }),
    );
    expect(upsertParticipants).toHaveBeenCalledTimes(1);
    expect(upsertParticipants).toHaveBeenCalledWith('room-stakeholders', [
      'admin-1',
    ]);
    // The roster is not consulted at all — there is no audience to derive.
    expect(listProjectMemberCandidates).not.toHaveBeenCalled();
  });

  it('updateChannel toggles visibility via manage_channels', async () => {
    const assertPermission = jest.fn().mockResolvedValue(undefined);
    const updateRoom = jest
      .fn()
      .mockResolvedValue(channel('design-review', true));
    const repo = buildRepo({
      findRoomById: jest
        .fn()
        .mockResolvedValue(channel('design-review', false)),
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

  /**
   * Leaving now sticks for everyone.
   *
   * This replaces a "core members cannot leave the client project room" case,
   * which refused when the leaver resolved to the consultant or client persona (or
   * was the owner). For a consultant that refusal was largely theatre anyway: the
   * all-channel bypass re-added them on the next sidebar load.
   */
  it('lets any participant leave a channel, including the project owner', async () => {
    const removeParticipant = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({
      findRoomById: jest
        .fn()
        .mockResolvedValue(channel('client-project-room', true)),
      removeParticipant,
    });

    await expect(
      makeService(repo).leaveChannel(
        'project-1',
        'owner-1',
        'room-client-project-room',
      ),
    ).resolves.toBeDefined();
    expect(removeParticipant).toHaveBeenCalledWith(
      'room-client-project-room',
      'owner-1',
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
      {
        user_id: 'p1',
        role: 'freelancer',
        access_role: 'editor',
        position: 'Designer',
        team: { id: 't1', name: 'Studio', avatar_url: 'studio.png' },
        user: participant.user,
      },
      {
        user_id: 'p2',
        role: 'freelancer',
        access_role: 'viewer',
        position: null,
        team: null,
        user: {
          id: 'p2',
          display_name: 'P Two',
          avatar_url: null,
          email: null,
        },
      },
      {
        user_id: 'viewer-1',
        role: 'client',
        access_role: 'owner',
        position: 'Client',
        team: null,
        user: {
          id: 'viewer-1',
          display_name: 'Me',
          avatar_url: null,
          email: null,
        },
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
    expect(members.find((m) => m.user_id === 'p1')).toMatchObject({
      access_role: 'editor',
      position: 'Designer',
      team: { id: 't1', name: 'Studio' },
    });
  });

  it('listChannelMembers returns only explicit participants for a private channel', async () => {
    const participants = [
      {
        room_id: 'room-secret',
        user_id: 'p1',
        joined_at: 't',
        last_read_at: null,
        user: {
          id: 'p1',
          display_name: 'P One',
          avatar_url: null,
          email: null,
        },
      },
    ];
    const listProjectMemberCandidates = jest.fn().mockResolvedValue([
      {
        user_id: 'p1',
        role: 'freelancer',
        access_role: 'commenter',
        position: 'Writer',
        team: null,
        user: participants[0].user,
      },
    ]);
    const repo = buildRepo({
      findRoomById: jest.fn().mockResolvedValue(channel('secret', true)),
      listRoomParticipants: jest.fn().mockResolvedValue(participants),
      listProjectMemberCandidates,
    });

    const members = await makeService(repo).listChannelMembers(
      'room-secret',
      'viewer-1',
    );

    expect(members).toEqual([
      expect.objectContaining({
        user_id: 'p1',
        access_role: 'commenter',
        position: 'Writer',
      }),
    ]);
    expect(listProjectMemberCandidates).toHaveBeenCalledWith('project-1');
  });

  /**
   * Removal now sticks for everyone too — and, unlike before, permanently.
   *
   * This replaces a "does not remove core members from the client project room"
   * case. Removal is gated on `chat.manage_channels`, which is the check that
   * matters; who the member is on the project is not.
   */
  it('removes any participant when the actor can manage channels', async () => {
    const removeParticipant = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({
      findRoomById: jest
        .fn()
        .mockResolvedValue(channel('client-project-room', true)),
      removeParticipant,
    });

    await expect(
      makeService(repo).removeChannelMember(
        'project-1',
        'admin-1',
        'room-client-project-room',
        'owner-1',
      ),
    ).resolves.toBeDefined();
    expect(removeParticipant).toHaveBeenCalledWith(
      'room-client-project-room',
      'owner-1',
    );
  });

  // ── DMs (unchanged behavior) ──────────────────────────────────────────────
  it('creates and reuses DM rooms by deterministic slug, no project_id', async () => {
    const upsertDm = jest
      .fn()
      .mockResolvedValue(buildRoom({ slug: 'actor-1_rec-1' }));
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

  it('allows DM to a marketplace seller without a shared project', async () => {
    // Sellers publish public service pages with a contact CTA — buyers may
    // open the conversation; the reverse direction stays project-gated.
    const repo = buildRepo({
      usersShareAnyProject: jest.fn().mockResolvedValue(false),
      recipientIsActiveSeller: jest.fn().mockResolvedValue(true),
    });
    const service = makeService(repo);

    await expect(
      service.sendDmMessage('actor-1', {
        recipient_id: 'seller-1',
        content: 'hi — interested in your service',
      }),
    ).resolves.toBeDefined();
    expect(repo.recipientIsActiveSeller).toHaveBeenCalledWith('seller-1');
  });

  it('resolveDmRoom applies the same widened seller gate', async () => {
    const repo = buildRepo({
      usersShareAnyProject: jest.fn().mockResolvedValue(false),
      recipientIsActiveSeller: jest.fn().mockResolvedValue(true),
    });
    const service = makeService(repo);

    await expect(
      service.resolveDmRoom('actor-1', 'seller-1'),
    ).resolves.toBeDefined();

    const blockedRepo = buildRepo({
      usersShareAnyProject: jest.fn().mockResolvedValue(false),
      recipientIsActiveSeller: jest.fn().mockResolvedValue(false),
    });
    await expect(
      makeService(blockedRepo).resolveDmRoom('actor-1', 'stranger-1'),
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

  // `project_access` is the only authorization source: no resolved permission row
  // means no posting, whatever the sender's standing on the project elsewhere.
  it('rejects a sender without a project_access permission row', async () => {
    const room = buildRoom({
      id: 'room-chan',
      project_id: 'project-1',
      type: 'channel',
      slug: 'general',
    });
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(room),
    });
    const service = makeService(repo, {
      resolvePermissions: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.sendChannelMessage('project-1', 'sender-1', {
        room_id: 'room-chan',
        content: 'hello',
      }),
    ).rejects.toThrow('permission to post');
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
        {
          url,
          name: '1.png',
          content_type: 'image/png',
          size: 100,
          width: 10,
          height: 20,
        },
      ],
    });

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ url, width: 10, height: 20 })],
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

    await makeService(
      repo,
      {},
      buildNotifications({ createNotification }),
    ).sendChannelMessage('project-1', 'actor-1', {
      room_id: 'room-chan',
      content: 'hi @M Two',
      mentions: [{ user_id: 'm2', name: 'M Two', offset: 3, length: 6 }],
    });

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

  it('fires channel mention notifications before the send resolves', async () => {
    // Regression guard. This used to run detached, which meant Cloud Run could
    // freeze the tail once the response flushed and lose the notification
    // outright — no bell row, no push, and no email either, since the outbox is
    // fed by an AFTER INSERT trigger on notifications. Note the deliberate
    // absence of `await flush()`: the assertion must hold on resolve alone.
    const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(channelForMentions()),
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'm2']),
    });

    await makeService(
      repo,
      {},
      buildNotifications({ createNotification }),
    ).sendChannelMessage('project-1', 'actor-1', {
      room_id: 'room-chan',
      content: 'hi @M Two',
      mentions: [{ user_id: 'm2', name: 'M Two', offset: 3, length: 6 }],
    });

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'm2', type_name: 'chat_mention' }),
    );
  });

  it('still delivers the message when mention notifications fail', async () => {
    // Awaiting must not make notifications load-bearing for the send.
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(channelForMentions()),
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'm2']),
    });

    await expect(
      makeService(
        repo,
        {},
        buildNotifications({
          createNotification: jest
            .fn()
            .mockRejectedValue(new Error('notifications down')),
        }),
      ).sendChannelMessage('project-1', 'actor-1', {
        room_id: 'room-chan',
        content: 'hi @M Two',
        mentions: [{ user_id: 'm2', name: 'M Two', offset: 3, length: 6 }],
      }),
    ).resolves.toBeDefined();
  });

  it('@everyone expands to every project member except the sender', async () => {
    const repo = buildRepo({
      findRoomForParticipant: jest.fn().mockResolvedValue(channelForMentions()),
      listProjectParticipantUserIds: jest
        .fn()
        .mockResolvedValue(['actor-1', 'm2', 'm3']),
    });
    const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });

    await makeService(
      repo,
      {},
      buildNotifications({ createNotification }),
    ).sendChannelMessage('project-1', 'actor-1', {
      room_id: 'room-chan',
      content: 'heads up @everyone',
      mentions: [
        { user_id: 'everyone', name: 'everyone', offset: 9, length: 9 },
      ],
    });

    await flush();
    const notified = createNotification.mock.calls
      .map((c) => c[0].user_id)
      .sort();
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

    await makeService(
      repo,
      {},
      buildNotifications({ createNotification }),
    ).sendChannelMessage('project-1', 'actor-1', {
      room_id: 'room-chan',
      content: 'hi @Outsider',
      mentions: [
        { user_id: 'stranger', name: 'Outsider', offset: 3, length: 9 },
      ],
    });

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
        message_id: 'm1',
        sender_id: 'u1',
        created_at: 't',
        url: 'cdn/a.png',
        name: 'a.png',
        content_type: 'image/png',
        size: 1,
        width: 2,
        height: 3,
      },
      {
        message_id: 'm2',
        sender_id: 'u1',
        created_at: 't',
        url: 'cdn/b.pdf',
        name: 'b.pdf',
        content_type: 'application/pdf',
        size: 4,
        width: null,
        height: null,
      },
    ]);
    const listRoomLinks = jest.fn().mockResolvedValue([
      {
        message_id: 'm3',
        sender_id: 'u1',
        created_at: 't',
        url: 'https://x.dev',
      },
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
    const upsertDm = jest
      .fn()
      .mockResolvedValue(buildRoom({ slug: 'actor-1_rec-1' }));
    const upsertParticipants = jest.fn().mockResolvedValue(undefined);
    const repo = buildRepo({ upsertDm, upsertParticipants });
    const service = makeService(repo);

    const room = await service.resolveDmRoom('actor-1', 'rec-1');
    expect(room.slug).toBe('actor-1_rec-1');
    expect(upsertParticipants).toHaveBeenCalledWith(room.id, [
      'actor-1',
      'rec-1',
    ]);
  });

  // ── Edit + soft-delete ──────────────────────────────────────────────────
  const ownMessage = (overrides: Record<string, unknown> = {}) => ({
    id: 'msg-1',
    room_id: 'room-1',
    project_id: null,
    sender_id: 'actor-1',
    content: 'original',
    attachments: [],
    mentions: [],
    edited_at: null,
    deleted_at: null,
    reply_to_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  });

  const editableRepo = (overrides: Partial<ChatRepository>) =>
    buildRepo({
      findMessageById: jest.fn().mockResolvedValue(ownMessage()),
      findRoomById: jest.fn().mockResolvedValue(buildRoom({ id: 'room-1' })),
      isRoomParticipant: jest.fn().mockResolvedValue(true),
      ...overrides,
    });

  it('editMessage updates content + mentions and stamps edited_at', async () => {
    const updateMessageContent = jest
      .fn()
      .mockResolvedValue(ownMessage({ content: 'updated', edited_at: 't' }));
    const repo = editableRepo({ updateMessageContent });

    const result = await makeService(repo).editMessage('msg-1', 'actor-1', {
      content: 'updated',
    });

    expect(updateMessageContent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        senderId: 'actor-1',
        content: 'updated',
        editedAt: expect.any(String),
      }),
    );
    expect(result.message.edited_at).toBe('t');
  });

  it('editMessage rejects editing another member’s message', async () => {
    const updateMessageContent = jest.fn();
    const repo = editableRepo({
      findMessageById: jest
        .fn()
        .mockResolvedValue(ownMessage({ sender_id: 'someone-else' })),
      updateMessageContent,
    });

    await expect(
      makeService(repo).editMessage('msg-1', 'actor-1', { content: 'x' }),
    ).rejects.toThrow();
    expect(updateMessageContent).not.toHaveBeenCalled();
  });

  it('editMessage rejects editing a deleted message', async () => {
    const updateMessageContent = jest.fn();
    const repo = editableRepo({
      findMessageById: jest
        .fn()
        .mockResolvedValue(ownMessage({ deleted_at: 't' })),
      updateMessageContent,
    });

    await expect(
      makeService(repo).editMessage('msg-1', 'actor-1', { content: 'x' }),
    ).rejects.toThrow();
    expect(updateMessageContent).not.toHaveBeenCalled();
  });

  it('editMessage rejects blanking content with no attachments', async () => {
    const updateMessageContent = jest.fn();
    const repo = editableRepo({ updateMessageContent });

    await expect(
      makeService(repo).editMessage('msg-1', 'actor-1', { content: '   ' }),
    ).rejects.toThrow();
    expect(updateMessageContent).not.toHaveBeenCalled();
  });

  it('unsendMessage soft-deletes (tombstone) rather than hard-deleting', async () => {
    const softDeleteMessage = jest.fn().mockResolvedValue(undefined);
    const repo = editableRepo({ softDeleteMessage });

    const result = await makeService(repo).unsendMessage('msg-1', 'actor-1');

    expect(softDeleteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        senderId: 'actor-1',
        deletedAt: expect.any(String),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('listRoomMessages masks a soft-deleted message', async () => {
    const repo = editableRepo({
      listRoomMessages: jest.fn().mockResolvedValue([
        ownMessage({
          id: 'm-del',
          content: 'secret',
          deleted_at: 't',
          attachments: [{ url: 'x' }],
          mentions: [{ user_id: 'u' }],
        }),
        ownMessage({ id: 'm-ok', content: 'visible' }),
      ]),
    });

    const result = await makeService(repo).listRoomMessages(
      'room-1',
      'viewer-1',
    );

    const del = result.messages.find((m) => m.id === 'm-del')!;
    expect(del.content).toBe('');
    expect(del.attachments).toEqual([]);
    expect(del.mentions).toEqual([]);
    expect(del.deleted_at).toBe('t');

    const ok = result.messages.find((m) => m.id === 'm-ok')!;
    expect(ok.content).toBe('visible');
  });

  // ── DM received notifications ──────────────────────────────────────────────
  describe('DM received notifications', () => {
    const dmRoom = () => buildRoom({ id: 'room-dm', type: 'dm' });

    /** Sender + one recipient, with the recipient's read pointer. */
    const participants = (lastReadAt: string | null = null) => [
      { user_id: 'actor-1', last_read_at: null },
      { user_id: 'rec-1', last_read_at: lastReadAt },
    ];

    const sendDm = async (
      notifications: ReturnType<typeof buildNotifications>,
      opts: {
        readState?: { user_id: string; last_read_at: string | null }[];
        content?: string;
        mentions?: {
          user_id: string;
          name: string;
          offset: number;
          length: number;
        }[];
      } = {},
    ) => {
      const repo = buildRepo({
        findRoomForParticipant: jest.fn().mockResolvedValue(dmRoom()),
        listRoomParticipantUserIds: jest
          .fn()
          .mockResolvedValue(['actor-1', 'rec-1']),
        listRoomParticipantReadState: jest
          .fn()
          .mockResolvedValue(opts.readState ?? participants()),
      });
      await makeService(repo, {}, notifications).sendDmMessage('actor-1', {
        room_id: 'room-dm',
        content: opts.content ?? 'hello there',
        mentions: opts.mentions,
      });
      return repo;
    };

    const dmCalls = (createNotification: jest.Mock) =>
      createNotification.mock.calls.filter(
        (c) => c[0].type_name === 'chat_dm_received',
      );

    it('notifies the recipient and nobody else', async () => {
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      await sendDm(buildNotifications({ createNotification }));

      const calls = dmCalls(createNotification);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toMatchObject({
        user_id: 'rec-1',
        actor_id: 'actor-1',
        type_name: 'chat_dm_received',
        link_url: '/inbox?r=room-dm',
      });
    });

    it('is awaited, not fired detached', async () => {
      // Regression guard for the bounded-await decision. Cloud Run throttles CPU
      // once the response flushes, so a detached tail can be frozen and the DM
      // would silently never notify. Note the deliberate absence of
      // `await flush()` here — the mention tests above NEED it, this must not.
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      await sendDm(buildNotifications({ createNotification }));

      expect(dmCalls(createNotification)).toHaveLength(1);
    });

    it('carries the ids the email worker depends on, and no context_title', async () => {
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      await sendDm(buildNotifications({ createNotification }));

      const content = dmCalls(createNotification)[0][0].content as Record<
        string,
        unknown
      >;
      // Without message_id the worker's seen_in_app gate silently disables
      // itself and mails people who already read the DM.
      expect(content.room_id).toBe('room-dm');
      expect(content.message_id).toBe('msg-1');
      expect(content.actor_name).toBe('Ada Lovelace');
      // Derived from the PERSISTED message, not the DTO — the repo mock returns
      // 'hello', and snapshotting what was actually stored is the correct
      // behaviour.
      expect(content.excerpt).toBe('hello');
      expect(content.message).toBe('Ada Lovelace sent you a message');
      // Would render "sent you a message in a direct message".
      expect(content).not.toHaveProperty('context_title');
    });

    it('says attachment when the message has no text', async () => {
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      const repo = buildRepo({
        findRoomForParticipant: jest.fn().mockResolvedValue(dmRoom()),
        listRoomParticipantReadState: jest
          .fn()
          .mockResolvedValue(participants()),
        createMessage: jest.fn().mockResolvedValue({
          id: 'msg-1',
          room_id: 'room-dm',
          project_id: null,
          sender_id: 'actor-1',
          content: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      await makeService(
        repo,
        {},
        buildNotifications({ createNotification }),
      ).sendDmMessage('actor-1', {
        room_id: 'room-dm',
        attachments: [
          {
            url: 'https://cdn.proyekto.tech/chat_attachments/actor-1/a.png',
            name: 'a.png',
            content_type: 'image/png',
            size: 10,
          },
        ],
      });

      const content = dmCalls(createNotification)[0][0].content as Record<
        string,
        unknown
      >;
      expect(content.message).toBe('Ada Lovelace sent you an attachment');
      expect(content).not.toHaveProperty('excerpt');
    });

    it('mention wins — a mentioned recipient gets no DM notification', async () => {
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      await sendDm(buildNotifications({ createNotification }), {
        mentions: [{ user_id: 'rec-1', name: 'Rec', offset: 0, length: 3 }],
      });
      await flush();

      expect(dmCalls(createNotification)).toHaveLength(0);
      expect(
        createNotification.mock.calls.filter(
          (c) => c[0].type_name === 'chat_mention',
        ),
      ).toHaveLength(1);
    });

    it('mention wins for the @everyone sentinel too', async () => {
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      await sendDm(buildNotifications({ createNotification }), {
        mentions: [
          { user_id: 'everyone', name: 'everyone', offset: 0, length: 8 },
        ],
      });
      await flush();

      expect(dmCalls(createNotification)).toHaveLength(0);
    });

    it('does not stack — a live notification suppresses the next message', async () => {
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      await sendDm(
        buildNotifications({
          createNotification,
          findLiveChatRoomNotification: jest
            .fn()
            .mockResolvedValue({ id: 'n0' }),
        }),
      );

      expect(dmCalls(createNotification)).toHaveLength(0);
    });

    it('re-arms once the recipient has read the room', async () => {
      // The most important test here. Nothing marks a notification read when you
      // read the room, so if the probe ignored last_read_at a conversation would
      // notify exactly once, ever.
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      const findLive = jest.fn().mockResolvedValue(null);
      const readAt = new Date().toISOString();
      await sendDm(
        buildNotifications({
          createNotification,
          findLiveChatRoomNotification: findLive,
        }),
        { readState: participants(readAt) },
      );

      // The read pointer must reach the probe, or staleness cannot be evaluated.
      expect(findLive).toHaveBeenCalledWith('rec-1', 'room-dm', readAt);
      expect(dmCalls(createNotification)).toHaveLength(1);
    });

    it('never notifies on a channel message', async () => {
      const createNotification = jest.fn().mockResolvedValue({ id: 'n1' });
      const repo = buildRepo({
        findRoomForParticipant: jest.fn().mockResolvedValue(
          buildRoom({
            id: 'room-chan',
            project_id: 'project-1',
            type: 'channel',
          }),
        ),
      });
      await makeService(
        repo,
        {},
        buildNotifications({ createNotification }),
      ).sendChannelMessage('project-1', 'actor-1', {
        room_id: 'room-chan',
        content: 'hi',
      });
      await flush();

      expect(dmCalls(createNotification)).toHaveLength(0);
    });

    it('still sends the message when the notification path throws', async () => {
      const createNotification = jest
        .fn()
        .mockRejectedValue(new Error('notifications down'));
      await expect(
        sendDm(buildNotifications({ createNotification })),
      ).resolves.toBeDefined();
    });
  });
});
