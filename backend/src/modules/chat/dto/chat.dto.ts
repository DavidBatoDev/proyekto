import {
  IsIn,
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

export class SendChatMessageDto {
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @ValidateIf((dto: SendChatMessageDto) => !dto.room_id)
  @IsIn(['dm', 'channel'])
  kind?: 'dm' | 'channel';

  @ValidateIf(
    (dto: SendChatMessageDto) => !dto.room_id && dto.kind === 'dm',
  )
  @IsUUID()
  recipient_id?: string;

  @ValidateIf(
    (dto: SendChatMessageDto) => !dto.room_id && dto.kind === 'channel',
  )
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsString()
  @MaxLength(4000)
  content: string;
}
