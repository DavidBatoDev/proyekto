import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../config/supabase.module';
import { ProjectsModule } from '../projects/projects.module';
import { TeamTimeController } from './team-time.controller';
import { TeamTimeService } from './team-time.service';

@Module({
  imports: [SupabaseModule, ProjectsModule],
  controllers: [TeamTimeController],
  providers: [TeamTimeService],
  exports: [TeamTimeService],
})
export class TeamTimeModule {}
