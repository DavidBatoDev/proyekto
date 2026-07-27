import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
import { MCP_READ_SCOPES } from './mcp-scopes';
import { McpTokenService } from './mcp-token.service';
import { OAuthConfigService } from './oauth/oauth-config.service';
import { OAuthJwtService } from './oauth/oauth-jwt.service';

/** The authenticated request as seen by MCP handlers — carries token scopes. */
export interface McpAuthenticatedRequest extends AuthenticatedRequest {
  mcpScopes?: string[];
}

/**
 * Auth for the /mcp endpoint.
 *
 *  1. Kill switch: unless MCP_ENABLED === 'true', the whole surface is 503.
 *  2. Proyekto PAT (`Bearer pk_…`) resolved by sha256 hash to its owner +
 *     scopes. Identity is derived here, never from tool inputs.
 *  3. OAuth 2.1 access token — a stateless HS256 JWT this server minted,
 *     audience-bound to the MCP resource. This is how the hosted Claude
 *     surfaces (claude.ai, Desktop, mobile, Cowork) connect.
 *  4. Fallback: a live Supabase access token (local HS256 verify, mirroring
 *     SupabaseAuthGuard) — convenient for dev/MCP Inspector. Such a session
 *     grants every read scope so a developer isn't blocked; PATs and OAuth
 *     tokens remain the least-privilege path for real hosts.
 *
 * Every 401 carries a `WWW-Authenticate` challenge naming the protected-resource
 * metadata document (RFC 9728). That header is what lets an OAuth client
 * discover the authorization server at all — Claude does not honour it on a 200,
 * and without it the connection fails with "couldn't reach the MCP server".
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly jwtSecret?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: McpTokenService,
    private readonly oauthConfig: OAuthConfigService,
    private readonly oauthJwt: OAuthJwtService,
  ) {
    this.jwtSecret = this.config.get<string>('SUPABASE_JWT_SECRET');
  }

  private isEnabled(): boolean {
    return this.config.get<string>('MCP_ENABLED') === 'true';
  }

  /**
   * Attach the RFC 9728 challenge before throwing. Express keeps headers set
   * ahead of `.status().json()`, so it survives the global exception filter.
   *
   * While OAuth is dark this is a no-op: an unauthenticated caller just gets a
   * bare 401 and no discovery path, exactly as in Phases 1-2.
   */
  private challenge(context: ExecutionContext): void {
    if (!this.oauthConfig.enabled) return;
    const res = context.switchToHttp().getResponse<Response>();
    const scopes = this.oauthConfig.defaultChallengeScopes().join(' ');
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${this.oauthConfig.protectedResourceMetadataUrl}", scope="${scopes}"`,
    );
  }

  /** Build the 401 to throw, attaching the discovery challenge first. */
  private deny(
    context: ExecutionContext,
    message: string,
  ): UnauthorizedException {
    this.challenge(context);
    return new UnauthorizedException(message);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('MCP server is not enabled.');
    }

    const request = context
      .switchToHttp()
      .getRequest<McpAuthenticatedRequest>();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw this.deny(context, 'Missing bearer token.');
    }
    const token = authHeader.slice(7);

    // --- Proyekto PAT ---
    if (token.startsWith('pk_')) {
      const resolved = await this.tokens.resolveToken(token);
      if (!resolved) {
        throw this.deny(context, 'Invalid, revoked, or expired token.');
      }
      request.user = { id: resolved.user_id };
      request.mcpScopes = resolved.scopes ?? [];
      return true;
    }

    // --- OAuth 2.1 access token (hosted Claude surfaces) ---
    if (this.oauthConfig.enabled) {
      const verified = this.oauthJwt.verifyAccessToken(token);
      if (verified) {
        request.user = { id: verified.userId };
        request.mcpScopes = verified.scopes;
        return true;
      }
    }

    // --- Supabase session JWT (dev / MCP Inspector) ---
    const user = this.verifySupabaseToken(token);
    if (!user) {
      throw this.deny(context, 'Invalid or expired token.');
    }
    request.user = user;
    // A real logged-in session may use any read tool during development.
    // Derived from MCP_READ_SCOPES rather than spelled out, so a read scope
    // added later cannot silently miss this branch — and, structurally, no
    // write scope can ever leak into it.
    request.mcpScopes = [...MCP_READ_SCOPES];
    return true;
  }

  private verifySupabaseToken(
    token: string,
  ): { id: string; email?: string } | null {
    if (!this.jwtSecret) return null;
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      });
      if (typeof payload === 'string' || !payload.sub) return null;
      return {
        id: String(payload.sub),
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };
    } catch {
      return null;
    }
  }
}
