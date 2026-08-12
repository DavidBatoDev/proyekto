import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';

// Controllers
import { RoadmapsController } from './controllers/roadmaps.controller';
import { MilestonesController } from './controllers/milestones.controller';
import { EpicsController } from './controllers/epics.controller';
import { FeaturesController } from './controllers/features.controller';
import { TasksController } from './controllers/tasks.controller';
import { TaskExtrasController } from './controllers/task-extras.controller';
import { RoadmapPatchController } from './controllers/roadmap-patch.controller';
import { RoadmapAiController } from './controllers/roadmap-ai.controller';
import { RoadmapAiSessionsController } from './controllers/roadmap-ai-sessions.controller';

// Services & tokens
import {
  RoadmapsService,
  ROADMAPS_REPOSITORY,
} from './services/roadmaps.service';
import {
  MilestonesService,
  MILESTONES_REPOSITORY,
} from './services/milestones.service';
import { EpicsService, EPICS_REPOSITORY } from './services/epics.service';
import {
  FeaturesService,
  FEATURES_REPOSITORY,
} from './services/features.service';
import { TasksService, TASKS_REPOSITORY } from './services/tasks.service';
import {
  TaskExtrasService,
  TASK_EXTRAS_REPOSITORY,
} from './services/task-extras.service';
import {
  RoadmapPatchService,
  ROADMAP_PATCH_REPOSITORY,
} from './services/roadmap-patch.service';
import { RoadmapAiService } from './services/roadmap-ai.service';
import { RoadmapAiPreviewStoreService } from './services/roadmap-ai-preview-store.service';
import { RoadmapAiSessionsService } from './services/roadmap-ai-sessions.service';
import { RoadmapAiKnowledgeService } from './services/roadmap-ai-knowledge.service';
import { RoadmapAiMemoriesService } from './services/roadmap-ai-memories.service';
import { RoadmapAiProjectContextService } from './services/roadmap-ai-project-context.service';
import { RoadmapAiTitleGeneratorService } from './services/roadmap-ai-title-generator.service';
import { RoadmapMetadataGeneratorService } from './services/roadmap-metadata-generator.service';

// Repository implementations
import { RoadmapsRepositorySupabase } from './repositories/roadmaps.repository.supabase';
import { MilestonesRepositorySupabase } from './repositories/milestones.repository.supabase';
import { EpicsRepositorySupabase } from './repositories/epics.repository.supabase';
import { FeaturesRepositorySupabase } from './repositories/features.repository.supabase';
import { TasksRepositorySupabase } from './repositories/tasks.repository.supabase';
import { TaskExtrasRepositorySupabase } from './repositories/task-extras.repository.supabase';
import { RoadmapPatchRepositorySupabase } from './repositories/roadmap-patch.repository.supabase';
import { RoadmapJsonPatchProcessor } from './patch/roadmap-json-patch.processor';
import { RoadmapAuthorizationService } from './services/roadmap-authorization.service';
import { RoadmapMentionInviteService } from './services/roadmap-mention-invite.service';
import { RoadmapActivityService } from './services/roadmap-activity.service';
import { RoadmapWriteEffects } from './services/roadmap-write-effects.service';
import { FeatureStatusSyncService } from './services/derive-feature-status';

@Module({
  imports: [ProjectsModule, NotificationsModule],
  controllers: [
    RoadmapsController,
    MilestonesController,
    EpicsController,
    FeaturesController,
    TasksController,
    TaskExtrasController,
    RoadmapPatchController,
    RoadmapAiController,
    RoadmapAiSessionsController,
  ],
  providers: [
    RoadmapsService,
    { provide: ROADMAPS_REPOSITORY, useClass: RoadmapsRepositorySupabase },
    RoadmapAiService,
    RoadmapAiPreviewStoreService,
    RoadmapAiSessionsService,
    RoadmapAiKnowledgeService,
    RoadmapAiMemoriesService,
    RoadmapAiProjectContextService,
    RoadmapAiTitleGeneratorService,
    RoadmapMetadataGeneratorService,
    RoadmapPatchService,
    {
      provide: ROADMAP_PATCH_REPOSITORY,
      useClass: RoadmapPatchRepositorySupabase,
    },
    RoadmapJsonPatchProcessor,
    RoadmapAuthorizationService,
    RoadmapMentionInviteService,
    RoadmapActivityService,
    RoadmapWriteEffects,
    MilestonesService,
    { provide: MILESTONES_REPOSITORY, useClass: MilestonesRepositorySupabase },
    EpicsService,
    { provide: EPICS_REPOSITORY, useClass: EpicsRepositorySupabase },
    FeaturesService,
    { provide: FEATURES_REPOSITORY, useClass: FeaturesRepositorySupabase },
    TasksService,
    { provide: TASKS_REPOSITORY, useClass: TasksRepositorySupabase },
    TaskExtrasService,
    { provide: TASK_EXTRAS_REPOSITORY, useClass: TaskExtrasRepositorySupabase },
    FeatureStatusSyncService,
  ],
  exports: [
    RoadmapAuthorizationService,
    // Consumed by RoadmapSharesModule so share links authorize and log through
    // the same seam as every other roadmap write.
    RoadmapActivityService,
    // Read + write surface services reused in-process by the MCP module. All
    // carry their own authorization (view for reads, edit/assign/comment for
    // writes).
    RoadmapsService,
    RoadmapAiService,
    RoadmapAiProjectContextService,
    RoadmapAiKnowledgeService,
    TasksService,
    TaskExtrasService,
    // Epic/feature comment writes (MCP `epic_comment_add` / `feature_comment_add`).
    EpicsService,
    FeaturesService,
    // Owner-only AI thread reads (MCP `ai-sessions:read`).
    RoadmapAiSessionsService,
  ],
})
export class RoadmapsModule {}
