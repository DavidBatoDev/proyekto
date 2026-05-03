import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SupabaseProjectsRepository } from './repositories/projects.repository.supabase';
import { PROJECTS_REPOSITORY } from './projects.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PersonalWorkspaceService } from './personal-workspace.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    PersonalWorkspaceService,
    { provide: PROJECTS_REPOSITORY, useClass: SupabaseProjectsRepository },
  ],
  exports: [ProjectsService, PersonalWorkspaceService],
})
export class ProjectsModule {}
