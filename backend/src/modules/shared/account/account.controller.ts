import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CACHE_POLICY_PRESETS } from '../../../common/cache/cache-policy';
import { SetCachePolicy } from '../../../common/decorators/cache-policy.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { UserThrottlerGuard } from '../../../common/guards/user-throttler.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { AccountService, DeleteAccountResult } from './account.service';
import { DeleteAccountDto } from './dto/account-deletion.dto';

/**
 * In-app account deletion.
 *
 * Google Play requires an app that lets people create an account to offer
 * deletion inside the app, and separately at a publicly reachable web URL. This
 * is the in-app half; the public half is the docs article, which needs no
 * endpoint because the web app and the mobile app are the same bundle.
 *
 * Every route is authenticated and acts only on the caller: there is no
 * `:userId` parameter anywhere here, deliberately. An admin deleting somebody
 * else's account is a different feature with a different audit story.
 */
@Controller('account')
@UseGuards(SupabaseAuthGuard)
@SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /**
   * What deletion would do. Also the status oracle the web polls if the
   * connection drops mid-delete: a 401 or 404 here means it finished.
   */
  @Get('deletion/preflight')
  preflight(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.account.preflight(user.id);
  }

  /**
   * Mail a confirmation code. For accounts created through Google there is no
   * password to re-enter, so this is the only way to prove who is asking.
   *
   * Throttled per user rather than per IP: the limit that matters is "how many
   * emails can one account trigger", and mobile users share carrier NAT.
   */
  @Post('deletion/challenge')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  requestChallenge(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ sent: boolean; expires_at: string }> {
    return this.account.requestChallenge(user.id, user.email);
  }

  /**
   * Delete the caller's account. Irreversible.
   *
   * DELETE rather than POST because that is what it is, and the body is
   * required: the typed phrase, the credential and the resolution all travel
   * with it. Nest and Express both allow a body on DELETE.
   *
   * Throttled hard. The credential check already gates it, but a tight limit
   * turns a stolen-token attack into a rate-limited one.
   */
  @Delete('deletion')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ): Promise<DeleteAccountResult> {
    return this.account.deleteAccount(user.id, user.email, dto);
  }
}
