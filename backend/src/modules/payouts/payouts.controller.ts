import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { PayoutsService } from './payouts.service';
import {
  CreatePayoutDto,
  CreatePayoutMethodDto,
  UpdatePayoutMethodDto,
} from './dto/payouts.dto';

@UseGuards(SupabaseAuthGuard)
@Controller()
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  // ─── payout methods (owner-scoped) ───────────────────────────────────

  @Get('payout-methods')
  listMyMethods(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMyMethods(user.id);
  }

  @Post('payout-methods')
  createMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayoutMethodDto,
  ) {
    return this.service.createMethod(user.id, dto);
  }

  @Patch('payout-methods/:id')
  updateMethod(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePayoutMethodDto,
  ) {
    return this.service.updateMethod(user.id, id, dto);
  }

  @Delete('payout-methods/:id')
  deleteMethod(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteMethod(user.id, id);
  }

  @Post('payout-methods/:id/default')
  setDefault(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setDefaultMethod(user.id, id);
  }

  // ─── payouts ──────────────────────────────────────────────────────────

  @Get('payouts/teams/:teamId/members/:memberId/payout-methods')
  listMemberMethods(
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listMemberMethodsForPayer(user.id, teamId, memberId);
  }

  @Post('payouts')
  createPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayoutDto,
  ) {
    return this.service.createPayout(user.id, dto);
  }

  @Get('payouts/teams/:teamId')
  listTeamPayouts(
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('member_user_id') memberId?: string,
  ) {
    return this.service.listTeamPayouts(user.id, teamId, memberId);
  }

  @Get('payouts/:payoutId')
  getPayout(
    @Param('payoutId') payoutId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getPayout(user.id, payoutId);
  }

  @Get('payouts/:payoutId/proof-url')
  getProofUrl(
    @Param('payoutId') payoutId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getProofUrl(user.id, payoutId);
  }

  @Post('payouts/:payoutId/void')
  voidPayout(
    @Param('payoutId') payoutId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.voidPayout(user.id, payoutId);
  }
}
