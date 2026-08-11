import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ConsultantOnlyGuard } from '../../../common/guards/consultant-only.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  FinanceContractsQueryDto,
  FinanceFiltersDto,
  FinanceInvoicesQueryDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

@Controller('finance')
@UseGuards(SupabaseAuthGuard, ConsultantOnlyGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('portfolio')
  getPortfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceFiltersDto,
  ) {
    return this.finance.getPortfolio(user.id, query);
  }

  @Get('contracts')
  listContracts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceContractsQueryDto,
  ) {
    return this.finance.listContracts(user.id, query);
  }

  @Get('invoices')
  listInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FinanceInvoicesQueryDto,
  ) {
    return this.finance.listInvoices(user.id, query);
  }
}
