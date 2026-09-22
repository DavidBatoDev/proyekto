import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CACHE_POLICY_PRESETS } from '../../../../common/cache/cache-policy';
import { SetCachePolicy } from '../../../../common/decorators/cache-policy.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../../../common/guards/admin.guard';
import { SuperAdminGuard } from '../../../../common/guards/super-admin.guard';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  AdminWorkspacesQueryDto,
  ClearWorkspaceCompDto,
  SetWorkspaceCompDto,
} from '../dto/entitlements.dto';
import {
  EntitlementsAdminService,
  type AdminWorkspaceDetail,
  type AdminWorkspacePage,
  type AdminWorkspaceRow,
} from '../services/entitlements-admin.service';

/**
 * Staff view of every workspace's plan and usage, and complimentary plans.
 * Reads for any active admin; granting or revoking a comp gives revenue away,
 * so those need a super admin.
 */
@UseGuards(SupabaseAuthGuard, AdminGuard)
@SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
@Controller('admin/workspaces')
export class AdminWorkspacesController {
  constructor(private readonly admin: EntitlementsAdminService) {}

  @Get()
  list(@Query() query: AdminWorkspacesQueryDto): Promise<AdminWorkspacePage> {
    return this.admin.listWorkspaces(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminWorkspaceDetail> {
    return this.admin.getWorkspace(id);
  }

  @Put(':id/comp')
  @UseGuards(SuperAdminGuard)
  setComp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWorkspaceCompDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ workspace: AdminWorkspaceRow; warnings: string[] }> {
    return this.admin.setComp(id, dto, user.id);
  }

  /** The note may come in the body or as ?note=; the body wins. */
  @Delete(':id/comp')
  @UseGuards(SuperAdminGuard)
  clearComp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ClearWorkspaceCompDto,
    @Query() query: ClearWorkspaceCompDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ workspace: AdminWorkspaceRow }> {
    return this.admin.clearComp(id, body?.note ?? query?.note, user.id);
  }
}
