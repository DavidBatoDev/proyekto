import { ConflictException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import type {
  Meeting,
  MeetingsRepository,
} from './repositories/meetings.repository.interface';

// Minimal in-memory-ish mocks — the service logic (video resolution, participant
// fan-out, reschedule chaining, double-book guard) is exercised without a DB.
function makeRepo(): jest.Mocked<MeetingsRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    listForUser: jest.fn(),
    listForProject: jest.fn(),
    update: jest.fn(),
    addParticipants: jest.fn().mockResolvedValue(undefined),
    removeParticipants: jest.fn().mockResolvedValue(undefined),
    getParticipants: jest.fn(),
    setParticipantResponse: jest.fn(),
    findOverlappingForHost: jest.fn().mockResolvedValue([]),
    getUserProjectIds: jest.fn().mockResolvedValue([]),
    createSeries: jest.fn(),
    findSeriesById: jest.fn(),
    updateSeries: jest.fn(),
    insertInstanceIgnoreConflict: jest.fn(),
    insertParticipantRows: jest.fn().mockResolvedValue(undefined),
    cancelSeriesInstances: jest.fn().mockResolvedValue(undefined),
    deleteFutureNonExceptionInstances: jest.fn().mockResolvedValue(undefined),
    updateFutureNonExceptionInstances: jest.fn().mockResolvedValue(undefined),
  };
}

const authorization = {
  assertRole: jest.fn().mockResolvedValue('viewer'),
  getUserProjectRole: jest.fn().mockResolvedValue('owner'),
  roleSatisfies: jest.fn().mockReturnValue(true),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const notifications = {
  createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = { get: (_k: string, d: unknown) => d } as any;

function baseMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    project_id: null,
    host_id: 'user-1',
    created_by: 'user-1',
    title: 'Sync',
    description: null,
    type: 'status_sync',
    scheduled_at: '2026-07-10T10:00:00.000Z',
    ends_at: '2026-07-10T10:30:00.000Z',
    duration_minutes: 30,
    status: 'scheduled',
    video_provider: 'jitsi',
    meeting_url: 'https://meet.jit.si/proyekto-x',
    timezone: null,
    location: null,
    reminder_minutes: null,
    guest_email: null,
    guest_name: null,
    reschedule_of: null,
    series_id: null,
    recurrence_id: null,
    original_start: null,
    is_exception: false,
    created_at: '2026-07-06T00:00:00.000Z',
    updated_at: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('MeetingsService', () => {
  let repo: jest.Mocked<MeetingsRepository>;
  let service: MeetingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = makeRepo();
    service = new MeetingsService(repo, authorization, notifications, config);
  });

  it('auto-generates a Jitsi room when no video option or url is given', async () => {
    repo.create.mockResolvedValue(baseMeeting());
    repo.findById.mockResolvedValue(baseMeeting());

    await service.create('user-1', {
      title: 'Sync',
      type: 'status_sync',
      scheduled_at: '2026-07-10T10:00:00.000Z',
      participant_ids: ['user-2', 'user-2', 'user-1'], // dupes + creator stripped
    });

    const createArg = repo.create.mock.calls[0][0];
    expect(createArg.video_provider).toBe('jitsi');
    expect(createArg.meeting_url).toMatch(/^https:\/\/meet\.jit\.si\/proyekto-/);
    expect(createArg.ends_at).toBe('2026-07-10T10:30:00.000Z');

    // Host + exactly one deduped invitee (creator not re-added as attendee).
    const participants = repo.addParticipants.mock.calls[0][1];
    expect(participants).toHaveLength(2);
    expect(participants[0]).toMatchObject({ role: 'host', response: 'accepted' });
    expect(participants[1]).toMatchObject({ user_id: 'user-2', role: 'attendee' });

    // One invite notification (to the single invitee).
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-2', type_name: 'meeting_invited' }),
    );
  });

  it('stores an organizer-pasted external link', async () => {
    repo.create.mockResolvedValue(baseMeeting({ video_provider: 'external_link' }));
    repo.findById.mockResolvedValue(baseMeeting());

    await service.create('user-1', {
      title: 'Sync',
      type: 'status_sync',
      scheduled_at: '2026-07-10T10:00:00.000Z',
      video_option: 'external_link',
      meeting_url: 'https://meet.google.com/abc-defg-hij',
    });

    const createArg = repo.create.mock.calls[0][0];
    expect(createArg.video_provider).toBe('external_link');
    expect(createArg.meeting_url).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('rejects a booking that collides with an existing scheduled meeting', async () => {
    repo.findOverlappingForHost.mockResolvedValue([baseMeeting({ id: 'other' })]);

    await expect(
      service.create('user-1', {
        title: 'Sync',
        type: 'status_sync',
        scheduled_at: '2026-07-10T10:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('reschedule creates a new row, chains reschedule_of, and retires the old one', async () => {
    const old = baseMeeting({
      participants: [
        {
          id: 'p1',
          user_id: 'user-1',
          guest_email: null,
          guest_name: null,
          role: 'host',
          response: 'accepted',
        },
        {
          id: 'p2',
          user_id: 'user-2',
          guest_email: null,
          guest_name: null,
          role: 'attendee',
          response: 'accepted',
        },
      ],
    });
    repo.findById.mockResolvedValueOnce(old); // initial load
    const created = baseMeeting({ id: 'm2', reschedule_of: 'm1' });
    repo.create.mockResolvedValue(created);
    repo.findById.mockResolvedValue(created); // final re-read

    await service.reschedule('user-1', 'm1', {
      scheduled_at: '2026-07-11T14:00:00.000Z',
    });

    // New row links back to the original.
    expect(repo.create.mock.calls[0][0]).toMatchObject({ reschedule_of: 'm1' });
    // Old row retired.
    expect(repo.update).toHaveBeenCalledWith('m1', { status: 'rescheduled' });
    // Attendee reset to pending on the copy; host stays accepted.
    const copied = repo.addParticipants.mock.calls[0][1];
    expect(copied.find((p) => p.role === 'attendee')?.response).toBe('pending');
    // Other participant notified of the reschedule.
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-2', type_name: 'meeting_rescheduled' }),
    );
  });

  it('updateDetails edits scalar fields and reconciles attendees', async () => {
    const existing = baseMeeting({
      participants: [
        {
          id: 'p1',
          user_id: 'user-1',
          guest_email: null,
          guest_name: null,
          role: 'host',
          response: 'accepted',
        },
        {
          id: 'p2',
          user_id: 'user-2',
          guest_email: null,
          guest_name: null,
          role: 'attendee',
          response: 'accepted',
        },
      ],
    });
    repo.findById.mockResolvedValue(existing);

    await service.updateDetails('user-1', 'm1', {
      title: 'Renamed',
      location: 'Room 4',
      reminder_minutes: 15,
      participant_ids: ['user-3'], // drop user-2, add user-3
    });

    // Scalar fields patched.
    expect(repo.update).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({
        title: 'Renamed',
        location: 'Room 4',
        reminder_minutes: 15,
      }),
    );
    // Attendee diff: user-2 removed, user-3 added + notified.
    expect(repo.removeParticipants).toHaveBeenCalledWith('m1', ['user-2']);
    expect(repo.addParticipants).toHaveBeenCalledWith('m1', [
      expect.objectContaining({ user_id: 'user-3', role: 'attendee' }),
    ]);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-3', type_name: 'meeting_invited' }),
    );
  });

  it('updateDetails refuses a non-manager', async () => {
    repo.findById.mockResolvedValue(baseMeeting());
    authorization.getUserProjectRole.mockResolvedValueOnce(null);

    await expect(
      service.updateDetails('intruder', 'm1', { title: 'Hijack' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
