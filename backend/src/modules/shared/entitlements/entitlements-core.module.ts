import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { EntitlementsService } from './entitlements.service';
import { ENTITLEMENTS_REPOSITORY } from './repositories/entitlements.repository.interface';
import { SupabaseEntitlementsRepository } from './repositories/entitlements.repository.supabase';

/**
 * The half of entitlements that feature modules may import.
 *
 * It depends only on Supabase (and the @Global Redis cache), never on a
 * feature module, so WorkspacesModule, ProjectsModule, RoadmapsModule,
 * PlatformBillingModule and the rest can all import it without a cycle. The
 * HTTP surface (/api/plans, workspace usage, the admin editor) lives in
 * EntitlementsModule, which imports this and WorkspacesModule, the same split
 * as PlatformBillingCoreModule / PlatformBillingModule.
 *
 *   EntitlementsModule -> WorkspacesModule -> EntitlementsCoreModule
 */
@Module({
  imports: [SupabaseModule],
  providers: [
    EntitlementsService,
    {
      provide: ENTITLEMENTS_REPOSITORY,
      useClass: SupabaseEntitlementsRepository,
    },
  ],
  exports: [EntitlementsService, ENTITLEMENTS_REPOSITORY],
})
export class EntitlementsCoreModule {}
