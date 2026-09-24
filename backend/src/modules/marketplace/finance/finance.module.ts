import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../execution/projects/authorization/authorization.module';
import { FinanceBookAccessService } from './books/finance-book-access.service';
import { FinanceBookMembersController } from './books/finance-book-members.controller';
import { FinanceBookMembersService } from './books/finance-book-members.service';
import { FinanceBooksController } from './books/finance-books.controller';
import { FinanceBooksService } from './books/finance-books.service';
import { FinanceInvitesController } from './books/finance-invites.controller';
import { FinanceInvitesService } from './books/finance-invites.service';
import { ConsultantFinanceAccessService } from './consultant-finance-access.service';
import { FinanceExpensesController } from './expenses/finance-expenses.controller';
import { FinanceExpensesService } from './expenses/finance-expenses.service';
import { FinanceExportController } from './exports/finance-export.controller';
import { FinanceExportService } from './exports/finance-export.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { TeamFinanceAccessService } from './team-finance-access.service';
import { TeamFinanceController } from './team-finance.controller';
import { TeamFinanceService } from './team-finance.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [
    FinanceController,
    TeamFinanceController,
    FinanceBooksController,
    FinanceBookMembersController,
    FinanceInvitesController,
    FinanceExportController,
    FinanceExpensesController,
  ],
  providers: [
    ConsultantFinanceAccessService,
    FinanceService,
    TeamFinanceAccessService,
    TeamFinanceService,
    FinanceBookAccessService,
    FinanceBooksService,
    FinanceBookMembersService,
    FinanceInvitesService,
    FinanceExportService,
    FinanceExpensesService,
  ],
  exports: [
    FinanceBooksService,
    ConsultantFinanceAccessService,
    TeamFinanceAccessService,
    FinanceBookAccessService,
  ],
})
export class FinanceModule {}
