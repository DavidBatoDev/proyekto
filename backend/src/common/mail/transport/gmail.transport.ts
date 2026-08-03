import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MailTransport,
  OutboundMessage,
  TransportDiagnostics,
  TransportSendResult,
} from './mail-transport';

/**
 * Gmail API transport (OAuth2 refresh-token, `gmail.send` scope).
 *
 * Accepts either the `GMAIL_*` or the legacy `GOOGLE_*` credential names — both
 * have been in use across deploys, and dropping the fallback would silently
 * unconfigure any environment still on the old names.
 */
@Injectable()
export class GmailTransport implements MailTransport {
  readonly name = 'gmail';

  private readonly logger = new Logger(GmailTransport.name);

  /**
   * Cached OAuth access token. Gmail issues these with a 3600s life and every
   * send previously burned a second round trip minting a fresh one.
   */
  private tokenCache: { token: string; expiresAtMs: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const { clientId, clientSecret, refreshToken } = this.credentials();
    return Boolean(clientId && clientSecret && refreshToken);
  }

  async deliver(message: OutboundMessage): Promise<TransportSendResult> {
    const { clientId, clientSecret, refreshToken } = this.credentials();
    if (!clientId || !clientSecret || !refreshToken) {
      return {
        sent: false,
        reason:
          'Email service is not configured on the server (missing Gmail OAuth credentials).',
      };
    }

    try {
      const accessToken = await this.accessToken(
        clientId,
        clientSecret,
        refreshToken,
      );
      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: message.raw }),
        },
      );

      if (!res.ok) {
        const err = await res.text();
        // 401 means the cached token went stale early (revoked, or the mailbox
        // changed password). Drop it so the next send re-mints instead of
        // replaying a dead token until the cache expires on its own.
        if (res.status === 401) this.tokenCache = null;
        this.logger.warn(`Gmail API error for ${message.to}: ${err}`);
        return {
          sent: false,
          reason: `Gmail rejected the message (${res.status}).`,
        };
      }

      const { id } = (await res.json()) as { id: string };
      return { sent: true, messageId: id };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { sent: false, reason: `Email send failed: ${reason}` };
    }
  }

  async diagnostics(): Promise<TransportDiagnostics> {
    const { clientId, clientSecret, refreshToken } = this.credentials();
    const credentials = {
      client_id: Boolean(clientId),
      client_secret: Boolean(clientSecret),
      refresh_token: Boolean(refreshToken),
    };

    if (!clientId || !clientSecret || !refreshToken) {
      return {
        configured: false,
        credentials,
        auth: {
          ok: false,
          error: 'Gmail OAuth credentials are not configured.',
          hint: 'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN.',
        },
      };
    }

    try {
      // Bypass the cache — a cached token would report healthy for up to an
      // hour after the refresh token was revoked, which is the exact failure
      // this endpoint exists to catch.
      this.tokenCache = null;
      await this.accessToken(clientId, clientSecret, refreshToken);
      return { configured: true, credentials, auth: { ok: true } };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        configured: true,
        credentials,
        auth: { ok: false, error, hint: hintFor(error) },
      };
    }
  }

  private credentials() {
    return {
      clientId: this.credential('GMAIL_CLIENT_ID', 'GOOGLE_CLIENT_ID'),
      clientSecret: this.credential(
        'GMAIL_CLIENT_SECRET',
        'GOOGLE_CLIENT_SECRET',
      ),
      refreshToken: this.credential(
        'GMAIL_REFRESH_TOKEN',
        'GOOGLE_REFRESH_TOKEN',
      ),
    };
  }

  private credential(primary: string, fallback: string): string | undefined {
    return (
      this.config.get<string>(primary) ?? this.config.get<string>(fallback)
    );
  }

  private async accessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAtMs > now) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Gmail token refresh failed: ${await res.text()}`);
    }
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    // 60s safety margin so a token can't expire mid-flight between the cache
    // check and Gmail receiving the request.
    const lifetimeMs = Math.max(0, ((expires_in ?? 3600) - 60) * 1000);
    this.tokenCache = { token: access_token, expiresAtMs: now + lifetimeMs };
    return access_token;
  }
}

/**
 * Turn a raw OAuth error into something actionable in the health endpoint.
 *
 * The two failures look alike and have opposite fixes: `invalid_client` means
 * the secret was rotated (re-download the client JSON, leave the refresh token
 * alone), while `invalid_grant` means the token itself is dead (mint a new one,
 * which invalidates the current one). Minting on an `invalid_client` takes down
 * working mail to replace a token that was fine.
 */
function hintFor(error: string): string {
  if (error.includes('invalid_grant')) {
    return 'The refresh token is expired or revoked. Publish the OAuth consent screen (Testing mode expires tokens after ~7 days), re-mint GMAIL_REFRESH_TOKEN, and update the secret. See docs/12-runbooks/google-oauth-email.md.';
  }
  if (error.includes('invalid_client')) {
    return 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET do not match — the client secret was most likely rotated in Google Cloud. Re-download the client JSON; the refresh token is fine. See docs/12-runbooks/google-oauth-email.md.';
  }
  return 'See docs/12-runbooks/google-oauth-email.md.';
}
