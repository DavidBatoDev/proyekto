import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * The unsubscribe route deliberately does NOT bind the request body: mail
 * clients POST `List-Unsubscribe=One-Click` as urlencoded form data, and the
 * global ValidationPipe's `forbidNonWhitelisted` would reject the undeclared
 * field. See NotificationsController.unsubscribe.
 */

export class UnsubscribeQueryDto {
  @IsString()
  @MaxLength(128)
  token: string;

  /**
   * Which subscription to drop: a notification type name, or `all`. Absent is
   * treated as `all`, because a client that mangles the query string should
   * still honour the user's intent to stop receiving mail.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  scope?: string;
}

export class NotificationTypePreferenceDto {
  @IsString()
  @MaxLength(64)
  type_name: string;

  @IsBoolean()
  email_enabled: boolean;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  all_email_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationTypePreferenceDto)
  types?: NotificationTypePreferenceDto[];
}
