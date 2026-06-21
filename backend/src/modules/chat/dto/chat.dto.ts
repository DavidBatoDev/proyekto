import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessagesQueryDto {
  @IsOptional()
  @IsString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * One chat attachment. The bytes already live in R2 (uploaded via the realtime
 * Worker's POST /uploads); this carries only the resulting public URL + display
 * metadata. The service additionally verifies `url` belongs to our CDN under
 * `chat_attachments/<senderId>/` so a client can't attach an arbitrary URL.
 */
export class ChatAttachmentDto {
  @IsString()
  @MaxLength(2048)
  url: string;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(255)
  content_type: string;

  @IsInt()
  @Min(0)
  @Max(26_214_400) // 25 MiB
  size: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  height?: number;
}

/**
 * One @mention span inside a message. `user_id` is a member UUID, or the literal
 * `'everyone'` sentinel for an @everyone mention. `offset`/`length` point at the
 * "@Name" run inside the (trimmed) message content so the thread can render a
 * chip; validity of `user_id` is enforced at notify time, not here.
 */
export class ChatMentionDto {
  @IsString()
  @MaxLength(64)
  user_id: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsInt()
  @Min(0)
  offset: number;

  @IsInt()
  @Min(1)
  length: number;
}

/**
 * Project-scoped channel send. Either `room_id` (existing room) or `slug`
 * (defaults to 'general') must resolve to a channel inside the path's
 * projectId.
 */
export class SendChannelMessageDto {
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @ValidateIf((dto: SendChannelMessageDto) => !dto.room_id)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  // Optional: a message may carry attachments only (no text). The service
  // requires non-empty content OR at least one attachment.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  attachments?: ChatAttachmentDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatMentionDto)
  mentions?: ChatMentionDto[];
}

/**
 * Global DM send. Either `room_id` (existing DM room) or `recipient_id`
 * (a user to start/continue a DM with) must be provided.
 */
export class SendDmMessageDto {
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @ValidateIf((dto: SendDmMessageDto) => !dto.room_id)
  @IsUUID()
  recipient_id?: string;

  // Optional: see SendChannelMessageDto — content OR attachments is required.
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  attachments?: ChatAttachmentDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatMentionDto)
  mentions?: ChatMentionDto[];
}

export class ToggleChatReactionDto {
  @IsString()
  @MaxLength(32)
  emoji: string;
}

/** Search a room's messages (word + fuzzy). */
export class SearchMessagesQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** Create a new (user-defined) channel in a project. */
export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsBoolean()
  is_private?: boolean;
}

/** Rename, archive, and/or change the visibility of a channel. */
export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  is_archived?: boolean;

  @IsOptional()
  @IsBoolean()
  is_private?: boolean;
}

/** Add a project member to a private channel. */
export class ChannelMemberDto {
  @IsUUID()
  user_id: string;
}

/** Pagination for the project activity timeline. */
export class ActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
