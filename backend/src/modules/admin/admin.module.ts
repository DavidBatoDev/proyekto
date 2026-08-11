import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SupabaseAdminRepository } from './repositories/admin.repository.supabase';
import { ADMIN_REPOSITORY } from './admin.service';
import { TeamsModule } from '../teams/teams.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';

@Module({
  imports: [TeamsModule, AuthorizationModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    { provide: ADMIN_REPOSITORY, useClass: SupabaseAdminRepository },
  ],
})
export class AdminModule {}
