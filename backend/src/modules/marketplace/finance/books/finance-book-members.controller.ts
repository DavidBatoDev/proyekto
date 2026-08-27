import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  AddBookMemberDto,
  UpdateBookMemberDto,
} from './dto/finance-book-members.dto';
import { FinanceBookMembersService } from './finance-book-members.service';

/**
 * Book membership routes. Same guard posture as `FinanceBooksController`:
 * auth only, per-book authorization inside the service (misses read as 404).
 */
@Controller('finance-books/:bookId/members')
@UseGuards(SupabaseAuthGuard)
export class FinanceBookMembersController {
  constructor(private readonly members: FinanceBookMembersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
  ) {
    return this.members.listMembers(user.id, bookId);
  }

  @Post()
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Body() body: AddBookMemberDto,
  ) {
    return this.members.addMember(
      user.id,
      bookId,
      body.user_id,
      body.finance_role,
      body.capabilities,
    );
  }

  @Patch(':memberId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: UpdateBookMemberDto,
  ) {
    return this.members.updateMember(user.id, bookId, memberId, {
      finance_role: body.finance_role,
      capabilities: body.capabilities,
    });
  }

  @Delete(':memberId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.members.removeMember(user.id, bookId, memberId);
  }
}
