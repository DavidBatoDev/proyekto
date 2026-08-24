import { Module } from '@nestjs/common';
import { ProjectsModule } from '../../execution/projects/projects.module';
import { RoadmapsModule } from '../../execution/roadmaps/roadmaps.module';
import { ChatModule } from '../../execution/chat/chat.module';
import { DeliveryModule } from '../../execution/delivery/delivery.module';
import { McpController } from './mcp.controller';
import { McpTokensController } from './mcp-tokens.controller';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpCapabilitiesService } from './mcp-capabilities.service';
import { McpTokenService } from './mcp-token.service';
import { McpServerFactory } from './mcp-server.factory';
import { OAuthConfigService } from './oauth/oauth-config.service';
import { OAuthJwtService } from './oauth/oauth-jwt.service';
import { OAuthClientService } from './oauth/oauth-client.service';
import { OAuthService } from './oauth/oauth.service';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthGrantsController } from './oauth/oauth-grants.controller';
import { WellKnownController } from './oauth/well-known.controller';

/**
 * First-party Proyekto MCP server. Reuses the roadmap / project / chat /
 * delivery domain services in-process so every tool re-checks live
 * authorization; AuditService is global.
 *
 *  - Phases 1-2 (read + write tools, PAT auth) are gated by MCP_ENABLED.
 *  - Phase 3 (OAuth 2.1 authorization server, for the hosted Claude surfaces)
 *    is additionally gated by MCP_OAUTH_ENABLED and ships dark: while unset the
 *    discovery documents 404 and no WWW-Authenticate challenge is emitted, so
 *    PAT hosts are entirely unaffected.
 *  - Phase 4 chat writes are gated by MCP_CHAT_WRITE_ENABLED via
 *    McpCapabilitiesService. MCP_ENABLED is already on in prod, so without that
 *    flag the new scope would go live on deploy with no activation step.
 *  - Delivery governance (delivery:read / delivery:write) has NO flag, by
 *    decision: the write scope is opt-in per credential and unchecked by
 *    default at OAuth consent, every tool re-checks the live project
 *    permission, and the approval verbs carry destructiveHint. Nothing there
 *    pushes new text at people the way a chat message does.
 */
@Module({
  imports: [ProjectsModule, RoadmapsModule, ChatModule, DeliveryModule],
  controllers: [
    McpController,
    McpTokensController,
    WellKnownController,
    OAuthController,
    OAuthGrantsController,
  ],
  providers: [
    McpAuthGuard,
    McpCapabilitiesService,
    McpTokenService,
    McpServerFactory,
    OAuthConfigService,
    OAuthJwtService,
    OAuthClientService,
    OAuthService,
  ],
})
export class McpModule {}
