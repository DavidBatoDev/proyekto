import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { UPSTASH_REDIS_CLIENT } from '../../../../config/redis.tokens';
import { decryptToken, encryptToken, loadEncKey } from './token-crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
// calendar.events is the minimal scope to insert/patch/delete events with a Meet
// conferenceData request and attendees; openid+email yield the google_email cheaply.
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
// OAuth `state` lives this long in Redis between /connect and the callback.
const STATE_TTL_SECONDS = 600;
// Access tokens live ~1h; cache them (encrypted) until this many seconds before
// expiry so calendar views don't mint a fresh token on every request.
const ACCESS_TOKEN_EXPIRY_MARGIN_SECONDS = 60;
// Where the OAuth callback may send the user back to. Anything else falls back
// to the first entry, so `returnTo` can never become an open redirect.
export const GOOGLE_RETURN_PATHS = ['/meetings', '/settings/integrations'];

/**
 * Google rejected the stored refresh token (`invalid_grant`): the user revoked
 * access, changed their password, or the grant expired. The connection row has
 * already been deleted, so status reports `connected: false` and the user can
 * simply connect again.
 */
export class GoogleReconnectRequiredError extends ConflictException {
  constructor() {
    super({
      message:
        'Google Calendar access was revoked or expired. Reconnect Google Calendar to continue.',
      code: 'GOOGLE_RECONNECT_REQUIRED',
    });
  }
}

export interface OAuthState {
  userId: string;
  returnTo: string;
}

export interface GoogleConnectionRow {
  user_id: string;
  google_email: string | null;
  refresh_token: string;
  scope: string | null;
  token_type: string | null;
}

export interface GoogleConnectionStatus {
  enabled: boolean;
  connected: boolean;
  googleEmail?: string | null;
}

/**
 * Owns the per-user Google OAuth connection: the consent URL, the
 * code→token exchange, on-demand access-token refresh, and revoke/disconnect.
 * The long-lived refresh token is stored (encrypted) in
 * `google_calendar_connections` via the service-role client.
 *
 * Off unless configured: when GOOGLE_OAUTH_ENABLED / client id / secret are
 * unset, `isEnabled()` is false and the feature is invisible.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private warnedNoEncKey = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    @Inject(UPSTASH_REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  isEnabled(): boolean {
    return (
      this.config.get<string>('GOOGLE_OAUTH_ENABLED') === 'true' &&
      Boolean(this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID')) &&
      Boolean(this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET'))
    );
  }

  /** Build the Google consent URL and stash `state → {userId, returnTo}` in Redis. */
  async buildConsentUrl(userId: string, returnTo?: string): Promise<string> {
    const redis = this.requireRedis();
    const state = randomUUID();
    const payload: OAuthState = {
      userId,
      returnTo: this.safeReturnPath(returnTo),
    };
    await redis.set(this.stateKey(state), JSON.stringify(payload), {
      ex: STATE_TTL_SECONDS,
    });

    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('GOOGLE_OAUTH_CLIENT_ID'),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline', // ask for a refresh token
      prompt: 'consent', // force refresh-token re-issue every time
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /**
   * Read and delete the OAuth `state`. Returns null when it is unknown or
   * expired. Accepts the legacy form (a bare userId string) as well as the
   * current JSON `{userId, returnTo}`.
   */
  async consumeState(state: string): Promise<OAuthState | null> {
    const redis = this.requireRedis();
    const stateKey = this.stateKey(state);
    const raw = await redis.get<unknown>(stateKey);
    await redis.del(stateKey);
    return this.parseState(raw);
  }

  /** Exchange the callback code for tokens on behalf of `userId`. */
  async exchangeCode(
    code: string,
    userId: string,
  ): Promise<{
    userId: string;
    googleEmail: string | null;
    refreshToken: string;
    scope: string | null;
    tokenType: string | null;
  }> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.getOrThrow<string>('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: this.config.getOrThrow<string>(
        'GOOGLE_OAUTH_CLIENT_SECRET',
      ),
      redirect_uri: this.redirectUri(),
      grant_type: 'authorization_code',
    });
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Failed to exchange Google auth code (status ${response.status}): ${text}`,
      );
    }
    const json = (await response.json()) as {
      refresh_token?: string;
      scope?: string;
      token_type?: string;
      id_token?: string;
    };
    if (!json.refresh_token) {
      // Google omits refresh_token when the user already granted and consent
      // wasn't re-forced. We force prompt=consent, so this is unexpected.
      throw new BadRequestException(
        'Google did not return a refresh token. Remove Proyekto from your Google account permissions and reconnect.',
      );
    }
    return {
      userId,
      googleEmail: this.emailFromIdToken(json.id_token),
      refreshToken: json.refresh_token,
      scope: json.scope ?? null,
      tokenType: json.token_type ?? null,
    };
  }

  async storeConnection(connection: {
    userId: string;
    googleEmail: string | null;
    refreshToken: string;
    scope: string | null;
    tokenType: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .upsert(
        {
          user_id: connection.userId,
          google_email: connection.googleEmail,
          refresh_token: encryptToken(connection.refreshToken, this.encKey()),
          scope: connection.scope,
          token_type: connection.tokenType,
          connected_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id' },
      );
    if (error) throw new Error(error.message);
  }

  async getConnection(userId: string): Promise<GoogleConnectionRow | null> {
    const { data, error } = await this.supabase
      .from('google_calendar_connections')
      .select('user_id, google_email, refresh_token, scope, token_type')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as GoogleConnectionRow) || null;
  }

  async isConnected(userId: string): Promise<boolean> {
    return (await this.getConnection(userId)) !== null;
  }

  async getStatus(userId: string): Promise<GoogleConnectionStatus> {
    if (!this.isEnabled()) return { enabled: false, connected: false };
    const conn = await this.getConnection(userId);
    return {
      enabled: true,
      connected: conn !== null,
      googleEmail: conn?.google_email ?? null,
    };
  }

  /**
   * An access token for `userId`: the cached one when it is still valid,
   * otherwise a fresh one minted from the stored refresh token (then cached).
   * Throws `GoogleReconnectRequiredError` when Google rejects the grant.
   */
  async getAccessToken(userId: string): Promise<string> {
    const cached = await this.readCachedAccessToken(userId);
    if (cached) return cached;

    const conn = await this.getConnection(userId);
    if (!conn) {
      throw new BadRequestException('Google account is not connected.');
    }
    const refreshToken = decryptToken(conn.refresh_token, this.encKey());
    const body = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: this.config.getOrThrow<string>(
        'GOOGLE_OAUTH_CLIENT_SECRET',
      ),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (this.isInvalidGrant(response.status, text)) {
        this.logger.warn(
          `Google refresh token rejected for ${userId} (invalid_grant); removing the connection.`,
        );
        await this.removeConnection(userId);
        throw new GoogleReconnectRequiredError();
      }
      throw new Error(
        `Failed to refresh Google access token (status ${response.status}): ${text}`,
      );
    }
    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) {
      throw new Error('Google token response missing access_token');
    }
    await this.cacheAccessToken(userId, json.access_token, json.expires_in);
    return json.access_token;
  }

  /** Drop the cached access token (e.g. after Google answered 401 with it). */
  async invalidateAccessToken(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.accessTokenKey(userId));
    } catch (err) {
      this.logger.warn(
        `Could not clear cached Google token for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  /** Best-effort revoke, then delete the connection row. Never throws on revoke. */
  async disconnect(userId: string): Promise<void> {
    const conn = await this.getConnection(userId);
    if (conn) {
      try {
        const refreshToken = decryptToken(conn.refresh_token, this.encKey());
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch (err) {
        // The token may already be invalid — proceed to delete the row anyway.
        this.logger.warn(
          `Google token revoke failed for ${userId}: ${(err as Error).message}`,
        );
      }
    }
    await this.removeConnection(userId);
  }

  /** Clamp a requested return path to the allowlist. */
  safeReturnPath(returnTo?: string | null): string {
    return returnTo && GOOGLE_RETURN_PATHS.includes(returnTo)
      ? returnTo
      : GOOGLE_RETURN_PATHS[0];
  }

  /** Delete the connection row and any cached access token. */
  private async removeConnection(userId: string): Promise<void> {
    await this.invalidateAccessToken(userId);
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .delete()
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  private parseState(raw: unknown): OAuthState | null {
    if (!raw) return null;
    let value: unknown = raw;
    // Upstash deserializes JSON automatically; a legacy bare userId (or a
    // client with deserialization off) arrives as a string.
    if (typeof value === 'string') {
      const text = value;
      try {
        value = JSON.parse(text);
      } catch {
        return { userId: text, returnTo: GOOGLE_RETURN_PATHS[0] };
      }
      if (typeof value === 'string') {
        return { userId: value, returnTo: GOOGLE_RETURN_PATHS[0] };
      }
    }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Partial<OAuthState>;
      if (typeof obj.userId === 'string' && obj.userId) {
        return {
          userId: obj.userId,
          returnTo: this.safeReturnPath(obj.returnTo),
        };
      }
    }
    return null;
  }

  private isInvalidGrant(status: number, body: string): boolean {
    if (status !== 400 && status !== 401) return false;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      return parsed.error === 'invalid_grant';
    } catch {
      return body.includes('invalid_grant');
    }
  }

  private async readCachedAccessToken(userId: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const stored = await this.redis.get<string>(this.accessTokenKey(userId));
      if (!stored || typeof stored !== 'string') return null;
      return decryptToken(stored, this.encKey());
    } catch (err) {
      this.logger.warn(
        `Ignoring unreadable cached Google token for ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async cacheAccessToken(
    userId: string,
    accessToken: string,
    expiresIn?: number,
  ): Promise<void> {
    if (!this.redis || !expiresIn) return;
    const ttl = Math.floor(expiresIn - ACCESS_TOKEN_EXPIRY_MARGIN_SECONDS);
    if (ttl <= 0) return;
    try {
      await this.redis.set(
        this.accessTokenKey(userId),
        encryptToken(accessToken, this.encKey()),
        { ex: ttl },
      );
    } catch (err) {
      this.logger.warn(
        `Could not cache Google token for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private accessTokenKey(userId: string): string {
    return `gcal:token:${userId}`;
  }

  private redirectUri(): string {
    return this.config.getOrThrow<string>('GOOGLE_OAUTH_REDIRECT_URI');
  }

  private encKey(): string | undefined {
    const key = this.config.get<string>('GOOGLE_TOKEN_ENC_KEY');
    if (!loadEncKey(key) && !this.warnedNoEncKey) {
      this.warnedNoEncKey = true;
      this.logger.warn(
        'GOOGLE_TOKEN_ENC_KEY is not set (or not 32 bytes) — Google refresh tokens are stored in plaintext. Set it in production.',
      );
    }
    return key;
  }

  private stateKey(state: string): string {
    return `gcal:oauth:state:${state}`;
  }

  /** Decode the `email` claim from Google's id_token (no signature check needed —
   * it came straight from the token endpoint over TLS). */
  private emailFromIdToken(idToken?: string): string | null {
    if (!idToken) return null;
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64').toString('utf8'),
      ) as { email?: string };
      return payload.email ?? null;
    } catch {
      return null;
    }
  }

  private requireRedis(): Redis {
    if (this.redis) return this.redis;
    throw new ServiceUnavailableException(
      'Google sign-in is unavailable: Redis is not configured.',
    );
  }
}
