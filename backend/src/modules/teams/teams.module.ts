import { Module, forwardRef } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectAccessSyncModule } from '../projects/access-sync/access-sync.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { ProjectTeamsService } from './project-teams.service';
import { ProjectTeamsController } from './project-teams.controller';
import { TeamMemberRatesService } from './team-member-rates.service';
import { TeamMemberRatesController } from './team-member-rates.controller';

@Module({
  imports: [
    SupabaseModule,
    forwardRef(() => ProjectsModule),
    ProjectAccessSyncModule,
    NotificationsModule,
  ],
  controllers: [
    TeamsController,
    ProjectTeamsController,
    TeamMemberRatesController,
  ],
  providers: [TeamsService, ProjectTeamsService, TeamMemberRatesService],
  exports: [TeamsService, ProjectTeamsService, TeamMemberRatesService],
})
export class TeamsModule {}
