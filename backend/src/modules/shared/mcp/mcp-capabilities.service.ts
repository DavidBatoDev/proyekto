import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MCP_ALL_SCOPES, type McpScope } from './mcp-scopes';

/**
 * Which MCP scopes are actually live right now.
 *
 * Phases 1–3 needed no per-feature flag: MCP_ENABLED was still off in prod when
 * they landed, so the whole surface was dark by construction. That is no longer
 * true — MCP_ENABLED and MCP_OAUTH_ENABLED are both on. Because MCP_ALL_SCOPES
 * feeds OAUTH_SUPPORTED_SCOPES feeds the WWW-Authenticate challenge, the moment
 * a scope enters the enum Claude requests it, the consent screen offers it, and
 * a user can grant it — on deploy, with no activation step. For chat writes,
 * which post text real people see, that would violate the staged-rollout rule.
 *
 * So `chat:write` sits behind MCP_CHAT_WRITE_ENABLED, resolved HERE and nowhere
 * else, and enforced at three points that all read this one service:
 *
 *   1. Tool registration — a dark tool is never registered, so it never appears
 *      in tools/list. (Registering it and denying every call would advertise a
 *      capability that can only fail, and invite the model to retry.)
 *   2. Token issuance — a PAT cannot be minted carrying a dark scope.
 *   3. Scope advertisement — a dark scope never reaches the 401 challenge or
 *      the consent screen.
 *
 * Residual case, and it is the safe one: a token issued while the flag was on,
 * then the flag flips off. requireScope still passes, but the tools are not
 * registered, so the surface is closed anyway.
 *
 * mcp-scopes.ts stays a pure static enum — it is the type source and is mirrored
 * by hand in the web app, so runtime config must not leak into it.
 */
@Injectable()
export class McpCapabilitiesService {
  constructor(private readonly config: ConfigService) {}

  /** Chat write tools are live. Dark unless explicitly switched on. */
  get chatWriteEnabled(): boolean {
    return this.config.get<string>('MCP_CHAT_WRITE_ENABLED') === 'true';
  }

  /** Delivery-register write tools are live. Dark unless explicitly switched on. */
  get deliveryWriteEnabled(): boolean {
    return this.config.get<string>('MCP_DELIVERY_WRITE_ENABLED') === 'true';
  }

  /** True when this scope may currently be granted and used. */
  isScopeEnabled(scope: McpScope): boolean {
    if (scope === 'chat:write') return this.chatWriteEnabled;
    if (scope === 'delivery:write') return this.deliveryWriteEnabled;
    return true;
  }

  /** Every scope a token may currently be issued for. */
  enabledScopes(): McpScope[] {
    return MCP_ALL_SCOPES.filter((scope) => this.isScopeEnabled(scope));
  }
}
