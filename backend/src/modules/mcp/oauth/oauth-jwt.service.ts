import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { OAuthConfigService } from './oauth-config.service';

export interface McpAccessTokenClaims {
  sub: string;
  scope: string;
  client_id: string;
  aud: string;
  iss: string;
  jti: string;
  exp: number;
  iat: number;
}

export interface VerifiedMcpAccessToken {
  userId: string;
  scopes: string[];
  clientId: string;
}

/**
 * Mints and verifies MCP access tokens.
 *
 * Access tokens are stateless HS256 JWTs so the /mcp hot path costs no DB round
 * trip. They are AUDIENCE-BOUND to the MCP resource (RFC 8707): a token minted
 * for this resource cannot be replayed at another, and a Supabase session token
 * can never verify here because the signing secret is different.
 *
 * Statelessness is why they are short-lived (1h default) — revoking a connection
 * kills the refresh token immediately and the access token dies at expiry.
 */
@Injectable()
export class OAuthJwtService {
  private readonly logger = new Logger(OAuthJwtService.name);

  constructor(private readonly config: OAuthConfigService) {}

  mintAccessToken(params: {
    userId: string;
    clientId: string;
    scopes: readonly string[];
    resource: string;
  }): { token: string; expiresIn: number } {
    const secret = this.config.requireJwtSecret();
    const expiresIn = this.config.accessTokenTtlSeconds;

    const token = jwt.sign(
      {
        scope: params.scopes.join(' '),
        client_id: params.clientId,
        jti: randomUUID(),
      },
      secret,
      {
        algorithm: 'HS256',
        subject: params.userId,
        audience: params.resource,
        issuer: this.config.issuer,
        expiresIn,
      },
    );

    return { token, expiresIn };
  }

  /**
   * Verify a bearer presented at /mcp. Returns null on any failure — the guard
   * turns that into a 401 challenge rather than leaking why.
   */
  verifyAccessToken(token: string): VerifiedMcpAccessToken | null {
    let secret: string;
    try {
      secret = this.config.requireJwtSecret();
    } catch {
      return null;
    }

    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        audience: this.config.resource,
        issuer: this.config.issuer,
      });
      if (typeof payload === 'string' || !payload.sub) return null;

      const claims = payload as unknown as McpAccessTokenClaims;
      const scopes =
        typeof claims.scope === 'string' && claims.scope.length > 0
          ? claims.scope.split(' ').filter(Boolean)
          : [];

      return {
        userId: String(claims.sub),
        scopes,
        clientId: String(claims.client_id ?? 'unknown'),
      };
    } catch (err) {
      this.logger.debug(
        `MCP access token rejected: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
