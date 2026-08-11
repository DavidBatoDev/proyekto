import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SupabaseAdminRepository } from './repositories/admin.repository.supabase';
import { ADMIN_REPOSITORY } from './admin.service';
import { TeamsModule } from '../../execution/teams/teams.module';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TeamsModule, AuthorizationModule, NotificationsModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    { provide: ADMIN_REPOSITORY, useClass: SupabaseAdminRepository },
  ],
})
export class AdminModule {}
