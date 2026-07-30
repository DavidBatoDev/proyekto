import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type MailSender,
  resolveAllSenders,
  resolveSender,
} from './mail-senders';

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Recommended — some clients render nothing else. */
  text?: string;
  /**
   * Which identity this goes out as. Defaults to `noreply` so existing callers
   * keep compiling; every call site should name one deliberately.
   */
  sender?: MailSender;
  /**
   * The tenant this is sent for — an agency name, typically
   * `contract.provider_name`. Becomes `"Acme Studio (via Proyekto)"` in the
   * display name. The address itself never changes: we can only authenticate
   * domains we control. Pair it with `replyTo` so replies reach the agency.
   */
  onBehalfOf?: string | null;
  /** Per-send Reply-To, e.g. the agency actually billing the client. */
  replyTo?: string;
  /**
   * Extra RFC 5322 headers, e.g. `List-Unsubscribe` — Gmail weighs it for
   * inbox placement on transactional mail. Values are CRLF-stripped like
   * every other header; `To`/`From`/`Subject`/`MIME-Version`/`Content-Type`
   * are owned by the builder and cannot be overridden here.
   */
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
  /** Resolved recipient, echoed so callers can report it without re-deriving. */
  to?: string;
}

export interface MailDiagnostics {
  configured: boolean;
  credentials: {
    client_id: boolean;
    client_secret: boolean;
    refresh_token: boolean;
  };
  token: { ok: true } | { ok: false; error: string; hint: string };
  senders: Record<MailSender, string | null>;
  checked_at: string;
}

/**
 * Outbound transactional email over the Gmail API.
 *
 * Delivery is best-effort by design: the caller's write has already been
 * committed by the time we get here, so a missing credential or a Gmail
 * outage must never fail the request. Every path returns a
 * `{ sent, reason }` the caller can surface instead of throwing.
 *
 * Callers that MUST NOT report success on a failed send (the OTP paths) check
 * `result.sent` and throw themselves — do not make this service throw.
 *
 * This is the single seam for outbound mail: swapping Gmail for an ESP means
 * replacing `deliver()` and `accessToken()` here, and nothing at any call site.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  /**
   * Cached OAuth access token. Gmail issues these with a 3600s life and every
   * send previously burned a second round trip minting a fresh one.
   */
  private tokenCache: { token: string; expiresAtMs: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  /** True when Gmail OAuth credentials are present. */
  isConfigured(): boolean {
    return Boolean(
      this.credential('GMAIL_CLIENT_ID', 'GOOGLE_CLIENT_ID') &&
      this.credential('GMAIL_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET') &&
      this.credential('GMAIL_REFRESH_TOKEN', 'GOOGLE_REFRESH_TOKEN'),
    );
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    const clientId = this.credential('GMAIL_CLIENT_ID', 'GOOGLE_CLIENT_ID');
    const clientSecret = this.credential(
      'GMAIL_CLIENT_SECRET',
      'GOOGLE_CLIENT_SECRET',
    );
    const refreshToken = this.credential(
      'GMAIL_REFRESH_TOKEN',
      'GOOGLE_REFRESH_TOKEN',
    );
    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.warn(
        'MailerService: Gmail credentials not configured (set GMAIL_* or GOOGLE_* env vars)',
      );
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
      const raw = this.buildRaw(input);
      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        // 401 means the cached token went stale early (revoked, or the mailbox
        // changed password). Drop it so the next send re-mints instead of
        // replaying a dead token until the cache expires on its own.
        if (res.status === 401) this.tokenCache = null;
        this.logger.warn(
          `MailerService: Gmail API error for ${input.to}: ${err}`,
        );
        return {
          sent: false,
          reason: `Gmail rejected the message (${res.status}).`,
          to: input.to,
        };
      }
      const { id } = (await res.json()) as { id: string };
      this.logger.log(
        `MailerService: sent to ${input.to} as ${input.sender ?? 'noreply'} (messageId=${id})`,
      );
      return { sent: true, messageId: id, to: input.to };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`MailerService: failed for ${input.to}: ${message}`);
      return { sent: false, reason: `Email send failed: ${message}`, to: input.to };
    }
  }

  /**
   * Credential + token health, for `GET /api/health/mail`.
   *
   * Refreshes the token but never sends, so it is safe to poll. Returns
   * booleans and addresses only — never a credential value.
   */
  async diagnostics(): Promise<MailDiagnostics> {
    const clientId = this.credential('GMAIL_CLIENT_ID', 'GOOGLE_CLIENT_ID');
    const clientSecret = this.credential(
      'GMAIL_CLIENT_SECRET',
      'GOOGLE_CLIENT_SECRET',
    );
    const refreshToken = this.credential(
      'GMAIL_REFRESH_TOKEN',
      'GOOGLE_REFRESH_TOKEN',
    );
    const credentials = {
      client_id: Boolean(clientId),
      client_secret: Boolean(clientSecret),
      refresh_token: Boolean(refreshToken),
    };
    const senders = resolveAllSenders(this.config);
    const checked_at = new Date().toISOString();

    if (!clientId || !clientSecret || !refreshToken) {
      return {
        configured: false,
        credentials,
        token: {
          ok: false,
          error: 'Gmail OAuth credentials are not configured.',
          hint: 'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN.',
        },
        senders,
        checked_at,
      };
    }

    try {
      // Bypass the cache — a cached token would report healthy for up to an
      // hour after the refresh token was revoked, which is the exact failure
      // this endpoint exists to catch.
      this.tokenCache = null;
      await this.accessToken(clientId, clientSecret, refreshToken);
      return { configured: true, credentials, token: { ok: true }, senders, checked_at };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        configured: true,
        credentials,
        token: { ok: false, error, hint: hintFor(error) },
        senders,
        checked_at,
      };
    }
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

  /**
   * RFC 2822 message, base64url-encoded as the Gmail API expects.
   *
   * With attachments the structure is multipart/mixed wrapping a
   * multipart/alternative body — the shape every mail client understands.
   */
  private buildRaw(input: SendMailInput): string {
    // resolveSender walks MAIL_FROM_<SENDER> → GMAIL_FROM_EMAIL →
    // INVITE_FROM_EMAIL and returns null when none is set, in which case the
    // header is omitted and Gmail sends as the authenticated account. That is
    // the sane default, so an unconfigured deploy still delivers mail.
    const from = resolveSender(
      this.config,
      input.sender ?? 'noreply',
      input.onBehalfOf,
    ).header;
    const text = input.text ?? stripHtml(input.html);
    const altBoundary = `alt_${Date.now().toString(36)}`;
    const mixedBoundary = `mix_${Date.now().toString(36)}`;
    const attachments = input.attachments ?? [];

    const body: string[] = [
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      text,
      '',
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.html,
      '',
      `--${altBoundary}--`,
      '',
    ];

    // Headers the builder owns; a caller-supplied override would either
    // corrupt the MIME structure or spoof the sender.
    const RESERVED = new Set([
      'to',
      'from',
      'subject',
      'mime-version',
      'content-type',
      'content-transfer-encoding',
    ]);
    const extra = Object.entries(input.headers ?? {})
      .filter(([name]) => !RESERVED.has(name.toLowerCase()))
      .map(([name, value]) => `${header(name)}: ${header(value)}`);

    const headers: string[] = [
      `To: ${header(input.to)}`,
      from ? `From: ${header(from)}` : null,
      input.replyTo ? `Reply-To: ${header(input.replyTo)}` : null,
      `Subject: ${header(input.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      ...extra,
    ].filter((line): line is string => line !== null);

    if (attachments.length === 0) {
      return base64url(
        [
          ...headers,
          `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
          '',
          ...body,
        ].join('\r\n'),
      );
    }

    const parts: string[] = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...body,
    ];
    for (const attachment of attachments) {
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${attachment.contentType}; name="${header(attachment.filename)}"`,
        `Content-Disposition: attachment; filename="${header(attachment.filename)}"`,
        'Content-Transfer-Encoding: base64',
        '',
        // Gmail requires the payload wrapped at a sane line length.
        attachment.content.toString('base64').replace(/(.{76})/g, '$1\r\n'),
        '',
      );
    }
    parts.push(`--${mixedBoundary}--`, '');
    return base64url(parts.join('\r\n'));
  }
}

/**
 * Turn a raw OAuth error into something actionable in the health endpoint.
 * `invalid_grant` is by far the common one and its cause is almost always the
 * consent screen sitting in Testing mode, which expires tokens after ~7 days.
 */
function hintFor(error: string): string {
  if (error.includes('invalid_grant')) {
    return 'The refresh token is expired or revoked. Publish the OAuth consent screen (Testing mode expires tokens after ~7 days), re-mint GMAIL_REFRESH_TOKEN, and update the secret. See docs/12-runbooks/google-oauth-email.md.';
  }
  if (error.includes('invalid_client')) {
    return 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET do not match the OAuth client that issued the refresh token.';
  }
  return 'See docs/12-runbooks/google-oauth-email.md.';
}

/** Header values must never carry a newline — that is header injection. */
function header(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function base64url(raw: string): string {
  return Buffer.from(raw).toString('base64url');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
