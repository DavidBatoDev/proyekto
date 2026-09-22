import { Module } from '@nestjs/common';
import { RoadmapPlanLimitsModule } from '../../execution/roadmaps/roadmap-plan-limits.module';
import { RoadmapTemplatesController } from './roadmap-templates.controller';
import { RoadmapTemplatesService } from './roadmap-templates.service';

@Module({
  // The per-roadmap node limit an instantiation must fit (entitlements core only).
  imports: [RoadmapPlanLimitsModule],
  controllers: [RoadmapTemplatesController],
  providers: [RoadmapTemplatesService],
  exports: [RoadmapTemplatesService],
})
export class RoadmapTemplatesModule {}
