import { Module, forwardRef } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectAccessSyncModule } from '../projects/access-sync/access-sync.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { ProjectTeamsService } from './project-teams.service';
import { ProjectTeamsController } from './project-teams.controller';
import { TeamMemberRatesService } from './team-member-rates.service';
import { TeamMemberRatesController } from './team-member-rates.controller';
import { ProjectTeamInvitesService } from './project-team-invites.service';
import {
  MyProjectTeamInvitesController,
  ProjectTeamInvitesController,
} from './project-team-invites.controller';

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
    ProjectTeamInvitesController,
    MyProjectTeamInvitesController,
  ],
  providers: [
    TeamsService,
    ProjectTeamsService,
    TeamMemberRatesService,
    ProjectTeamInvitesService,
  ],
  exports: [
    TeamsService,
    ProjectTeamsService,
    TeamMemberRatesService,
    ProjectTeamInvitesService,
  ],
})
export class TeamsModule {}
