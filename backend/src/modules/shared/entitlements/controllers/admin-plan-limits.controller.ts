import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CACHE_POLICY_PRESETS } from '../../../../common/cache/cache-policy';
import { SetCachePolicy } from '../../../../common/decorators/cache-policy.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../../common/guards/admin.guard';
import { SuperAdminGuard } from '../../../../common/guards/super-admin.guard';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { UpdatePlanLimitsDto } from '../dto/entitlements.dto';
import {
  EntitlementsAdminService,
  type AdminPlanLimits,
} from '../services/entitlements-admin.service';

/**
 * The staff limits editor. Any active admin may read it; only a super admin
 * may save, because a save changes what every customer gets.
 */
@UseGuards(SupabaseAuthGuard, AdminGuard)
@SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
@Controller('admin/plan-limits')
export class AdminPlanLimitsController {
  constructor(private readonly admin: EntitlementsAdminService) {}

  @Get()
  get(): Promise<AdminPlanLimits> {
    return this.admin.getPlanLimits();
  }

  @Put()
  @UseGuards(SuperAdminGuard)
  update(
    @Body() dto: UpdatePlanLimitsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminPlanLimits & { warnings: string[] }> {
    return this.admin.updatePlanLimits(dto, user.id);
  }
}
