import type { ConfigService } from '@nestjs/config';

/**
 * Who an outbound email comes from, by purpose.
 *
 * Every send site names one of these instead of an address, so changing where
 * billing mail comes from is an env change rather than a code change, and so a
 * reviewer can see at a glance that an OTP is not going out over the billing
 * identity.
 *
 * v1 is backed by Gmail "Send mail as" aliases on the single authenticated
 * mailbox: an address that is NOT verified there will be silently rewritten by
 * Gmail to the mailbox identity. `resolveSender` therefore treats a missing
 * address as "omit the From header" rather than inventing one — the same
 * degradation the mailer had before senders existed.
 */
export type MailSender = 'noreply' | 'billing' | 'accounts' | 'support';

export const MAIL_SENDERS: readonly MailSender[] = [
  'noreply',
  'billing',
  'accounts',
  'support',
] as const;

/** Env var holding each sender's address. */
const SENDER_ENV: Record<MailSender, string> = {
  noreply: 'MAIL_FROM_NOREPLY',
  billing: 'MAIL_FROM_BILLING',
  accounts: 'MAIL_FROM_ACCOUNTS',
  support: 'MAIL_FROM_SUPPORT',
};

/**
 * Human-readable suffix so a recipient can tell three Proyekto emails apart in
 * a threaded inbox. Kept short — mail clients truncate the display name hard.
 */
const SENDER_LABEL: Record<MailSender, string> = {
  noreply: '',
  billing: 'Billing',
  accounts: 'Accounts',
  support: 'Support',
};

export interface ResolvedSender {
  /** Bare address, or null when nothing is configured. */
  address: string | null;
  /** Ready-to-use RFC 5322 From value, or null to omit the header. */
  header: string | null;
}

/**
 * Resolve a sender to a From header value.
 *
 * Fallback chain, widest-to-narrowest: the sender's own address, then
 * GMAIL_FROM_EMAIL, then INVITE_FROM_EMAIL (the legacy name ProjectsService
 * used), then null. Returning null makes the caller omit the header entirely,
 * which is what the mailer did before this file existed — so an unconfigured
 * deploy keeps working instead of failing closed.
 *
 * `onBehalfOf` is the multi-tenant part. Proyekto sends invoices for many
 * agencies, but mail can only be authenticated for a domain we control — you
 * cannot put `billing@some-agency.com` in From without SPF/DKIM published in
 * *their* DNS, or it fails DMARC. So the address stays ours and the agency's
 * identity rides in the display name:
 *
 *   From: "Acme Studio (via Proyekto)" <billing@proyekto.tech>
 *
 * with the agency's real address as Reply-To (the caller sets that). This is
 * what Stripe, Xero and QuickBooks all do. Per-agency sending domains are a
 * later opt-in feature requiring DNS verification per tenant.
 */
export function resolveSender(
  config: ConfigService,
  sender: MailSender,
  onBehalfOf?: string | null,
): ResolvedSender {
  const address =
    config.get<string>(SENDER_ENV[sender])?.trim() ||
    config.get<string>('GMAIL_FROM_EMAIL')?.trim() ||
    config.get<string>('INVITE_FROM_EMAIL')?.trim() ||
    null;

  if (!address) return { address: null, header: null };

  const base = config.get<string>('MAIL_FROM_NAME')?.trim() || 'Proyekto';
  const tenant = onBehalfOf?.trim();
  const label = SENDER_LABEL[sender];
  const displayName = tenant
    ? `${tenant} (via ${base})`
    : label
      ? `${base} ${label}`
      : base;

  return { address, header: formatFrom(displayName, address) };
}

/** Every sender's configured address — for the mail health endpoint. */
export function resolveAllSenders(
  config: ConfigService,
): Record<MailSender, string | null> {
  return MAIL_SENDERS.reduce(
    (acc, sender) => {
      acc[sender] = resolveSender(config, sender).address;
      return acc;
    },
    {} as Record<MailSender, string | null>,
  );
}

/**
 * `Display Name <addr@host>`, quoting the name when RFC 5322 requires it.
 *
 * The name is quoted rather than dropped so "Proyekto, Billing" survives; CRLF
 * is stripped here as well as in the mailer's `header()` because this value is
 * assembled from two env vars and must never be able to inject a header on its
 * own.
 */
function formatFrom(displayName: string, address: string): string {
  const name = displayName.replace(/[\r\n]+/g, ' ').trim();
  const addr = address.replace(/[\r\n]+/g, '').trim();
  if (!name) return addr;
  // Specials per RFC 5322 §3.2.3 that force a quoted-string.
  const needsQuoting = /[()<>[\]:;@\\,."]/.test(name);
  const safe = name.replace(/(["\\])/g, '\\$1');
  return needsQuoting ? `"${safe}" <${addr}>` : `${name} <${addr}>`;
}
