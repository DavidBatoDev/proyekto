import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import { OAuthError } from './oauth-error';
import type {
  RegisterRequestBody,
  ResolvedOAuthClient,
} from './dto/oauth.types';

const CIMD_CACHE_TTL_SECONDS = 3600;
const CIMD_FETCH_TIMEOUT_MS = 5000;
const CIMD_MAX_BYTES = 64 * 1024;

/**
 * Resolves the OAuth client behind an /authorize or /token call.
 *
 * Two mechanisms, matching what Claude actually does (pre-registration → CIMD →
 * DCR):
 *
 *  - **CIMD** (preferred): the `client_id` IS an https URL pointing at a Client
 *    ID Metadata Document. We fetch it, verify it is self-consistent, and cache
 *    it — no database row, and no unbounded client table. Claude Code identifies
 *    itself this way (https://claude.ai/oauth/claude-code-client-metadata).
 *  - **DCR** (RFC 7591 fallback): the client POSTs its metadata to /oauth/register
 *    and we persist it in mcp_oauth_clients.
 */
@Injectable()
export class OAuthClientService {
  private readonly logger = new Logger(OAuthClientService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    @Inject(UPSTASH_REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  private requireRedis(): Redis {
    if (!this.redis) {
      // Fail closed. An in-memory fallback is broken by construction at
      // --max-instances=20, and OAuth state must be single-use across instances.
      throw new OAuthError(
        'temporarily_unavailable',
        'Authorization storage is unavailable.',
        503,
      );
    }
    return this.redis;
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  async resolve(clientId: string): Promise<ResolvedOAuthClient> {
    if (!clientId) {
      throw OAuthError.invalidClient('Missing client_id.');
    }
    if (clientId.startsWith('https://')) {
      return this.resolveCimd(clientId);
    }
    return this.resolveRegistered(clientId);
  }

  private async resolveRegistered(
    clientId: string,
  ): Promise<ResolvedOAuthClient> {
    const { data, error } = await this.db
      .from('mcp_oauth_clients')
      .select(
        'client_id, client_name, redirect_uris, token_endpoint_auth_method, client_secret_hash',
      )
      .eq('client_id', clientId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`OAuth client lookup failed: ${error.message}`);
      throw OAuthError.invalidClient('Unknown client.');
    }
    if (!data) throw OAuthError.invalidClient('Unknown client.');

    const row = data as {
      client_id: string;
      client_name: string | null;
      redirect_uris: string[] | null;
      token_endpoint_auth_method: string;
      client_secret_hash: string | null;
    };

    return {
      client_id: row.client_id,
      client_name: row.client_name ?? 'Unnamed application',
      redirect_uris: row.redirect_uris ?? [],
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      client_secret_hash: row.client_secret_hash,
      source: 'dcr',
    };
  }

  // ── CIMD ──────────────────────────────────────────────────────────────────

  private cimdKey(url: string): string {
    return `mcp:oauth:cimd:${createHash('sha256').update(url).digest('hex')}`;
  }

  private async resolveCimd(url: string): Promise<ResolvedOAuthClient> {
    const redis = this.requireRedis();
    const key = this.cimdKey(url);

    const cached = await redis.get<ResolvedOAuthClient>(key);
    if (cached) return cached;

    await this.assertFetchableUrl(url);

    let body: unknown;
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw OAuthError.invalidClient(
          `Client metadata document returned ${res.status}.`,
        );
      }
      const text = await res.text();
      if (text.length > CIMD_MAX_BYTES) {
        throw OAuthError.invalidClient(
          'Client metadata document is too large.',
        );
      }
      body = JSON.parse(text);
    } catch (err) {
      if (err instanceof OAuthError) throw err;
      this.logger.warn(
        `CIMD fetch failed for ${url}: ${err instanceof Error ? err.message : err}`,
      );
      throw OAuthError.invalidClient(
        'Could not fetch client metadata document.',
      );
    }

    const doc = body as RegisterRequestBody & { client_id?: string };

    // Self-consistency: the document must claim the very URL it was served from,
    // otherwise anyone could host a document impersonating another client.
    if (doc.client_id !== url) {
      throw OAuthError.invalidClient(
        'Client metadata document client_id does not match its URL.',
      );
    }

    const redirectUris = Array.isArray(doc.redirect_uris)
      ? doc.redirect_uris.filter((u): u is string => typeof u === 'string')
      : [];
    if (redirectUris.length === 0) {
      throw OAuthError.invalidClient(
        'Client metadata document declares no redirect_uris.',
      );
    }

    const resolved: ResolvedOAuthClient = {
      client_id: url,
      client_name:
        typeof doc.client_name === 'string' && doc.client_name
          ? doc.client_name
          : new URL(url).hostname,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      source: 'cimd',
    };

    await redis.set(key, resolved, { ex: CIMD_CACHE_TTL_SECONDS });
    return resolved;
  }

  /** SSRF guard: https only, public destinations only, no redirects followed. */
  private async assertFetchableUrl(raw: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw OAuthError.invalidClient('Malformed client metadata URL.');
    }
    if (url.protocol !== 'https:') {
      throw OAuthError.invalidClient('Client metadata URL must be https.');
    }

    const host = url.hostname;
    const addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true }).catch(() => {
          throw OAuthError.invalidClient(
            'Client metadata host does not resolve.',
          );
        });

    for (const { address } of addresses) {
      if (isPrivateAddress(address)) {
        throw OAuthError.invalidClient(
          'Client metadata URL resolves to a non-public address.',
        );
      }
    }
  }

  // ── DCR ───────────────────────────────────────────────────────────────────

  /**
   * RFC 7591 open registration. Claude registers a fresh public client per
   * connection when CIMD is unavailable, so this must stay cheap and is
   * rate-limited at the controller.
   */
  async register(body: RegisterRequestBody): Promise<Record<string, unknown>> {
    const redirectUris = Array.isArray(body?.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
      : [];
    if (redirectUris.length === 0) {
      throw new OAuthError(
        'invalid_client_metadata',
        'redirect_uris is required.',
      );
    }
    for (const uri of redirectUris) {
      assertUsableRedirectUri(uri);
    }

    const authMethod =
      body.token_endpoint_auth_method === 'client_secret_post' ||
      body.token_endpoint_auth_method === 'client_secret_basic'
        ? body.token_endpoint_auth_method
        : 'none';

    const clientId = `mcp_${randomBytes(24).toString('base64url')}`;
    const clientSecret =
      authMethod === 'none' ? null : randomBytes(32).toString('base64url');

    const { error } = await this.db.from('mcp_oauth_clients').insert({
      client_id: clientId,
      client_name:
        typeof body.client_name === 'string' && body.client_name
          ? body.client_name.slice(0, 200)
          : 'Unnamed application',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: typeof body.scope === 'string' ? body.scope : null,
      token_endpoint_auth_method: authMethod,
      client_secret_hash: clientSecret ? sha256(clientSecret) : null,
      client_uri: typeof body.client_uri === 'string' ? body.client_uri : null,
      logo_uri: typeof body.logo_uri === 'string' ? body.logo_uri : null,
      software_id:
        typeof body.software_id === 'string' ? body.software_id : null,
      software_version:
        typeof body.software_version === 'string'
          ? body.software_version
          : null,
    });

    if (error) {
      this.logger.error(`DCR insert failed: ${error.message}`);
      throw new OAuthError('server_error', 'Could not register client.', 500);
    }

    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_name: body.client_name ?? 'Unnamed application',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: authMethod,
    };
  }

  /**
   * Confidential-client check at the token endpoint. Public clients (the norm —
   * both CIMD and DCR register Claude as public) are authenticated by PKCE alone.
   */
  assertClientAuthenticated(
    client: ResolvedOAuthClient,
    presentedSecret?: string,
  ): void {
    if (client.token_endpoint_auth_method === 'none') return;
    if (!presentedSecret || !client.client_secret_hash) {
      throw OAuthError.invalidClient('Client authentication failed.');
    }
    if (sha256(presentedSecret) !== client.client_secret_hash) {
      throw OAuthError.invalidClient('Client authentication failed.');
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Redirect-URI matching. Exact string match, EXCEPT loopback addresses, where
 * RFC 8252 §7.3 requires the port to be ignored — Claude Code binds an ephemeral
 * port per session and declares only `http://localhost/callback` and
 * `http://127.0.0.1/callback` in its metadata document.
 */
export function redirectUriMatches(
  registered: readonly string[],
  presented: string,
): boolean {
  if (registered.includes(presented)) return true;

  let candidate: URL;
  try {
    candidate = new URL(presented);
  } catch {
    return false;
  }
  if (!isLoopbackHost(candidate.hostname)) return false;

  return registered.some((raw) => {
    let known: URL;
    try {
      known = new URL(raw);
    } catch {
      return false;
    }
    return (
      isLoopbackHost(known.hostname) &&
      known.protocol === candidate.protocol &&
      known.hostname === candidate.hostname &&
      known.pathname === candidate.pathname
    );
  });
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

/** Reject redirect URIs we will never be able to honour safely. */
export function assertUsableRedirectUri(uri: string): void {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new OAuthError(
      'invalid_redirect_uri',
      `Malformed redirect_uri: ${uri}`,
    );
  }
  if (url.hash) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uri must not contain a fragment.',
    );
  }
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return;
  throw new OAuthError(
    'invalid_redirect_uri',
    'redirect_uri must be https, or http on a loopback address.',
  );
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const v6 = address.toLowerCase();
    return (
      v6 === '::1' ||
      v6.startsWith('fc') ||
      v6.startsWith('fd') ||
      v6.startsWith('fe80') ||
      v6.startsWith('::ffff:127.') ||
      v6.startsWith('::ffff:10.') ||
      v6.startsWith('::ffff:192.168.')
    );
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}
