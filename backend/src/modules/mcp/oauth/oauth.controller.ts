import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import { OAuthExceptionFilter } from './oauth-exception.filter';
import { OAuthError } from './oauth-error';
import { OAuthClientService } from './oauth-client.service';
import { OAuthRedirectError, OAuthService } from './oauth.service';
import type {
  AuthorizeQuery,
  RegisterRequestBody,
  RevokeRequestBody,
  TokenRequestBody,
} from './dto/oauth.types';

/**
 * The OAuth 2.1 authorization-server endpoints, served at the domain root
 * (`oauth/*splat` is in the setGlobalPrefix exclude list) because clients read
 * their locations from the discovery documents, which advertise root paths.
 *
 * Every body/query here is typed as a plain interface so the global
 * ValidationPipe skips it — `forbidNonWhitelisted` would otherwise reject the
 * `resource` indicator and any vendor extension. Validation is done by hand in
 * OAuthService, which raises RFC 6749 codes that OAuthExceptionFilter renders
 * flat.
 */
@Controller('oauth')
@UseFilters(OAuthExceptionFilter)
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly clients: OAuthClientService,
  ) {}

  /**
   * Start the flow. On success this is a bare 302 to the web consent screen; the
   * user logs in there with their normal Proyekto session.
   *
   * Errors are handled by hand rather than by the filter because RFC 6749
   * §4.1.2.1 requires them to be delivered by redirecting back to the client —
   * but only once the redirect_uri has been validated, which is exactly the
   * distinction OAuthRedirectError encodes.
   */
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeQuery,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const consentUrl = await this.oauth.beginAuthorization(query);
      res.redirect(302, consentUrl);
    } catch (err) {
      if (err instanceof OAuthRedirectError) {
        const url = new URL(err.redirectUri);
        url.searchParams.set('error', err.code);
        if (err.description) {
          url.searchParams.set('error_description', err.description);
        }
        if (err.state) url.searchParams.set('state', err.state);
        res.redirect(302, url.toString());
        return;
      }
      if (err instanceof OAuthError) {
        res.status(err.getStatus()).json(err.getResponse());
        return;
      }
      res.status(500).json({ error: 'server_error' });
    }
  }

  /**
   * RFC 6749 token endpoint. Accepts `application/x-www-form-urlencoded` (Nest
   * registers express.urlencoded by default) for both the code exchange and
   * refresh.
   */
  @Post('token')
  @HttpCode(200)
  @RawResponse()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async token(
    @Body() body: TokenRequestBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return this.oauth.token(body ?? {});
  }

  /**
   * RFC 7591 Dynamic Client Registration — the fallback for hosts that do not
   * support CIMD. Takes `application/json` (not form-encoded, per §3.1); a
   * missing/wrong Content-Type leaves req.body undefined under Express 5.
   */
  @Post('register')
  @HttpCode(201)
  @RawResponse()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @Body() body: RegisterRequestBody,
  ): Promise<Record<string, unknown>> {
    this.oauth.assertEnabled();
    if (!body || typeof body !== 'object') {
      throw new OAuthError(
        'invalid_client_metadata',
        'Expected a JSON client metadata document.',
      );
    }
    return this.clients.register(body);
  }

  /** RFC 7009. Always 200, even for an unknown token. */
  @Post('revoke')
  @HttpCode(200)
  @RawResponse()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async revoke(
    @Body() body: RevokeRequestBody,
  ): Promise<Record<string, never>> {
    await this.oauth.revokeToken(body ?? {});
    return {};
  }
}
