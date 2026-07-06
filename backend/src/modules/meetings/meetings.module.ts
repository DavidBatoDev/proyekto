import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService, MEETINGS_REPOSITORY } from './meetings.service';
import { SupabaseMeetingsRepository } from './repositories/meetings.repository.supabase';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';

@Module({
  imports: [NotificationsModule, AuthorizationModule],
  controllers: [MeetingsController],
  providers: [
    MeetingsService,
    {
      provide: MEETINGS_REPOSITORY,
      useClass: SupabaseMeetingsRepository,
    },
  ],
})
export class MeetingsModule {}
