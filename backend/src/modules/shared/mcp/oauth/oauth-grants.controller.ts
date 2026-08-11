import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { ApproveConsentDto, DenyConsentDto } from './dto/consent.dto';
import { OAuthService } from './oauth.service';

/**
 * The first-party half of the OAuth flow: the endpoints the Proyekto web app
 * calls with a normal Supabase session.
 *
 * These stay under the `/api` prefix (the prefix exclude for `mcp` is
 * exact-match, so `mcp/oauth/*` is unaffected) because they are our own API, not
 * part of the OAuth wire protocol. The approving user is always the authenticated
 * caller — never a body-supplied id.
 */
@Controller('mcp/oauth')
@UseGuards(SupabaseAuthGuard)
export class OAuthGrantsController {
  constructor(private readonly oauth: OAuthService) {}

  /** What the consent screen renders: which app is asking, and for what. */
  @Get('consent')
  async consent(@Query('request_id') requestId: string) {
    return this.oauth.getConsentView(requestId);
  }

  /**
   * The user approved. Returns where the browser should navigate next (the
   * client's redirect_uri with the authorization code attached).
   */
  @Post('consent')
  @HttpCode(200)
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApproveConsentDto,
  ): Promise<{ redirect_to: string }> {
    const redirectTo = await this.oauth.approve(
      dto.request_id,
      user.id,
      dto.granted_scopes,
    );
    return { redirect_to: redirectTo };
  }

  /** The user declined — bounce back to the client with access_denied. */
  @Post('consent/deny')
  @HttpCode(200)
  async deny(@Body() dto: DenyConsentDto): Promise<{ redirect_to: string }> {
    return { redirect_to: await this.oauth.deny(dto.request_id) };
  }

  /** "Connected apps" in settings. */
  @Get('grants')
  async listGrants(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.listGrants(user.id);
  }

  @Delete('grants/:id')
  @HttpCode(204)
  async revokeGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    const revoked = await this.oauth.revokeGrant(user.id, id);
    if (!revoked) {
      throw new NotFoundException('Connection not found or already revoked.');
    }
  }
}
