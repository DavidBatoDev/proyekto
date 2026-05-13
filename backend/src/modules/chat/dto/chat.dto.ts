import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
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
