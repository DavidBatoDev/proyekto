import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CACHE_POLICY_PRESETS } from '../../../../common/cache/cache-policy';
import { SetCachePolicy } from '../../../../common/decorators/cache-policy.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  WorkspaceUsageService,
  type WorkspaceUsage,
} from '../services/workspace-usage.service';

/** Any member may read it; the service narrows the billing and roadmap detail. */
@UseGuards(SupabaseAuthGuard)
@SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
@Controller('workspaces/:workspaceId/usage')
export class WorkspaceUsageController {
  constructor(private readonly usage: WorkspaceUsageService) {}

  @Get()
  getUsage(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceUsage> {
    return this.usage.getUsage(workspaceId, user.id);
  }
}
