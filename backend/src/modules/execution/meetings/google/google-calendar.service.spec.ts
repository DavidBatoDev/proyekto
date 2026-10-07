import { GoogleCalendarService } from './google-calendar.service';
import type { GoogleOAuthService } from './google-oauth.service';

const oauth = {
  isEnabled: jest.fn().mockReturnValue(true),
  isConnected: jest.fn(),
  getAccessToken: jest.fn().mockResolvedValue('access-tok'),
  invalidateAccessToken: jest.fn().mockResolvedValue(undefined),
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

  it('retries once with a fresh token when Google answers 401', async () => {
    oauth.getAccessToken
      .mockResolvedValueOnce('stale-tok')
      .mockResolvedValueOnce('fresh-tok');
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('unauthorized'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });

    await service.deleteEvent('u1', 'ev-1');

    expect(oauth.invalidateAccessToken).toHaveBeenCalledWith('u1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1] as [string, FetchInit];
    expect(retryInit.headers.Authorization).toBe('Bearer fresh-tok');
  });

  describe('listEvents', () => {
    const range = {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
    };

    it('reads expanded occurrences from the primary calendar without write params', async () => {
      fetchMock.mockResolvedValue(okJson({ items: [] }));

      await service.listEvents('u1', range);

      const { url, init } = firstCall();
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/calendar/v3/calendars/primary/events');
      expect(init.method).toBe('GET');
      expect(parsed.searchParams.get('timeMin')).toBe(range.from);
      expect(parsed.searchParams.get('timeMax')).toBe(range.to);
      expect(parsed.searchParams.get('singleEvents')).toBe('true');
      expect(parsed.searchParams.get('orderBy')).toBe('startTime');
      expect(parsed.searchParams.get('maxResults')).toBe('250');
      expect(parsed.searchParams.get('fields')).toContain('items(');
      expect(parsed.searchParams.get('sendUpdates')).toBeNull();
      expect(parsed.searchParams.get('conferenceDataVersion')).toBeNull();
      expect(init.body).toBeUndefined();
    });

    it('maps timed, all-day and Meet events and drops cancelled ones', async () => {
      fetchMock.mockResolvedValue(
        okJson({
          items: [
            {
              id: 'a',
              status: 'confirmed',
              summary: ' Dentist ',
              location: 'Clinic',
              htmlLink: 'https://calendar.google.com/event?eid=a',
              start: { dateTime: '2026-10-02T09:00:00+10:00' },
              end: { dateTime: '2026-10-02T10:00:00+10:00' },
            },
            {
              id: 'b',
              status: 'confirmed',
              start: { date: '2026-10-05' },
              end: { date: '2026-10-07' },
              transparency: 'transparent',
            },
            {
              id: 'c_20261003T010000Z',
              recurringEventId: 'c',
              summary: 'Weekly sync',
              hangoutLink: 'https://meet.google.com/abc',
              start: { dateTime: '2026-10-03T01:00:00Z' },
              end: { dateTime: '2026-10-03T01:30:00Z' },
            },
            {
              id: 'gone',
              status: 'cancelled',
              start: { dateTime: '2026-10-04T01:00:00Z' },
              end: { dateTime: '2026-10-04T02:00:00Z' },
            },
          ],
        }),
      );

      const events = await service.listEvents('u1', range);

      expect(events).toEqual([
        {
          id: 'a',
          recurringEventId: null,
          title: 'Dentist',
          start: '2026-10-02T09:00:00+10:00',
          end: '2026-10-02T10:00:00+10:00',
          allDay: false,
          location: 'Clinic',
          htmlLink: 'https://calendar.google.com/event?eid=a',
          meetUrl: null,
          free: false,
        },
        {
          id: 'b',
          recurringEventId: null,
          title: '(No title)',
          start: '2026-10-05',
          end: '2026-10-07',
          allDay: true,
          location: null,
          htmlLink: null,
          meetUrl: null,
          free: true,
        },
        {
          id: 'c_20261003T010000Z',
          recurringEventId: 'c',
          title: 'Weekly sync',
          start: '2026-10-03T01:00:00Z',
          end: '2026-10-03T01:30:00Z',
          allDay: false,
          location: null,
          htmlLink: null,
          meetUrl: 'https://meet.google.com/abc',
          free: false,
        },
      ]);
    });

    it('follows nextPageToken but stops after four pages', async () => {
      const page = (id: string) =>
        okJson({
          items: [
            {
              id,
              start: { dateTime: '2026-10-02T09:00:00Z' },
              end: { dateTime: '2026-10-02T10:00:00Z' },
            },
          ],
          nextPageToken: `after-${id}`,
        });
      fetchMock
        .mockResolvedValueOnce(page('p1'))
        .mockResolvedValueOnce(page('p2'))
        .mockResolvedValueOnce(page('p3'))
        .mockResolvedValueOnce(page('p4'))
        .mockResolvedValueOnce(page('p5'));

      const events = await service.listEvents('u1', range);

      expect(events.map((e) => e.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const [secondUrl] = fetchMock.mock.calls[1] as [string];
      expect(new URL(secondUrl).searchParams.get('pageToken')).toBe('after-p1');
    });
  });
});
