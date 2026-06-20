import {
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

  @IsString()
  @MaxLength(4000)
  content: string;
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

  @IsString()
  @MaxLength(4000)
  content: string;
}

export class ToggleChatReactionDto {
  @IsString()
  @MaxLength(32)
  emoji: string;
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

/** Rename and/or archive a channel. */
export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  is_archived?: boolean;
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
