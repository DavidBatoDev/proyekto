import { Module, forwardRef } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SupabaseProjectsRepository } from './repositories/projects.repository.supabase';
import { PROJECTS_REPOSITORY } from './projects.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PersonalWorkspaceService } from './personal-workspace.service';
import { ProjectAuthorizationService } from './authorization/project-authorization.service';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [NotificationsModule, forwardRef(() => TeamsModule)],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    PersonalWorkspaceService,
    ProjectAuthorizationService,
    { provide: PROJECTS_REPOSITORY, useClass: SupabaseProjectsRepository },
  ],
  exports: [
    ProjectsService,
    PersonalWorkspaceService,
    ProjectAuthorizationService,
  ],
})
export class ProjectsModule {}
