import { Module } from '@nestjs/common';
import { EntitlementsCoreModule } from '../../shared/entitlements/entitlements-core.module';
import { RoadmapPlanLimitsService } from './services/roadmap-plan-limits.service';

/**
 * The per-roadmap node limit and history retention, on their own so a module
 * outside RoadmapsModule (roadmap templates) can check a roadmap write without
 * importing the whole roadmap surface. Depends only on the entitlements core.
 */
@Module({
  imports: [EntitlementsCoreModule],
  providers: [RoadmapPlanLimitsService],
  exports: [RoadmapPlanLimitsService],
})
export class RoadmapPlanLimitsModule {}
