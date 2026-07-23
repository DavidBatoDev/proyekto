import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { IssueMcpTokenDto } from './dto/issue-mcp-token.dto';
import { McpTokenService } from './mcp-token.service';

/**
 * Personal Access Token management for the Proyekto MCP server. Authenticated
 * with a normal Supabase session (SupabaseAuthGuard) and owner-scoped by the
 * caller's id — never a body-supplied user id. Gated behind MCP_ENABLED so the
 * surface stays dark until the module is activated.
 */
@Controller('mcp/tokens')
@UseGuards(SupabaseAuthGuard)
export class McpTokensController {
  constructor(
    private readonly tokens: McpTokenService,
    private readonly config: ConfigService,
  ) {}

  private assertEnabled(): void {
    if (this.config.get<string>('MCP_ENABLED') !== 'true') {
      throw new ServiceUnavailableException('MCP server is not enabled.');
    }
  }

  @Post()
  async issue(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IssueMcpTokenDto,
  ) {
    this.assertEnabled();
    try {
      return await this.tokens.issueToken(
        user.id,
        dto.name,
        dto.scopes,
        dto.expires_at ?? null,
      );
    } catch (err) {
      // sanitizeScopes throws a plain Error on an unknown scope → surface as 400.
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to issue token',
      );
    }
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    this.assertEnabled();
    return this.tokens.listTokens(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    this.assertEnabled();
    const revoked = await this.tokens.revokeToken(user.id, id);
    if (!revoked) {
      throw new NotFoundException('Token not found or already revoked.');
    }
  }
}
