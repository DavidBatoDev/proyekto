import { Module, forwardRef } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SupabaseProjectsRepository } from './repositories/projects.repository.supabase';
import { PROJECTS_REPOSITORY } from './projects.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PersonalWorkspaceService } from './personal-workspace.service';
import { AuthorizationModule } from './authorization/authorization.module';
import { ProjectAccessSyncModule } from './access-sync/access-sync.module';
import { TeamsModule } from '../teams/teams.module';
import { ChatModule } from '../chat/chat.module';
import { ContractsModule } from '../contracts/contracts.module';
import { TeamTimeModule } from '../team-time/team-time.module';

@Module({
  imports: [
    NotificationsModule,
    ProjectAccessSyncModule,
    AuthorizationModule,
    forwardRef(() => TeamsModule),
    ChatModule,
    // ContractsModule depends only on AuthorizationModule, so this direction is
    // acyclic — ProjectsService can use the activation gate without a forwardRef.
    ContractsModule,
    TeamTimeModule,
  ],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    PersonalWorkspaceService,
    { provide: PROJECTS_REPOSITORY, useClass: SupabaseProjectsRepository },
  ],
  exports: [
    ProjectsService,
    PersonalWorkspaceService,
    AuthorizationModule,
    ProjectAccessSyncModule,
  ],
})
export class ProjectsModule {}
