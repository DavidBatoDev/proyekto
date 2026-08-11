import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeamTimeController } from './team-time.controller';
import { TeamTimeService } from './team-time.service';

@Module({
  imports: [SupabaseModule, AuthorizationModule, NotificationsModule],
  controllers: [TeamTimeController],
  providers: [TeamTimeService],
  exports: [TeamTimeService],
})
export class TeamTimeModule {}
