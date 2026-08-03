/**
 * The provider boundary for outbound mail.
 *
 * `MailerService` owns everything provider-agnostic — sender identity, MIME
 * assembly, header hygiene, the `{ sent, reason }` contract callers depend on.
 * A transport owns only the last step: handing a finished message to whoever
 * actually delivers it, and reporting whether its credentials work.
 *
 * This exists because Gmail is a known-temporary choice. It has no bounce
 * webhook, no complaint feedback loop and no suppression list, so the first
 * high-volume mail stream (notification email) will force a move to a real ESP.
 * When that happens the change should be one new file plus an env var, not a
 * rewrite of every call site — which is exactly what MailerService's own
 * doc comment has always promised.
 */

export interface OutboundMessage {
  /**
   * The complete RFC 5322 message, base64url-encoded.
   *
   * Providers that accept raw MIME (Gmail, SES `SendRawEmail`) can forward this
   * as-is. A provider that only accepts a structured payload will need the
   * fields below plus a body it can render — cross that bridge when a second
   * transport actually lands, rather than guessing at the shape now.
   */
  raw: string;
  /** Resolved recipient. Carried separately for structured providers and logs. */
  to: string;
  subject: string;
}

export interface TransportSendResult {
  sent: boolean;
  messageId?: string;
  /** Human-readable failure, surfaced to callers via `SendMailResult.reason`. */
  reason?: string;
}

export interface TransportDiagnostics {
  /** Are the provider credentials present at all? */
  configured: boolean;
  /** Per-credential presence, for the admin health endpoint. Never values. */
  credentials: Record<string, boolean>;
  /** Whether the provider currently accepts those credentials. */
  auth: { ok: true } | { ok: false; error: string; hint: string };
}

export interface MailTransport {
  /** Identifier for logs and the health endpoint, e.g. `'gmail'`. */
  readonly name: string;

  /** True when the credentials needed to deliver are present. */
  isConfigured(): boolean;

  /**
   * Deliver one message. MUST NOT throw: mail is best-effort for most callers,
   * and the two OTP paths decide for themselves whether to re-raise based on
   * `sent`. Return `{ sent: false, reason }` instead.
   */
  deliver(message: OutboundMessage): Promise<TransportSendResult>;

  /** Credential + auth health. Must never send a message, so it is safe to poll. */
  diagnostics(): Promise<TransportDiagnostics>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
