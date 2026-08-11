import { GoogleCalendarService } from './google-calendar.service';
import type { GoogleOAuthService } from './google-oauth.service';

const oauth = {
  isEnabled: jest.fn().mockReturnValue(true),
  isConnected: jest.fn(),
  getAccessToken: jest.fn().mockResolvedValue('access-tok'),
};

function okJson(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface EventBody {
  conferenceData?: {
    createRequest?: { conferenceSolutionKey?: { type?: string } };
  };
  attendees?: { email: string }[];
  start?: { dateTime: string; timeZone: string };
  recurrence?: string[];
  status?: string;
}

describe('GoogleCalendarService', () => {
  let service: GoogleCalendarService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GoogleCalendarService(oauth as unknown as GoogleOAuthService);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function firstCall(): { url: string; init: FetchInit; body: EventBody } {
    const [url, init] = fetchMock.mock.calls[0] as [string, FetchInit];
    return {
      url,
      init,
      body: init.body ? (JSON.parse(init.body) as EventBody) : {},
    };
  }

  it('createEvent posts a Meet conferenceData request + attendees and returns the link + id', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        id: 'ev-1',
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
      }),
    );

    const res = await service.createEvent('u1', {
      title: 'Sync',
      startIso: '2026-07-10T10:00:00.000Z',
      endIso: '2026-07-10T10:30:00.000Z',
      timezone: 'Australia/Sydney',
      attendeeEmails: ['a@x.com'],
    });

    expect(res).toEqual({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      googleEventId: 'ev-1',
    });
    const { url, init, body } = firstCall();
    expect(url).toContain('/calendars/primary/events');
    expect(url).toContain('conferenceDataVersion=1');
    expect(url).toContain('sendUpdates=all');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer access-tok');
    expect(
      body.conferenceData?.createRequest?.conferenceSolutionKey?.type,
    ).toBe('hangoutsMeet');
    expect(body.attendees).toEqual([{ email: 'a@x.com' }]);
    expect(body.start).toEqual({
      dateTime: '2026-07-10T10:00:00.000Z',
      timeZone: 'Australia/Sydney',
    });
    expect(body.recurrence).toBeUndefined();
  });

  it('createEvent sends an RRULE for a series and normalizes UNTIL to compact UTC', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        id: 'ev-2',
        conferenceData: {
          entryPoints: [
            { entryPointType: 'video', uri: 'https://meet.google.com/xyz' },
          ],
        },
      }),
    );

    const res = await service.createEvent('u1', {
      title: 'Standup',
      startIso: '2026-07-10T10:00:00.000Z',
      endIso: '2026-07-10T10:30:00.000Z',
      timezone: 'UTC',
      attendeeEmails: [],
      rrule: 'FREQ=WEEKLY;UNTIL=2026-11-03T13:00:00.000Z',
    });

    // Meet link falls back to the video entry point when hangoutLink is absent.
    expect(res.meetingUrl).toBe('https://meet.google.com/xyz');
    expect(firstCall().body.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;UNTIL=20261103T130000Z',
    ]);
  });

  it('cancelInstance PATCHes the derived instance id with status cancelled', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });

    await service.cancelInstance('u1', 'ev-1', '2026-07-20T10:00:00.000Z');

    const { url, init, body } = firstCall();
    expect(url).toContain('/events/ev-1_20260720T100000Z');
    expect(init.method).toBe('PATCH');
    expect(body.status).toBe('cancelled');
  });

  it('throws with the status + body on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('forbidden'),
    });

    await expect(service.deleteEvent('u1', 'ev-1')).rejects.toThrow(/403/);
  });
});
