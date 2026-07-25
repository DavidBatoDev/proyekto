import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import { isKnownScope } from '../mcp-scopes';
import {
  OAuthConfigService,
  OAUTH_SUPPORTED_SCOPES,
  OFFLINE_ACCESS,
} from './oauth-config.service';
import { OAuthClientService, redirectUriMatches } from './oauth-client.service';
import { OAuthJwtService } from './oauth-jwt.service';
import { OAuthError } from './oauth-error';
import type {
  AuthorizeQuery,
  PendingAuthorization,
  RevokeRequestBody,
  StoredAuthorizationCode,
  TokenRequestBody,
} from './dto/oauth.types';

const PENDING_TTL_SECONDS = 600;
const CODE_TTL_SECONDS = 60;
const REFRESH_TOKEN_BYTES = 32;

/**
 * An error raised AFTER the redirect_uri has been validated, so RFC 6749
 * §4.1.2.1 requires it to be delivered by redirecting back to the client rather
 * than rendered at our own endpoint.
 */
export class OAuthRedirectError extends OAuthError {
  constructor(
    code: ConstructorParameters<typeof OAuthError>[0],
    description: string | undefined,
    readonly redirectUri: string,
    readonly state?: string,
  ) {
    super(code, description);
  }
}

export interface ConsentView {
  request_id: string;
  client_name: string;
  client_source: 'cimd' | 'dcr';
  client_id: string;
  requested_scopes: string[];
  resource: string;
}

export interface GrantSummary {
  id: string;
  client_name: string | null;
  client_id: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    @Inject(UPSTASH_REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly config: OAuthConfigService,
    private readonly clients: OAuthClientService,
    private readonly jwt: OAuthJwtService,
  ) {}

  private requireRedis(): Redis {
    if (!this.redis) {
      throw new OAuthError(
        'temporarily_unavailable',
        'Authorization storage is unavailable.',
        503,
      );
    }
    return this.redis;
  }

  assertEnabled(): void {
    if (!this.config.enabled) {
      throw new OAuthError(
        'temporarily_unavailable',
        'OAuth is not enabled for this server.',
        503,
      );
    }
  }

  // ── /authorize ────────────────────────────────────────────────────────────

  /**
   * Validate an authorization request and park it in Redis. Returns the URL of
   * the web consent screen the browser should be sent to.
   *
   * Errors raised before the redirect_uri is trusted are thrown as plain
   * OAuthError (we must NOT bounce a user to an unvalidated URL); everything
   * after is an OAuthRedirectError the controller delivers to the client.
   */
  async beginAuthorization(query: AuthorizeQuery): Promise<string> {
    this.assertEnabled();

    const client = await this.clients.resolve(String(query.client_id ?? ''));

    const redirectUri = String(query.redirect_uri ?? '');
    if (!redirectUri) {
      throw new OAuthError('invalid_redirect_uri', 'Missing redirect_uri.');
    }
    if (!redirectUriMatches(client.redirect_uris, redirectUri)) {
      throw new OAuthError(
        'invalid_redirect_uri',
        'redirect_uri is not registered for this client.',
      );
    }

    // From here on the redirect_uri is trusted — errors go back to the client.
    const state = typeof query.state === 'string' ? query.state : undefined;
    const fail = (
      code: ConstructorParameters<typeof OAuthError>[0],
      description: string,
    ) => new OAuthRedirectError(code, description, redirectUri, state);

    if (query.response_type !== 'code') {
      throw fail(
        'unsupported_grant_type',
        'Only the authorization_code flow is supported.',
      );
    }

    const codeChallenge = String(query.code_challenge ?? '');
    if (!codeChallenge) {
      throw fail('invalid_request', 'PKCE code_challenge is required.');
    }
    if (query.code_challenge_method !== 'S256') {
      throw fail('invalid_request', 'code_challenge_method must be S256.');
    }

    // RFC 8707: when the client names a resource it must be the one we protect.
    if (query.resource && stripSlash(query.resource) !== this.config.resource) {
      throw fail('invalid_request', 'Unknown resource indicator.');
    }

    const requestedScopes = parseScopes(query.scope);
    if (requestedScopes.length === 0) {
      throw fail('invalid_scope', 'No supported scopes were requested.');
    }

    const pending: PendingAuthorization = {
      request_id: randomUUID(),
      client_id: client.client_id,
      client_name: client.client_name,
      client_source: client.source,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      requested_scopes: requestedScopes,
      resource: this.config.resource,
      created_at: Date.now(),
    };

    await this.requireRedis().set(pendingKey(pending.request_id), pending, {
      ex: PENDING_TTL_SECONDS,
    });

    return `${this.config.consentUrl}?request_id=${encodeURIComponent(pending.request_id)}`;
  }

  /** What the consent screen renders. */
  async getConsentView(requestId: string): Promise<ConsentView> {
    this.assertEnabled();
    const pending = await this.readPending(requestId);
    return {
      request_id: pending.request_id,
      client_name: pending.client_name,
      client_source: pending.client_source,
      client_id: pending.client_id,
      requested_scopes: pending.requested_scopes,
      resource: pending.resource,
    };
  }

  /**
   * The user approved. Mint a single-use authorization code bound to the
   * granted scopes and return where the browser should go next.
   *
   * Granted scopes may only ever NARROW what was requested — issuing more than
   * the client asked for is not something an authorization server may do.
   */
  async approve(
    requestId: string,
    userId: string,
    grantedScopes: readonly string[],
  ): Promise<string> {
    this.assertEnabled();
    const pending = await this.readPending(requestId);

    const granted = grantedScopes
      .map((s) => String(s).trim())
      .filter((s) => pending.requested_scopes.includes(s));
    if (granted.length === 0) {
      throw OAuthError.invalidScope('At least one scope must be granted.');
    }

    const code = `mcpc_${randomBytes(32).toString('base64url')}`;
    const stored: StoredAuthorizationCode = {
      client_id: pending.client_id,
      user_id: userId,
      redirect_uri: pending.redirect_uri,
      granted_scopes: granted,
      code_challenge: pending.code_challenge,
      resource: pending.resource,
      client_name: pending.client_name,
      client_source: pending.client_source,
    };

    const redis = this.requireRedis();
    await redis.set(codeKey(code), stored, { ex: CODE_TTL_SECONDS });
    await redis.del(pendingKey(requestId));

    return appendQuery(pending.redirect_uri, {
      code,
      ...(pending.state ? { state: pending.state } : {}),
    });
  }

  /** The user declined — bounce back with the spec's access_denied. */
  async deny(requestId: string): Promise<string> {
    this.assertEnabled();
    const pending = await this.readPending(requestId);
    await this.requireRedis().del(pendingKey(requestId));
    return appendQuery(pending.redirect_uri, {
      error: 'access_denied',
      error_description: 'The user declined the request.',
      ...(pending.state ? { state: pending.state } : {}),
    });
  }

  private async readPending(requestId: string): Promise<PendingAuthorization> {
    if (!requestId) {
      throw OAuthError.invalidRequest('Missing request_id.');
    }
    const pending = await this.requireRedis().get<PendingAuthorization>(
      pendingKey(requestId),
    );
    if (!pending) {
      throw OAuthError.invalidRequest(
        'This authorization request has expired. Start again from your MCP host.',
      );
    }
    return pending;
  }

  // ── /token ────────────────────────────────────────────────────────────────

  async token(body: TokenRequestBody): Promise<Record<string, unknown>> {
    this.assertEnabled();
    switch (body?.grant_type) {
      case 'authorization_code':
        return this.exchangeCode(body);
      case 'refresh_token':
        return this.refresh(body);
      default:
        throw new OAuthError(
          'unsupported_grant_type',
          `Unsupported grant_type: ${body?.grant_type ?? '(none)'}`,
        );
    }
  }

  private async exchangeCode(
    body: TokenRequestBody,
  ): Promise<Record<string, unknown>> {
    const code = String(body.code ?? '');
    if (!code) throw OAuthError.invalidRequest('Missing code.');

    // Single-use enforcement is the whole security property here, so the read
    // and delete MUST be one atomic round trip — a get+del pair lets two
    // concurrent redemptions both succeed.
    const stored = await this.requireRedis().getdel<StoredAuthorizationCode>(
      codeKey(code),
    );
    if (!stored) {
      throw OAuthError.invalidGrant(
        'Authorization code is invalid, expired, or already used.',
      );
    }

    const client = await this.clients.resolve(String(body.client_id ?? ''));
    if (client.client_id !== stored.client_id) {
      throw OAuthError.invalidGrant('Code was issued to a different client.');
    }
    this.clients.assertClientAuthenticated(client, body.client_secret);

    if (body.redirect_uri && body.redirect_uri !== stored.redirect_uri) {
      throw OAuthError.invalidGrant('redirect_uri does not match the request.');
    }
    if (body.resource && stripSlash(body.resource) !== stored.resource) {
      throw OAuthError.invalidRequest('Unknown resource indicator.');
    }

    verifyPkce(String(body.code_verifier ?? ''), stored.code_challenge);

    return this.issueTokens({
      userId: stored.user_id,
      clientId: stored.client_id,
      clientName: stored.client_name,
      scopes: stored.granted_scopes,
      resource: stored.resource,
      grantId: null,
    });
  }

  private async refresh(
    body: TokenRequestBody,
  ): Promise<Record<string, unknown>> {
    const presented = String(body.refresh_token ?? '');
    if (!presented) {
      throw OAuthError.invalidRequest('Missing refresh_token.');
    }
    const hash = sha256(presented);

    const { data, error } = await this.db
      .from('mcp_oauth_grants')
      .select(
        'id, user_id, client_id, client_name, scopes, revoked_at, refresh_token_hash',
      )
      .eq('refresh_token_hash', hash)
      .maybeSingle();

    if (error) {
      this.logger.warn(`Refresh lookup failed: ${error.message}`);
      throw OAuthError.invalidGrant('Refresh token is not valid.');
    }

    if (!data) {
      // Not a live token. If it is one we already rotated away, this is replay
      // of a stolen token — kill the whole chain (OAuth 2.1 / MCP auth spec).
      await this.revokeChainIfRotated(hash);
      throw OAuthError.invalidGrant('Refresh token is not valid.');
    }

    const row = data as {
      id: string;
      user_id: string;
      client_id: string;
      client_name: string | null;
      scopes: string[];
      revoked_at: string | null;
    };
    if (row.revoked_at) {
      throw OAuthError.invalidGrant('This connection has been revoked.');
    }

    const client = await this.clients.resolve(
      String(body.client_id ?? row.client_id),
    );
    if (client.client_id !== row.client_id) {
      throw OAuthError.invalidGrant('Refresh token belongs to another client.');
    }
    this.clients.assertClientAuthenticated(client, body.client_secret);

    // A refresh may narrow scope but never widen it.
    const requested = body.scope ? parseScopes(body.scope) : row.scopes;
    const narrowed = requested.filter((s) => row.scopes.includes(s));
    const scopes = narrowed.length > 0 ? narrowed : row.scopes;

    // offline_access belongs to the GRANT, not to any one access token: a client
    // that narrows scope on refresh must not thereby lose its ability to keep
    // refreshing.
    if (
      row.scopes.includes(OFFLINE_ACCESS) &&
      !scopes.includes(OFFLINE_ACCESS)
    ) {
      scopes.push(OFFLINE_ACCESS);
    }

    return this.issueTokens({
      userId: row.user_id,
      clientId: row.client_id,
      clientName: row.client_name ?? client.client_name,
      scopes,
      resource: this.config.resource,
      grantId: row.id,
      rotatedFrom: hash,
    });
  }

  /**
   * Mint the access token and (when offline_access was granted) a rotating
   * refresh token, creating or updating the durable grant row that the
   * "Connected apps" UI lists.
   */
  private async issueTokens(params: {
    userId: string;
    clientId: string;
    clientName: string;
    scopes: readonly string[];
    resource: string;
    grantId: string | null;
    rotatedFrom?: string;
  }): Promise<Record<string, unknown>> {
    const toolScopes = params.scopes.filter((s) => isKnownScope(s));
    const { token: accessToken, expiresIn } = this.jwt.mintAccessToken({
      userId: params.userId,
      clientId: params.clientId,
      scopes: toolScopes,
      resource: params.resource,
    });

    const wantsRefresh = params.scopes.includes(OFFLINE_ACCESS);
    let refreshToken: string | null = null;
    if (wantsRefresh) {
      refreshToken = `mcpr_${randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')}`;
    }

    const record = {
      user_id: params.userId,
      client_id: params.clientId,
      client_name: params.clientName,
      scopes: [...params.scopes],
      refresh_token_hash: refreshToken ? sha256(refreshToken) : null,
      rotated_from: params.rotatedFrom ?? null,
      last_used_at: new Date().toISOString(),
    };

    if (params.grantId) {
      const { error } = await this.db
        .from('mcp_oauth_grants')
        .update(record)
        .eq('id', params.grantId);
      if (error) {
        this.logger.error(`Grant rotation failed: ${error.message}`);
        throw new OAuthError(
          'server_error',
          'Could not rotate the grant.',
          500,
        );
      }
    } else {
      const { error } = await this.db.from('mcp_oauth_grants').insert(record);
      if (error) {
        this.logger.error(`Grant insert failed: ${error.message}`);
        throw new OAuthError(
          'server_error',
          'Could not record the grant.',
          500,
        );
      }
    }

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: params.scopes.join(' '),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
  }

  private async revokeChainIfRotated(hash: string): Promise<void> {
    const { data } = await this.db
      .from('mcp_oauth_grants')
      .select('id, user_id, client_id')
      .eq('rotated_from', hash)
      .maybeSingle();
    if (!data) return;

    const row = data as { id: string; user_id: string; client_id: string };
    this.logger.warn(
      `Rotated MCP refresh token replayed for client ${row.client_id}; revoking grant ${row.id}.`,
    );
    await this.db
      .from('mcp_oauth_grants')
      .update({
        revoked_at: new Date().toISOString(),
        refresh_token_hash: null,
      })
      .eq('id', row.id);
  }

  // ── /revoke (RFC 7009) ────────────────────────────────────────────────────

  /** Always succeeds from the caller's point of view, per RFC 7009 §2.2. */
  async revokeToken(body: RevokeRequestBody): Promise<void> {
    this.assertEnabled();
    const token = String(body?.token ?? '');
    if (!token.startsWith('mcpr_')) return;

    await this.db
      .from('mcp_oauth_grants')
      .update({
        revoked_at: new Date().toISOString(),
        refresh_token_hash: null,
      })
      .eq('refresh_token_hash', sha256(token))
      .is('revoked_at', null);
  }

  // ── Connected apps (settings UI) ──────────────────────────────────────────

  async listGrants(userId: string): Promise<GrantSummary[]> {
    const { data, error } = await this.db
      .from('mcp_oauth_grants')
      .select('id, client_name, client_id, scopes, last_used_at, created_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list connections: ${error.message}`);
    return (data ?? []) as GrantSummary[];
  }

  async revokeGrant(userId: string, grantId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('mcp_oauth_grants')
      .update({
        revoked_at: new Date().toISOString(),
        refresh_token_hash: null,
      })
      .eq('id', grantId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id');

    if (error) throw new Error(`Failed to revoke connection: ${error.message}`);
    return (data ?? []).length > 0;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pendingKey(id: string): string {
  return `mcp:oauth:pending:${id}`;
}

function codeKey(code: string): string {
  return `mcp:oauth:code:${sha256(code)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Keep only scopes this server actually understands; de-dupe, stable order. */
export function parseScopes(raw?: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const scope of raw.split(/[\s+]+/)) {
    const s = scope.trim();
    if (!s || seen.has(s)) continue;
    if (!OAUTH_SUPPORTED_SCOPES.includes(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** PKCE S256 verification, constant-time. */
export function verifyPkce(verifier: string, challenge: string): void {
  if (!verifier || verifier.length < 43 || verifier.length > 128) {
    throw OAuthError.invalidGrant('Invalid code_verifier.');
  }
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw OAuthError.invalidGrant('PKCE verification failed.');
  }
}

function appendQuery(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
