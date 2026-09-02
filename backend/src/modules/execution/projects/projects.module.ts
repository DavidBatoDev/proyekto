import { Module, forwardRef } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SupabaseProjectsRepository } from './repositories/projects.repository.supabase';
import { PROJECTS_REPOSITORY } from './projects.service';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { PersonalProjectService } from './personal-project.service';
import { AuthorizationModule } from './authorization/authorization.module';
import { ProjectAccessSyncModule } from './access-sync/access-sync.module';
import { TeamsModule } from '../teams/teams.module';
import { ChatModule } from '../chat/chat.module';
import { TeamTimeModule } from '../team-time/team-time.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [
    NotificationsModule,
    ProjectAccessSyncModule,
    AuthorizationModule,
    forwardRef(() => TeamsModule),
    ChatModule,
    TeamTimeModule,
    WorkspacesModule,
  ],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    PersonalProjectService,
    { provide: PROJECTS_REPOSITORY, useClass: SupabaseProjectsRepository },
  ],
  exports: [
    ProjectsService,
    PersonalProjectService,
    AuthorizationModule,
    ProjectAccessSyncModule,
  ],
})
export class ProjectsModule {}
