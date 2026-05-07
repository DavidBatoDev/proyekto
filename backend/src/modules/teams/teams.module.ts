import { Module, forwardRef } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectAccessSyncModule } from '../projects/access-sync/access-sync.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { ProjectTeamsService } from './project-teams.service';
import { ProjectTeamsController } from './project-teams.controller';

@Module({
  imports: [
    SupabaseModule,
    forwardRef(() => ProjectsModule),
    ProjectAccessSyncModule,
    NotificationsModule,
  ],
  controllers: [TeamsController, ProjectTeamsController],
  providers: [TeamsService, ProjectTeamsService],
  exports: [TeamsService, ProjectTeamsService],
})
export class TeamsModule {}
