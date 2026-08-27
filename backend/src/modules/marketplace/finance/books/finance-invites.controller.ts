import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { CreateFinanceInviteDto } from './dto/finance-book-members.dto';
import { FinanceInvitesService } from './finance-invites.service';

/**
 * Finance-book invites. Two prefixes on one controller: the book-scoped
 * inviter side (`/finance-books/:bookId/invites`) and the token-addressed
 * invitee side (`/finance-invites/:token`), where the token IS the
 * credential — auth is still required so the accepter has an account to
 * attach membership to.
 */
@Controller()
@UseGuards(SupabaseAuthGuard)
export class FinanceInvitesController {
  constructor(private readonly invites: FinanceInvitesService) {}

  // ─── inviter side ───────────────────────────────────────────────────────

  @Post('finance-books/:bookId/invites')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Body() body: CreateFinanceInviteDto,
  ) {
    return this.invites.create(user.id, bookId, {
      email: body.email,
      finance_role: body.finance_role,
      capabilities: body.capabilities,
    });
  }

  @Get('finance-books/:bookId/invites')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
  ) {
    return this.invites.listForBook(user.id, bookId);
  }

  @Delete('finance-books/:bookId/invites/:inviteId')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.invites.cancel(user.id, bookId, inviteId);
  }

  // ─── invitee side ───────────────────────────────────────────────────────

  @Get('finance-invites/:token')
  preview(@Param('token') token: string) {
    return this.invites.preview(token);
  }

  @Post('finance-invites/:token/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    return this.invites.accept(user.id, token);
  }

  @Post('finance-invites/:token/decline')
  decline(@Param('token') token: string) {
    return this.invites.decline(token);
  }
}
