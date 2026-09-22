import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../execution/workspaces/workspaces.module';
import { AdminPlanLimitsController } from './controllers/admin-plan-limits.controller';
import { AdminWorkspacesController } from './controllers/admin-workspaces.controller';
import { PlansController } from './controllers/plans.controller';
import { WorkspaceUsageController } from './controllers/workspace-usage.controller';
import { EntitlementsCoreModule } from './entitlements-core.module';
import { ENTITLEMENTS_ADMIN_REPOSITORY } from './repositories/entitlements-admin.repository.interface';
import { SupabaseEntitlementsAdminRepository } from './repositories/entitlements-admin.repository.supabase';
import { WORKSPACE_USAGE_REPOSITORY } from './repositories/workspace-usage.repository.interface';
import { SupabaseWorkspaceUsageRepository } from './repositories/workspace-usage.repository.supabase';
import { EntitlementsAdminService } from './services/entitlements-admin.service';
import { WorkspaceUsageService } from './services/workspace-usage.service';

/**
 * The HTTP half of entitlements: /api/plans, workspace usage, and the staff
 * limits and complimentary-plan editors.
 *
 * A leaf: nothing imports it. Feature modules that enforce limits import
 * EntitlementsCoreModule instead, so this one can depend on WorkspacesModule
 * for the membership checks without a cycle.
 *
 *   EntitlementsModule -> WorkspacesModule -> EntitlementsCoreModule
 *   EntitlementsModule -> EntitlementsCoreModule
 */
@Module({
  imports: [EntitlementsCoreModule, WorkspacesModule],
  controllers: [
    PlansController,
    WorkspaceUsageController,
    AdminPlanLimitsController,
    AdminWorkspacesController,
  ],
  providers: [
    EntitlementsAdminService,
    WorkspaceUsageService,
    {
      provide: ENTITLEMENTS_ADMIN_REPOSITORY,
      useClass: SupabaseEntitlementsAdminRepository,
    },
    {
      provide: WORKSPACE_USAGE_REPOSITORY,
      useClass: SupabaseWorkspaceUsageRepository,
    },
  ],
})
export class EntitlementsModule {}
