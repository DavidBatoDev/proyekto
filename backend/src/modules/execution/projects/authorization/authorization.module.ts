import { Module } from '@nestjs/common';
import { ProjectAuthorizationService } from './project-authorization.service';

/**
 * Standalone home for ProjectAuthorizationService so it can be shared without
 * forcing a dependency on the whole ProjectsModule. ProjectsModule re-exports
 * this; ChatModule imports it directly (which avoids a ProjectsModule ⇄
 * ChatModule cycle once ProjectsService depends on ChatService for default
 * channel provisioning). The service only needs the global SUPABASE_ADMIN, so
 * this module has no imports.
 */
@Module({
  providers: [ProjectAuthorizationService],
  exports: [ProjectAuthorizationService],
})
export class AuthorizationModule {}
