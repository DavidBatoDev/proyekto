import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { AuthorizationModule } from '../projects/authorization/authorization.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

/**
 * The READ side of the project activity log. AuditService (in AuditModule)
 * owns writes; nothing here writes.
 *
 * Imports AuthorizationModule rather than ProjectsModule on purpose:
 * ProjectAuthorizationService.assertPermission is the whole dependency, and
 * ProjectsService.assertProjectPermission would add a getProjectOrThrow query
 * and turn a non-member's 403 into a 404.
 */
@Module({
  imports: [SupabaseModule, AuthorizationModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
