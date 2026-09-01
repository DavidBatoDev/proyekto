import { IsIn } from 'class-validator';
import type { ChatNotificationLevel } from '../repositories/chat.repository.interface';

/**
 * Every field a client may send must be declared: the global ValidationPipe runs
 * whitelist + forbidNonWhitelisted, so an undeclared field is a 400.
 */
export class UpdateRoomNotificationLevelDto {
  @IsIn(['all', 'mentions', 'none'])
  level: ChatNotificationLevel;
}
