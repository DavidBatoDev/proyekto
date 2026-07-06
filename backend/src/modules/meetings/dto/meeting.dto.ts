import {
  IsArray,
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
// 'external_link' stores an organizer-pasted URL, 'none' has no video.
export const VIDEO_OPTIONS = ['none', 'jitsi', 'external_link'] as const;
export type VideoOption = (typeof VIDEO_OPTIONS)[number];

export const PARTICIPANT_RESPONSES = [
  'accepted',
  'declined',
  'tentative',
] as const;
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSES)[number];

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
  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  participant_ids?: string[];
}

export class RescheduleMeetingDto {
  @IsISO8601() scheduled_at: string;
  @IsOptional() @IsInt() @Min(5) @Max(1440) duration_minutes?: number;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
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
