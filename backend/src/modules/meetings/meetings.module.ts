import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService, MEETINGS_REPOSITORY } from './meetings.service';
import { SupabaseMeetingsRepository } from './repositories/meetings.repository.supabase';
import { CronSecretGuard } from '../../common/guards/cron-secret.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { GoogleController } from './google/google.controller';
import { GoogleOAuthService } from './google/google-oauth.service';
import { GoogleCalendarService } from './google/google-calendar.service';

@Module({
  imports: [NotificationsModule, AuthorizationModule],
  controllers: [MeetingsController, GoogleController],
  providers: [
    MeetingsService,
    CronSecretGuard,
    GoogleOAuthService,
    GoogleCalendarService,
    {
      provide: MEETINGS_REPOSITORY,
      useClass: SupabaseMeetingsRepository,
    },
  ],
})
export class MeetingsModule {}
