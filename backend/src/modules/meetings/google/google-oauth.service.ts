import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import { decryptToken, encryptToken, loadEncKey } from './token-crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
// calendar.events is the minimal scope to insert/patch/delete events with a Meet
// conferenceData request and attendees; openid+email yield the google_email cheaply.
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
// OAuth `state` lives this long in Redis between /connect and the callback.
const STATE_TTL_SECONDS = 600;

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
 * Ships dark: when GOOGLE_OAUTH_ENABLED / client id / secret are unset,
 * `isEnabled()` is false and the feature is invisible.
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

  /** Build the Google consent URL and stash `state → userId` in Redis. */
  async buildConsentUrl(userId: string): Promise<string> {
    const redis = this.requireRedis();
    const state = randomUUID();
    await redis.set(this.stateKey(state), userId, { ex: STATE_TTL_SECONDS });

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

  /** Exchange the callback code for tokens; resolves the userId from `state`. */
  async exchangeCode(
    code: string,
    state: string,
  ): Promise<{
    userId: string;
    googleEmail: string | null;
    refreshToken: string;
    scope: string | null;
    tokenType: string | null;
  }> {
    const redis = this.requireRedis();
    const stateKey = this.stateKey(state);
    const userId = await redis.get<string>(stateKey);
    await redis.del(stateKey);
    if (!userId) {
      throw new BadRequestException(
        'The Google sign-in session expired. Try again.',
      );
    }

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

  /** Mint a fresh access token from the stored refresh token (per-request). */
  async getAccessToken(userId: string): Promise<string> {
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
      throw new Error(
        `Failed to refresh Google access token (status ${response.status}): ${text}`,
      );
    }
    const json = (await response.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new Error('Google token response missing access_token');
    }
    return json.access_token;
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
    const { error } = await this.supabase
      .from('google_calendar_connections')
      .delete()
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
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
