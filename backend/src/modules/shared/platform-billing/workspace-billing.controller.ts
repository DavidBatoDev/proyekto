import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  CreateCheckoutSessionDto,
  CreatePortalSessionDto,
} from './dto/platform-billing.dto';
import { PlatformBillingService } from './platform-billing.service';

/**
 * Workspace billing. Mounted under the workspace so authorization is a
 * workspace question, exactly like members and invites.
 *
 * Note what is NOT here: there is no `PATCH { plan }`. The first purchase goes
 * through the provider's hosted checkout and every later change through its
 * customer portal, so the provider is the only writer of subscription state
 * and our row is always a projection of it. That removes an entire class of
 * "our API and the provider disagree" bug, and it is why UpdateWorkspaceDto gained no billing
 * field (which would have had to be classified against
 * WORKSPACE_OWNER_ONLY_UPDATE_FIELDS).
 */
@UseGuards(SupabaseAuthGuard)
@Controller('workspaces/:workspaceId/billing')
export class WorkspaceBillingController {
  constructor(private readonly billing: PlatformBillingService) {}

  /** Owner or admin: admins add members, so they must see what a seat costs. */
  @Get()
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.billing.getSummary(workspaceId, user.id);
  }

  /**
   * Owner only. An owner can promote anyone to admin in one request, so letting
   * admins attach a payment method would be a one-request escalation into
   * somebody's wallet.
   */
  @Post('checkout-session')
  createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.billing.createCheckoutSession(workspaceId, user.id, dto);
  }

  /** Owner only, for the same reason. */
  @Post('portal-session')
  createPortalSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreatePortalSessionDto,
  ) {
    return this.billing.createPortalSession(workspaceId, user.id, dto);
  }
}
