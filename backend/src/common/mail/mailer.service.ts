import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  attachments?: MailAttachment[];
}

export interface SendMailResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

/**
 * Outbound transactional email over the Gmail API.
 *
 * Delivery is best-effort by design: the caller's write has already been
 * committed by the time we get here, so a missing credential or a Gmail
 * outage must never fail the request. Every path returns a
 * `{ sent, reason }` the caller can surface instead of throwing.
 *
 * NOTE: `ProjectsService.sendInviteEmail` still carries its own copy of this
 * Gmail plumbing. Folding it into this service is worthwhile but touches the
 * invite flow, so it was left alone here.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

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
        this.logger.warn(
          `MailerService: Gmail API error for ${input.to}: ${err}`,
        );
        return {
          sent: false,
          reason: `Gmail rejected the message (${res.status}).`,
        };
      }
      const { id } = (await res.json()) as { id: string };
      this.logger.log(`MailerService: sent to ${input.to} (messageId=${id})`);
      return { sent: true, messageId: id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`MailerService: failed for ${input.to}: ${message}`);
      return { sent: false, reason: `Email send failed: ${message}` };
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
    const { access_token } = (await res.json()) as { access_token: string };
    return access_token;
  }

  /**
   * RFC 2822 message, base64url-encoded as the Gmail API expects.
   *
   * With attachments the structure is multipart/mixed wrapping a
   * multipart/alternative body — the shape every mail client understands.
   */
  private buildRaw(input: SendMailInput): string {
    // GMAIL_FROM_EMAIL is the registered name in env.validation.ts;
    // INVITE_FROM_EMAIL is the older one ProjectsService reads. When neither
    // is set the header is omitted and Gmail sends as the authenticated
    // account, which is the sane default — so this is optional on purpose.
    const from =
      this.config.get<string>('GMAIL_FROM_EMAIL') ??
      this.config.get<string>('INVITE_FROM_EMAIL') ??
      '';
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

    const headers: string[] = [
      `To: ${header(input.to)}`,
      from ? `From: ${header(from)}` : null,
      `Subject: ${header(input.subject)}`,
      'MIME-Version: 1.0',
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
