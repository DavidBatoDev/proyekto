import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class NotificationsQueryDto {
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  is_read?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class MarkNotificationReadDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  is_read?: 'true' | 'false';
}

export class CreateNotificationDto {
  @IsUUID()
  user_id: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsString()
  type_name: string;

  @IsOptional()
  @IsUUID()
  actor_id?: string;

  @IsOptional()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  link_url?: string;
}
