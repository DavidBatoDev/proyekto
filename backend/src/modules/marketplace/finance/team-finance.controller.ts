import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  FinanceContractsQueryDto,
  FinanceFiltersDto,
  FinanceInvoicesQueryDto,
} from './dto/finance.dto';
import { TeamFinanceService } from './team-finance.service';

/**
 * Team finance — deliberately WITHOUT ConsultantOnlyGuard.
 *
 * The consultant gate on `finance.controller.ts` protects the consultant's
 * personal book of business. This surface is the team administrator's, and a
 * project admin may run it without ever being a marketplace consultant;
 * authorization is team role + per-project `finance.*` capability, asserted in
 * `TeamFinanceAccessService` (the same shape as project-economics, the other
 * admin-gated money surface).
 */
@Controller('team-finance')
@UseGuards(SupabaseAuthGuard)
export class TeamFinanceController {
  constructor(private readonly teamFinance: TeamFinanceService) {}

  @Get('teams')
  listTeams(@CurrentUser() user: AuthenticatedUser) {
    return this.teamFinance.listTeams(user.id);
  }

  @Get('teams/:teamId/portfolio')
  getPortfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Query() query: FinanceFiltersDto,
  ) {
    return this.teamFinance.getPortfolio(user.id, teamId, query);
  }

  @Get('teams/:teamId/contracts')
  listContracts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Query() query: FinanceContractsQueryDto,
  ) {
    return this.teamFinance.listContracts(user.id, teamId, query);
  }

  @Get('teams/:teamId/invoices')
  listInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Query() query: FinanceInvoicesQueryDto,
  ) {
    return this.teamFinance.listInvoices(user.id, teamId, query);
  }
}
