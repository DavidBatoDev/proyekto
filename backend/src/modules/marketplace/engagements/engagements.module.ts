import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { ProjectsModule } from '../../execution/projects/projects.module';
import { TeamsModule } from '../../execution/teams/teams.module';
import { FinanceModule } from '../finance/finance.module';
import { EngagementProjectService } from './engagement-project.service';
import { EngagementsController } from './engagements.controller';
import { EngagementsService } from './engagements.service';

@Module({
  imports: [SupabaseModule, ProjectsModule, TeamsModule, FinanceModule],
  controllers: [EngagementsController],
  providers: [EngagementsService, EngagementProjectService],
  exports: [EngagementsService],
})
export class EngagementsModule {}
