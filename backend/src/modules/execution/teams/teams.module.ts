import { Module, forwardRef } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectAccessSyncModule } from '../projects/access-sync/access-sync.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { ProjectTeamsService } from './project-teams.service';
import { ProjectTeamsController } from './project-teams.controller';
import { TeamMemberRatesService } from './team-member-rates.service';
import { TeamMemberRatesController } from './team-member-rates.controller';
import { TeamResourcesService } from './team-resources.service';
import { TeamResourcesController } from './team-resources.controller';
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
    WorkspacesModule,
  ],
  controllers: [
    TeamsController,
    ProjectTeamsController,
    TeamMemberRatesController,
    TeamResourcesController,
    ProjectTeamInvitesController,
    MyProjectTeamInvitesController,
  ],
  providers: [
    TeamsService,
    ProjectTeamsService,
    TeamMemberRatesService,
    TeamResourcesService,
    ProjectTeamInvitesService,
  ],
  exports: [
    TeamsService,
    ProjectTeamsService,
    TeamMemberRatesService,
    TeamResourcesService,
    ProjectTeamInvitesService,
  ],
})
export class TeamsModule {}
