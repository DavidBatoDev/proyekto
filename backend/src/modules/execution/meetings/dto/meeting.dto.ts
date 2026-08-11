import {
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Kept in sync with the `meeting_type` enum (initial_schema + the
// 20260706120100 'consultation' addition). 'consultation' is used by the
// public/guest booking flow (Phase 3).
export const MEETING_TYPES = [
  'kickoff',
  'status_sync',
  'design_review',
  'qa',
  'scope_clarification',
  'retainer_sync',
  'client_consultant',
  'consultant_freelancer',
  'consultation',
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_STATUSES = [
  'scheduled',
  'cancelled',
  'completed',
  'rescheduled',
  'no_show',
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

// How the join link is produced. 'jitsi' auto-generates a no-auth room,
// 'external_link' stores an organizer-pasted URL, 'none' has no video,
// 'google_meet' provisions a real Meet link via the organizer's connected
// Google account (runtime-gated: rejected unless GOOGLE_OAUTH is enabled AND the
// organizer is connected — see MeetingsService.provisionVideo).
export const VIDEO_OPTIONS = [
  'none',
  'jitsi',
  'external_link',
  'google_meet',
] as const;
export type VideoOption = (typeof VIDEO_OPTIONS)[number];

export const PARTICIPANT_RESPONSES = [
  'accepted',
  'declined',
  'tentative',
] as const;
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSES)[number];

// Edit scope for a (future) recurring series. Only 'this' is meaningful for a
// standalone meeting; the series scopes ('following'/'all') land with recurrence.
export const MEETING_EDIT_SCOPES = ['this', 'following', 'all'] as const;
export type MeetingEditScope = (typeof MEETING_EDIT_SCOPES)[number];

// Reminder offset is capped at 4 weeks (40320 minutes).
const MAX_REMINDER_MINUTES = 40320;

export class CreateMeetingDto {
  @IsOptional() @IsUUID() project_id?: string;

  @IsString() @MaxLength(200) title: string;

  @IsOptional() @IsString() @MaxLength(2000) description?: string;

  @IsIn(MEETING_TYPES) type: MeetingType;

  @IsISO8601() scheduled_at: string;

  @IsOptional() @IsInt() @Min(5) @Max(1440) duration_minutes?: number;

  @IsOptional() @IsString() @MaxLength(64) timezone?: string;

  @IsOptional() @IsIn(VIDEO_OPTIONS) video_option?: VideoOption;

  // Required when video_option is 'external_link'.
  @IsOptional() @IsUrl({ require_tld: false }) meeting_url?: string;

  // Other project members to invite (the creator is added automatically as host).
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  participant_ids?: string[];

  // External (non-user) guests to invite by email.
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  guest_emails?: string[];

  @IsOptional() @IsString() @MaxLength(300) location?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_REMINDER_MINUTES)
  reminder_minutes?: number;

  // RFC-5545 rule body (no DTSTART) — when present, a recurring series is created.
  @IsOptional() @IsString() @MaxLength(2000) recurrence?: string;
}

export class RescheduleMeetingDto {
  @IsISO8601() scheduled_at: string;
  @IsOptional() @IsInt() @Min(5) @Max(1440) duration_minutes?: number;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}

// General field edit (title/type/time/guests/etc.) — closes the gap where a
// meeting was immutable after creation. All fields optional; only provided ones
// change. `scope` is accepted for forward-compatibility with recurring series.
export class UpdateMeetingDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(MEETING_TYPES) type?: MeetingType;
  @IsOptional() @IsISO8601() scheduled_at?: string;
  @IsOptional() @IsInt() @Min(5) @Max(1440) duration_minutes?: number;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_REMINDER_MINUTES)
  reminder_minutes?: number;
  @IsOptional() @IsIn(VIDEO_OPTIONS) video_option?: VideoOption;
  @IsOptional() @IsUrl({ require_tld: false }) meeting_url?: string;
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  participant_ids?: string[];
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  guest_emails?: string[];
  // New pattern when editing a series with scope 'all' / 'following'.
  @IsOptional() @IsString() @MaxLength(2000) recurrence?: string;
  @IsOptional() @IsIn(MEETING_EDIT_SCOPES) scope?: MeetingEditScope;
}

// Body for cancelling — `scope` cancels one occurrence, this-and-following, or
// the whole series (ignored for non-recurring meetings).
export class CancelMeetingDto {
  @IsOptional() @IsIn(MEETING_EDIT_SCOPES) scope?: MeetingEditScope;
}

export class RespondMeetingDto {
  @IsIn(PARTICIPANT_RESPONSES) response: ParticipantResponse;
}

export class ListMeetingsQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsIn(MEETING_STATUSES) status?: MeetingStatus;
  @IsOptional() @IsUUID() project_id?: string;
}
