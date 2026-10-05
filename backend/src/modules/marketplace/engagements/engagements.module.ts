import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { ProjectsModule } from '../../execution/projects/projects.module';
import { TeamsModule } from '../../execution/teams/teams.module';
import { TimeModule } from '../../execution/time/time.module';
import { FinanceModule } from '../finance/finance.module';
import { EngagementAssignmentsService } from './engagement-assignments.service';
import { EngagementProjectService } from './engagement-project.service';
import { EngagementsController } from './engagements.controller';
import { EngagementsCoreModule } from './engagements-core.module';

/**
 * The engagement routes: party-scoped reads, the project step and
 * assignments. EngagementsService (the reads) lives in EngagementsCoreModule,
 * which TimeModule imports directly (D25), so this module re-exports it
 * instead of providing a second instance. TimeModule never imports this
 * module, so importing TimeModule here is not a cycle.
 */
@Module({
  imports: [
    SupabaseModule,
    EngagementsCoreModule,
    TimeModule,
    AuthorizationModule,
    ProjectsModule,
    TeamsModule,
    FinanceModule,
  ],
  controllers: [EngagementsController],
  providers: [EngagementProjectService, EngagementAssignmentsService],
  exports: [EngagementsCoreModule],
})
export class EngagementsModule {}
