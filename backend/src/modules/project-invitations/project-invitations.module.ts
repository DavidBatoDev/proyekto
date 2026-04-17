import { Module } from '@nestjs/common';
import { ProjectInvitationsController } from './project-invitations.controller';
import { ProjectInvitationsService } from './project-invitations.service';
import { ProjectInvitationsRepository } from './project-invitations.repository.supabase';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ProjectInvitationsController],
  providers: [ProjectInvitationsService, ProjectInvitationsRepository],
})
export class ProjectInvitationsModule {}
