import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { ProjectAccessSyncService } from './access-sync.service';

/**
 * Yoke-rule provider — used by ProjectsModule and TeamsModule to
 * keep all `project_access` rows for a (project, user) pair in
 * lockstep on role + capabilities.
 */
@Module({
  imports: [SupabaseModule],
  providers: [ProjectAccessSyncService],
  exports: [ProjectAccessSyncService],
})
export class ProjectAccessSyncModule {}
