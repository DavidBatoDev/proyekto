import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  AddProjectBookDto,
  CreatePersonalBookDto,
  CreateTeamBookDto,
} from './dto/finance-books.dto';
import { FinanceBooksService } from './finance-books.service';

/**
 * Finance books — deliberately WITHOUT ConsultantOnlyGuard.
 *
 * The book surface is for every execution user (F1 personal) and for team
 * owners plus their invited finance actors (F2/F3). Authorization is
 * per-book membership resolved in `FinanceBookAccessService`; the consultant
 * gate stays on the legacy `/finance` portfolio only.
 */
@Controller('finance-books')
@UseGuards(SupabaseAuthGuard)
export class FinanceBooksController {
  constructor(private readonly books: FinanceBooksService) {}

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.books.listMyBooks(user.id);
  }

  @Get('hub')
  hub(@CurrentUser() user: AuthenticatedUser) {
    return this.books.getHub(user.id);
  }

  @Get('engaged-projects')
  listEngagedProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.books.listEngagedProjects(user.id);
  }

  @Get('personal/dashboard')
  personalDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.books.getPersonalDashboard(user.id);
  }

  @Post('personal')
  createPersonal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreatePersonalBookDto,
  ) {
    return this.books.createPersonalBook(user.id, body.currency);
  }

  @Post('team')
  createTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTeamBookDto,
  ) {
    return this.books.createTeamBook(
      user.id,
      body.team_id,
      body.project_ids ?? [],
      body.currency,
    );
  }

  @Post(':bookId/projects')
  addProjectBook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Body() body: AddProjectBookDto,
  ) {
    return this.books.addProjectBook(user.id, bookId, body.project_id);
  }

  @Get(':bookId/overview')
  getBookOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
  ) {
    return this.books.getBookOverview(user.id, bookId);
  }

  @Get(':bookId')
  getBook(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
  ) {
    return this.books.getBook(user.id, bookId);
  }
}
