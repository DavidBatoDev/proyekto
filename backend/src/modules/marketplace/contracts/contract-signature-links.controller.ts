import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CACHE_POLICY_PRESETS } from '../../../common/cache/cache-policy';
import { SetCachePolicy } from '../../../common/decorators/cache-policy.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { ContractSignatureLinksService } from './contract-signature-links.service';
import {
  CreateSignatureLinkDto,
  PublicSignContractDto,
} from './dto/contract-signature-links.dto';

/**
 * Remote client signing.
 *
 * A SEPARATE controller from `ContractsController` on purpose: Nest matches
 * routes in registration order, and `ContractsController` declares
 * `@Get(':id')` with a `ParseUUIDPipe`. Adding `sign/:token` there would make
 * "sign" get parsed as a contract id and 400 before ever reaching the handler.
 * Registering this class FIRST in the module keeps the literal path winning.
 * (The invoices controller documents the same hazard for its cron route.)
 */
@Controller('contracts')
export class ContractSignatureLinksController {
  constructor(private readonly links: ContractSignatureLinksService) {}

  // ─── public: no session, the token is the authorization ────────────────────

  /**
   * The agreement behind a signing link. Never cached: the response contains a
   * contract keyed to a bearer token, and a shared cache must not hold it.
   */
  @Get('sign/:token')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getByToken(@Param('token') token: string) {
    return this.links.getByToken(token);
  }

  /**
   * Stamp the client signature. Tightly throttled — it is an unauthenticated write.
   *
   * `@UseGuards(ThrottlerGuard)` is load-bearing and must stay: no `APP_GUARD`
   * binds the throttler globally, so `@Throttle` on its own is inert and these
   * two routes were effectively unlimited.
   */
  @Post('sign/:token')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signByToken(
    @Param('token') token: string,
    @Body() dto: PublicSignContractDto,
  ) {
    return this.links.signByToken(token, dto);
  }

  // ─── consultant: authenticated ─────────────────────────────────────────────

  @Get(':id/signature-link')
  @UseGuards(SupabaseAuthGuard)
  getActiveLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.getActiveLink(user.id, id);
  }

  @Post(':id/signature-link')
  @UseGuards(SupabaseAuthGuard)
  createLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSignatureLinkDto,
  ) {
    return this.links.createLink(user.id, id, dto);
  }

  @Delete(':id/signature-link')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.revokeLink(user.id, id);
  }
}
