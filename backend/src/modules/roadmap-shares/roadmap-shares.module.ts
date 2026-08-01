import { Module } from '@nestjs/common';
import { RoadmapSharesController } from './roadmap-shares.controller';
import {
  RoadmapSharesService,
  ROADMAP_SHARES_REPOSITORY,
} from './roadmap-shares.service';
import { RoadmapSharesRepositorySupabase } from './repositories/roadmap-shares.repository.supabase';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';

@Module({
  // For RoadmapAuthorizationService (share links are a roadmap-scoped
  // capability) and RoadmapActivityService (share create/revoke are
  // sensitive activity-log events).
  imports: [RoadmapsModule],
  controllers: [RoadmapSharesController],
  providers: [
    RoadmapSharesService,
    {
      provide: ROADMAP_SHARES_REPOSITORY,
      useClass: RoadmapSharesRepositorySupabase,
    },
  ],
})
export class RoadmapSharesModule {}
