import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectTimeController } from './project-time.controller';
import {
  ProjectTimeService,
  PROJECT_TIME_REPOSITORY,
} from './project-time.service';
import { ProjectTimeRepositorySupabase } from './repositories/project-time.repository.supabase';

@Module({
  imports: [ProjectsModule],
  controllers: [ProjectTimeController],
  providers: [
    ProjectTimeService,
    {
      provide: PROJECT_TIME_REPOSITORY,
      useClass: ProjectTimeRepositorySupabase,
    },
  ],
})
export class ProjectTimeModule {}
