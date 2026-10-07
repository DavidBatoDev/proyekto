import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import { UserThrottlerGuard } from '../../../../common/guards/user-throttler.guard';
import { Public } from '../../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../../../common/decorators/cache-policy.decorator';
import { CACHE_POLICY_PRESETS } from '../../../../common/cache/cache-policy';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { MeetingsService } from '../meetings.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleConnectQueryDto, GoogleEventsQueryDto } from './google.dto';

// The web asks for the visible calendar range: the day/week/month views fetch
// their visible span padded to month boundaries ±1 month, which is up to ~5
// months when a month grid spills into neighbouring months. Anything wider is
// not a calendar view.
const MAX_EVENTS_RANGE_MS = 186 * 24 * 60 * 60_000;

/**
 * Per-user Google Calendar endpoints (routes: /api/meetings/google/*).
 * Guarded by the Supabase JWT except the OAuth callback, which Google hits with
 * no session — it's `@Public()` and resolves the user from the `state` param.
 */
@Controller('meetings/google')
@UseGuards(SupabaseAuthGuard)
export class GoogleController {
  private readonly logger = new Logger(GoogleController.name);

  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly meetings: MeetingsService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.getStatus(user.id);
  }

  @Get('connect')
  async connect(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GoogleConnectQueryDto,
  ) {
    const url = await this.oauth.buildConsentUrl(user.id, query.returnTo);
    return { url };
  }

  /**
   * The user's own Google events for the visible calendar range. Read live from
   * Google on every request and never stored, hence NO_STORE. Rate-limited per
   * user because each call fans out to Google's API.
   */
  @Get('events')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GoogleEventsQueryDto,
  ) {
    const fromMs = Date.parse(query.from);
    const toMs = Date.parse(query.to);
    if (!(toMs > fromMs)) {
      throw new BadRequestException('`to` must be after `from`.');
    }
    if (toMs - fromMs > MAX_EVENTS_RANGE_MS) {
      throw new BadRequestException('The requested range is too large.');
    }
    return this.meetings.listGoogleEvents(user.id, {
      from: query.from,
      to: query.to,
    });
  }

  @Get('callback')
  @Public()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const clientUrl = this.config
      .get<string>('CLIENT_URL', 'http://localhost:3000')
      .replace(/\/+$/, '');
    let returnTo = this.oauth.safeReturnPath(null);
    const back = (status: 'connected' | 'error', reason?: string) => {
      const params = new URLSearchParams({ google: status });
      if (reason) params.set('reason', reason);
      return res.redirect(`${clientUrl}${returnTo}?${params.toString()}`);
    };

    try {
      const resolved = state ? await this.oauth.consumeState(state) : null;
      if (resolved) returnTo = resolved.returnTo;
      if (error) {
        // access_denied = the user pressed Cancel on Google's consent screen.
        return back('error', error === 'access_denied' ? 'denied' : 'failed');
      }
      if (!resolved) return back('error', 'expired');
      if (!code) return back('error', 'failed');

      const tokens = await this.oauth.exchangeCode(code, resolved.userId);
      await this.oauth.storeConnection(tokens);
      return back('connected');
    } catch (err) {
      this.logger.warn(
        `Google Calendar connect failed: ${(err as Error).message}`,
      );
      return back('error', 'failed');
    }
  }

  @Delete('connection')
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.oauth.disconnect(user.id);
    return { disconnected: true };
  }
}
