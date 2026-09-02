import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * The organization tier. Imports nothing from teams or projects — they import
 * this — so there is no cycle to break with forwardRef.
 */
@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
