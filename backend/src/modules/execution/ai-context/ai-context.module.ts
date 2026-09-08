import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { TeamsModule } from '../teams/teams.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AiContextController } from './ai-context.controller';
import { AiContextThrottlerGuard } from './guards/ai-context-throttler.guard';
import { AI_CONTEXT_REPOSITORY } from './repositories/ai-context.repository.interface';
import { AiContextRepositorySupabase } from './repositories/ai-context.repository.supabase';
import { AiContextService } from './services/ai-context.service';
import { AiContextKnowledgeService } from './services/ai-context-knowledge.service';
import { AiContextProjectService } from './services/ai-context-project.service';
import { AiContextRefsService } from './services/ai-context-refs.service';

/**
 * User-scoped AI context (`/ai/context/*`). Leans on the exported seams of the
 * modules it reads across - `ROADMAPS_REPOSITORY` + `RoadmapAuthorizationService`
 * + `RoadmapAiProjectContextService` (roadmaps), `ProjectsService`,
 * `WorkspacesService`, `TeamsService` - and on the global `KnowledgeModule`,
 * `RedisModule` and `SupabaseModule`.
 *
 * `AiContextService` is exported for the MCP module's cross-roadmap read tools,
 * which answer the same questions for an external host as the in-app assistant
 * does - one reader, one set of authorization and paging rules. The chain stays
 * acyclic because nothing imports `McpModule` except `AppModule`.
 */
@Module({
  imports: [RoadmapsModule, ProjectsModule, WorkspacesModule, TeamsModule],
  controllers: [AiContextController],
  providers: [
    AiContextThrottlerGuard,
    AiContextService,
    AiContextRefsService,
    AiContextKnowledgeService,
    AiContextProjectService,
    { provide: AI_CONTEXT_REPOSITORY, useClass: AiContextRepositorySupabase },
  ],
  exports: [AiContextService],
})
export class AiContextModule {}
