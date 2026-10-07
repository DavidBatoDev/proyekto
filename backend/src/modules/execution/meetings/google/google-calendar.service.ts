import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GoogleOAuthService } from './google-oauth.service';

const EVENTS_BASE =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Normalized event input — MeetingsService resolves attendee emails and passes
 * them here (keeps this service free of the meetings repository / no import cycle). */
export interface CalendarEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startIso: string; // UTC ISO instant
  endIso: string; // UTC ISO instant
  timezone: string; // IANA zone the times are shown in
  attendeeEmails: string[];
  rrule?: string | null; // RFC-5545 body (no `RRULE:` prefix); series only
}

interface GCalEvent {
  id?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
}

interface GCalDateTime {
  date?: string; // all-day: YYYY-MM-DD
  dateTime?: string; // timed: RFC 3339
  timeZone?: string;
}

interface GCalListItem extends GCalEvent {
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  transparency?: string;
  start?: GCalDateTime;
  end?: GCalDateTime;
}

interface GCalListResponse {
  items?: GCalListItem[];
  nextPageToken?: string;
}

/** A read-only event from the user's primary Google calendar. Never stored. */
export interface GoogleCalendarEvent {
  id: string;
  /** Master id for an occurrence of a recurring event, else null. */
  recurringEventId: string | null;
  title: string;
  /** RFC 3339 instant for timed events; YYYY-MM-DD for all-day events. */
  start: string;
  /** Exclusive end; for all-day events the day after the last day. */
  end: string;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
  meetUrl: string | null;
  /** True when the event is marked "free" (doesn't block time). */
  free: boolean;
}

// Google caps a page at 2500 but recommends smaller pages; 4 × 250 covers a
// very busy quarter. Anything beyond is dropped (the view is a convenience).
const LIST_PAGE_SIZE = 250;
const LIST_MAX_PAGES = 4;
const LIST_FIELDS =
  'nextPageToken,items(id,status,summary,location,htmlLink,hangoutLink,recurringEventId,transparency,start,end,conferenceData/entryPoints)';

type QueryParams = Record<string, string>;
// Writes always ask for Meet conference data and email attendees about changes.
const WRITE_QUERY: QueryParams = {
  conferenceDataVersion: '1',
  sendUpdates: 'all',
};

/**
 * Thin Google Calendar REST client (raw fetch, no `googleapis` dep — mirrors the
 * Gmail integration). Creates/patches/deletes events with a Meet conference link
 * and attendees; a recurring series maps to one native Google recurring event.
 * It also lists the user's primary-calendar events for the read-only overlay in
 * the Meetings calendar. All calls run as the user via
 * `GoogleOAuthService.getAccessToken`.
 */
@Injectable()
export class GoogleCalendarService {
  constructor(private readonly oauth: GoogleOAuthService) {}

  isEnabled(): boolean {
    return this.oauth.isEnabled();
  }

  isConnected(userId: string): Promise<boolean> {
    return this.oauth.isConnected(userId);
  }

  /** Insert a one-off (no rrule) or recurring (rrule) event with a Meet link. */
  async createEvent(
    userId: string,
    input: CalendarEventInput,
  ): Promise<{ meetingUrl: string; googleEventId: string }> {
    const body: Record<string, unknown> = {
      ...this.buildBody(input),
      conferenceData: {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    if (input.rrule) {
      body.recurrence = [`RRULE:${this.normalizeRrule(input.rrule)}`];
    }
    const event = await this.write<GCalEvent>(userId, 'POST', '', body);
    if (!event?.id) {
      throw new Error('Google Calendar create returned no event id.');
    }
    const meetingUrl = this.extractMeetUrl(event);
    if (!meetingUrl) {
      throw new Error('Google Calendar event created without a Meet link.');
    }
    return { meetingUrl, googleEventId: event.id };
  }

  /** PATCH the master event (title/time/attendees/recurrence). */
  async patchEvent(
    userId: string,
    eventId: string,
    patch: Partial<CalendarEventInput>,
  ): Promise<void> {
    await this.write(
      userId,
      'PATCH',
      `/${encodeURIComponent(eventId)}`,
      this.buildBody(patch),
    );
  }

  /** PATCH a single occurrence (Google-side per-occurrence exception). */
  async patchInstance(
    userId: string,
    eventId: string,
    recurrenceIdUtc: string,
    patch: Partial<CalendarEventInput>,
  ): Promise<void> {
    const instanceId = this.deriveInstanceId(eventId, recurrenceIdUtc);
    await this.write(
      userId,
      'PATCH',
      `/${encodeURIComponent(instanceId)}`,
      this.buildBody(patch),
    );
  }

  /** Cancel a single occurrence (the EXDATE equivalent). */
  async cancelInstance(
    userId: string,
    eventId: string,
    recurrenceIdUtc: string,
  ): Promise<void> {
    const instanceId = this.deriveInstanceId(eventId, recurrenceIdUtc);
    await this.write(userId, 'PATCH', `/${encodeURIComponent(instanceId)}`, {
      status: 'cancelled',
    });
  }

  /** Truncate a series by rewriting the master RRULE with a compact-UTC UNTIL. */
  async truncateSeriesUntil(
    userId: string,
    eventId: string,
    rrule: string,
    untilIsoUtc: string,
  ): Promise<void> {
    await this.write(userId, 'PATCH', `/${encodeURIComponent(eventId)}`, {
      recurrence: [`RRULE:${this.withUntil(rrule, untilIsoUtc)}`],
    });
  }

  async deleteEvent(userId: string, eventId: string): Promise<void> {
    await this.write(userId, 'DELETE', `/${encodeURIComponent(eventId)}`);
  }

  /**
   * Events on the user's primary calendar overlapping [from, to), with
   * recurring events expanded into occurrences. Cancelled occurrences are
   * dropped. Read on demand only; the caller must not persist the result.
   */
  async listEvents(
    userId: string,
    range: { from: string; to: string },
  ): Promise<GoogleCalendarEvent[]> {
    const events: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const query: QueryParams = {
        timeMin: new Date(range.from).toISOString(),
        timeMax: new Date(range.to).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(LIST_PAGE_SIZE),
        fields: LIST_FIELDS,
      };
      if (pageToken) query.pageToken = pageToken;
      const response = await this.call<GCalListResponse>(
        userId,
        'GET',
        '',
        query,
      );
      for (const item of response?.items ?? []) {
        const mapped = this.mapListItem(item);
        if (mapped) events.push(mapped);
      }
      pageToken = response?.nextPageToken;
      if (!pageToken) break;
    }
    return events;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private buildBody(
    input: Partial<CalendarEventInput>,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.summary = input.title;
    if (input.description !== undefined) {
      body.description = input.description ?? undefined;
    }
    if (input.location !== undefined)
      body.location = input.location ?? undefined;
    if (input.startIso !== undefined && input.timezone !== undefined) {
      body.start = { dateTime: input.startIso, timeZone: input.timezone };
    }
    if (input.endIso !== undefined && input.timezone !== undefined) {
      body.end = { dateTime: input.endIso, timeZone: input.timezone };
    }
    if (input.attendeeEmails !== undefined) {
      body.attendees = input.attendeeEmails.map((email) => ({ email }));
    }
    if (input.rrule !== undefined && input.rrule !== null) {
      body.recurrence = [`RRULE:${this.normalizeRrule(input.rrule)}`];
    }
    return body;
  }

  private write<T>(
    userId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    return this.call<T>(userId, method, path, WRITE_QUERY, body);
  }

  /**
   * Authorized request against the primary calendar's events collection. A 401
   * means the cached access token went stale early (revoked session, clock
   * skew): drop it and retry once with a freshly minted token.
   */
  private async call<T>(
    userId: string,
    method: string,
    path: string,
    query: QueryParams,
    body?: unknown,
  ): Promise<T | null> {
    const url = `${EVENTS_BASE}${path}?${new URLSearchParams(query).toString()}`;
    let response = await this.send(userId, method, url, body);
    if (response.status === 401) {
      await this.oauth.invalidateAccessToken(userId);
      response = await this.send(userId, method, url, body);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Google Calendar ${method} events${path} failed (status ${response.status}): ${text}`,
      );
    }
    if (response.status === 204) return null;
    return (await response.json()) as T;
  }

  private async send(
    userId: string,
    method: string,
    url: string,
    body?: unknown,
  ): Promise<Response> {
    const accessToken = await this.oauth.getAccessToken(userId);
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private mapListItem(item: GCalListItem): GoogleCalendarEvent | null {
    if (!item.id || item.status === 'cancelled') return null;
    const allDay = Boolean(item.start?.date);
    const start = item.start?.dateTime ?? item.start?.date;
    const end = item.end?.dateTime ?? item.end?.date ?? start;
    if (!start || !end) return null;
    return {
      id: item.id,
      recurringEventId: item.recurringEventId ?? null,
      title: item.summary?.trim() || '(No title)',
      start,
      end,
      allDay,
      location: item.location ?? null,
      htmlLink: item.htmlLink ?? null,
      meetUrl: this.extractMeetUrl(item),
      free: item.transparency === 'transparent',
    };
  }

  private extractMeetUrl(event: GCalEvent): string | null {
    if (event.hangoutLink) return event.hangoutLink;
    const entry = event.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === 'video',
    );
    return entry?.uri ?? null;
  }

  /** Google's instance id for a timed recurring event = `${eventId}_${compactUtc}`. */
  private deriveInstanceId(eventId: string, recurrenceIdUtc: string): string {
    return `${eventId}_${this.toCompactUtc(recurrenceIdUtc)}`;
  }

  /** Ensure any UNTIL in the rule is compact-UTC (Google rejects a floating one). */
  private normalizeRrule(rrule: string): string {
    return rrule
      .split(';')
      .map((part) => {
        const match = /^UNTIL=(.+)$/i.exec(part.trim());
        return match ? `UNTIL=${this.toCompactUtc(match[1])}` : part.trim();
      })
      .join(';');
  }

  /** Strip any existing UNTIL/COUNT, then append a compact-UTC UNTIL. */
  private withUntil(rrule: string, untilIsoUtc: string): string {
    const base = rrule
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p && !/^(UNTIL|COUNT)=/i.test(p))
      .join(';');
    return `${base};UNTIL=${this.toCompactUtc(untilIsoUtc)}`;
  }

  /** Accept an ISO instant or an already-compact value → `YYYYMMDDTHHMMSSZ`. */
  private toCompactUtc(value: string): string {
    const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(
      value,
    );
    const date = compact
      ? new Date(
          `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`,
        )
      : new Date(value);
    return date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
  }
}
