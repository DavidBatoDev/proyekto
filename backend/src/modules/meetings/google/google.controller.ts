import { Controller, Delete, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { GoogleOAuthService } from './google-oauth.service';

/**
 * Per-user Google Calendar connection endpoints (routes: /api/meetings/google/*).
 * Guarded by the Supabase JWT except the OAuth callback, which Google hits with
 * no session — it's `@Public()` and resolves the user from the `state` param.
 */
@Controller('meetings/google')
@UseGuards(SupabaseAuthGuard)
export class GoogleController {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.getStatus(user.id);
  }

  @Get('connect')
  async connect(@CurrentUser() user: AuthenticatedUser) {
    const url = await this.oauth.buildConsentUrl(user.id);
    return { url };
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
    const back = (status: string) =>
      res.redirect(`${clientUrl}/meetings?google=${status}`);

    if (error || !code || !state) {
      return back('error');
    }
    try {
      const tokens = await this.oauth.exchangeCode(code, state);
      await this.oauth.storeConnection(tokens);
      return back('connected');
    } catch {
      return back('error');
    }
  }

  @Delete('connection')
  async disconnect(@CurrentUser() user: AuthenticatedUser) {
    await this.oauth.disconnect(user.id);
    return { disconnected: true };
  }
}
