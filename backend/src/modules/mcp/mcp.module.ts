import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { ChatModule } from '../chat/chat.module';
import { McpController } from './mcp.controller';
import { McpTokensController } from './mcp-tokens.controller';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpTokenService } from './mcp-token.service';
import { McpServerFactory } from './mcp-server.factory';

/**
 * First-party Proyekto MCP server (read-only Phase 1). Reuses the roadmap /
 * project / chat domain services in-process so every tool re-checks live
 * authorization; AuditService is global. Ships dark behind MCP_ENABLED.
 */
@Module({
  imports: [ProjectsModule, RoadmapsModule, ChatModule],
  controllers: [McpController, McpTokensController],
  providers: [McpAuthGuard, McpTokenService, McpServerFactory],
})
export class McpModule {}
