import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { PushModule } from '../push/push.module';
import { NotificationEmailWorkerService } from './email/notification-email-worker.service';
import { NotificationPreferencesService } from './email/notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// MailerService comes from the @Global() MailModule, so there is nothing to
// import for it here.
@Module({
  imports: [SupabaseModule, PushModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationEmailWorkerService,
    NotificationPreferencesService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
