import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MCP_ALL_SCOPES } from '../mcp-scopes';

/**
 * `offline_access` is not a Proyekto permission — it is the standard OAuth
 * signal that the client wants a refresh token. We advertise it so Claude
 * appends it to its authorization request (per Anthropic's connector docs) and
 * honour it by minting a refresh token, but it grants no tool access.
 */
export const OFFLINE_ACCESS = 'offline_access';

/** Everything a client may ask for at /authorize. */
export const OAUTH_SUPPORTED_SCOPES: readonly string[] = [
  ...MCP_ALL_SCOPES,
  OFFLINE_ACCESS,
];

/**
 * Resolved, validated configuration for the MCP OAuth authorization server.
 *
 * Phase 3 ships dark: unless MCP_OAUTH_ENABLED === 'true' the discovery
 * documents 404, /oauth/* denies, and no WWW-Authenticate challenge is emitted,
 * so existing PAT hosts are entirely unaffected.
 */
@Injectable()
export class OAuthConfigService {
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return (
      this.config.get<string>('MCP_ENABLED') === 'true' &&
      this.config.get<string>('MCP_OAUTH_ENABLED') === 'true'
    );
  }

  /** The authorization-server issuer, e.g. `https://api.proyekto.tech`. */
  get issuer(): string {
    return stripTrailingSlash(
      this.config.get<string>('MCP_OAUTH_ISSUER') ??
        this.config.get<string>('PUBLIC_API_URL') ??
        'http://localhost:3001',
    );
  }

  /**
   * The protected resource identifier — must byte-match the URL the user types
   * into Claude ("https://api.proyekto.tech/mcp"), because RFC 9728 requires the
   * metadata document's `resource` to equal it and RFC 8707 binds it into the
   * access token's audience.
   */
  get resource(): string {
    return stripTrailingSlash(
      this.config.get<string>('MCP_OAUTH_RESOURCE') ?? `${this.issuer}/mcp`,
    );
  }

  /** Where the browser is sent to log in + consent (the web app). */
  get consentUrl(): string {
    const base = stripTrailingSlash(
      this.config.get<string>('CLIENT_URL') ?? 'http://localhost:3000',
    );
    return `${base}/oauth/authorize`;
  }

  /** URL of the protected-resource metadata document for /mcp. */
  get protectedResourceMetadataUrl(): string {
    return `${this.issuer}/.well-known/oauth-protected-resource/mcp`;
  }

  /**
   * The `scope` advertised on the 401 challenge, which is what Claude actually
   * asks for. We advertise the FULL set — including write scopes and
   * offline_access — and let the consent screen narrow it: an authorization
   * server may issue a subset of what was requested, but never a superset, so
   * asking small here would make write access unreachable.
   */
  defaultChallengeScopes(): readonly string[] {
    return OAUTH_SUPPORTED_SCOPES;
  }

  /**
   * HS256 signing secret for MCP access tokens. Deliberately distinct from
   * SUPABASE_JWT_SECRET so an MCP token can never be mistaken for a Supabase
   * session (and vice versa). Fails closed when unset.
   */
  requireJwtSecret(): string {
    const secret = this.config.get<string>('MCP_OAUTH_JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        'MCP OAuth is not configured (missing or too-short MCP_OAUTH_JWT_SECRET).',
      );
    }
    return secret;
  }

  /** Access-token lifetime in seconds. */
  get accessTokenTtlSeconds(): number {
    return this.config.get<number>('MCP_OAUTH_ACCESS_TTL_SECONDS') ?? 3600;
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
