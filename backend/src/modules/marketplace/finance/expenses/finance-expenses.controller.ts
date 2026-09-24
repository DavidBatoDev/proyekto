import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  CreateFinanceExpenseDto,
  ListFinanceExpensesQueryDto,
  UpdateFinanceExpenseDto,
} from './dto/finance-expenses.dto';
import { FinanceExpensesService } from './finance-expenses.service';

/**
 * Team expenses. Like the finance-books surface, deliberately without
 * ConsultantOnlyGuard: authorization is the caller's role on the team's F2
 * book, resolved in `FinanceExpensesService`.
 */
@Controller('finance-expenses')
@UseGuards(SupabaseAuthGuard)
export class FinanceExpensesController {
  constructor(private readonly expenses: FinanceExpensesService) {}

  @Get('teams/:teamId')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Query() query: ListFinanceExpensesQueryDto,
  ) {
    return this.expenses.list(user.id, teamId, query);
  }

  @Post('teams/:teamId')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() body: CreateFinanceExpenseDto,
  ) {
    return this.expenses.create(user.id, teamId, body);
  }

  @Patch(':expenseId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() body: UpdateFinanceExpenseDto,
  ) {
    return this.expenses.update(user.id, expenseId, body);
  }

  @Post(':expenseId/void')
  void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return this.expenses.void(user.id, expenseId);
  }
}
