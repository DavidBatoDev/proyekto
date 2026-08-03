import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_TRANSPORT, type MailTransport } from './transport/mail-transport';
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
 * Outbound transactional email.
 *
 * Delivery is best-effort by design: the caller's write has already been
 * committed by the time we get here, so a missing credential or a provider
 * outage must never fail the request. Every path returns a
 * `{ sent, reason }` the caller can surface instead of throwing.
 *
 * Callers that MUST NOT report success on a failed send (the OTP paths) check
 * `result.sent` and throw themselves — do not make this service throw.
 *
 * This is the single seam for outbound mail. It owns everything
 * provider-agnostic — sender identity, MIME assembly, header hygiene — and
 * delegates the last step to a `MailTransport`, so swapping Gmail for an ESP is
 * a new transport plus an env var and nothing at any call site.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  /** True when the active transport's credentials are present. */
  isConfigured(): boolean {
    return this.transport.isConfigured();
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    if (!this.transport.isConfigured()) {
      this.logger.warn(
        `MailerService: ${this.transport.name} transport is not configured`,
      );
      return {
        sent: false,
        reason:
          'Email service is not configured on the server (missing Gmail OAuth credentials).',
      };
    }

    const result = await this.transport.deliver({
      raw: this.buildRaw(input),
      to: input.to,
      subject: input.subject,
    });

    if (!result.sent) {
      this.logger.warn(
        `MailerService: failed for ${input.to}: ${result.reason ?? 'unknown error'}`,
      );
      return { sent: false, reason: result.reason, to: input.to };
    }

    this.logger.log(
      `MailerService: sent to ${input.to} as ${input.sender ?? 'noreply'} (messageId=${result.messageId})`,
    );
    return { sent: true, messageId: result.messageId, to: input.to };
  }

  /**
   * Credential + transport health, for `GET /api/health/mail`.
   *
   * Re-checks provider auth but never sends, so it is safe to poll. Returns
   * booleans and addresses only — never a credential value.
   */
  async diagnostics(): Promise<MailDiagnostics> {
    const health = await this.transport.diagnostics();
    return {
      configured: health.configured,
      credentials: {
        client_id: health.credentials.client_id ?? false,
        client_secret: health.credentials.client_secret ?? false,
        refresh_token: health.credentials.refresh_token ?? false,
      },
      token: health.auth,
      senders: resolveAllSenders(this.config),
      checked_at: new Date().toISOString(),
    };
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
