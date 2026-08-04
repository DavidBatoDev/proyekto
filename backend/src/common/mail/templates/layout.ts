import { escapeHtml } from './escape';

/**
 * The shared chrome for every Proyekto email: white page, centred wordmark,
 * centred headline, left-aligned body, one solid blue button, a rule, and small
 * print. No card, no dark banner, no gradients, no decorative panels.
 *
 * Table-based with inline styles because that is the only thing mail clients
 * render consistently — no flexbox, no external stylesheet, no class selectors.
 *
 * Scope: EVERY outbound email routes through here — notifications, project
 * invites, invoices, the two OTP codes and the two contract-signing messages.
 * That is the point. The invite and invoice templates used to carry their own
 * near-copies of a different design and drifted apart in spacing, heading sizes
 * and colour; one layout is what stops that happening again. If a new email
 * needs chrome this does not offer, add a parameter here rather than a second
 * layout.
 *
 * Deliberately absent: the old "Button not working? Copy and paste this link:"
 * block. It put two extra lines and a wrapped URL under every button, which was
 * the single largest source of visual noise, and the button carries the same
 * href for any client that renders anchors at all.
 */

export interface EmailCta {
  label: string;
  href: string;
}

export interface EmailLayoutInput {
  /** Hidden preview line shown by inboxes next to the subject. */
  preheader: string;
  title: string;
  /** e.g. `'Hi David,'`. Plain text — escaped here. */
  greeting?: string | null;
  /** The message body. Pre-escaped HTML — callers own their own escaping. */
  bodyHtml: string;
  cta?: EmailCta | null;
  /** Small print under the rule, e.g. why this landed in their inbox. */
  footerNote: string;
  /** One-click unsubscribe target, rendered beneath the footer note. */
  unsubscribeHref?: string | null;
}

const BRAND = 'Proyekto';

/** The one palette. Kept in step with the web primary (blue-600 / slate). */
const COLOR = {
  brand: '#2563eb',
  heading: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  rule: '#e2e8f0',
} as const;

export const BODY_TEXT_STYLE = `color:${COLOR.body};font-size:15px;line-height:1.6;`;

export function renderEmailLayout(input: EmailLayoutInput): string {
  const {
    preheader,
    title,
    greeting,
    bodyHtml,
    cta,
    footerNote,
    unsubscribeHref,
  } = input;

  const greetingBlock = greeting
    ? `            <p style="margin:0 0 16px;${BODY_TEXT_STYLE}">${escapeHtml(greeting)}</p>\n`
    : '';

  const ctaBlock = cta
    ? `
            <div style="margin:28px 0 0;">
              <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:12px 20px;background-color:${COLOR.brand};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:3px;">${escapeHtml(cta.label)}</a>
            </div>`
    : '';

  const unsubscribeBlock = unsubscribeHref
    ? `
            <p style="margin:10px 0 0;color:${COLOR.muted};font-size:13px;line-height:1.6;">
              <a href="${escapeHtml(unsubscribeHref)}" style="color:${COLOR.muted};text-decoration:underline;">Unsubscribe from these emails</a>
            </p>`
    : '';

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="width:560px;max-width:560px;">
            <tr>
              <td align="center" style="padding:0 0 26px;">
                <span style="color:${COLOR.brand};font-size:22px;font-weight:700;letter-spacing:.01em;">${BRAND}</span>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 0 26px;">
                <h1 style="margin:0;color:${COLOR.heading};font-size:26px;line-height:1.3;font-weight:700;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 28px;">
${greetingBlock}${bodyHtml}${ctaBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 0 0;border-top:1px solid ${COLOR.rule};">
                <p style="margin:0;color:${COLOR.muted};font-size:13px;line-height:1.6;">${escapeHtml(footerNote)}</p>${unsubscribeBlock}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/** A paragraph in the body column. `html` must already be escaped. */
export function renderParagraph(html: string): string {
  return `            <p style="margin:0 0 16px;${BODY_TEXT_STYLE}">${html}</p>`;
}

/**
 * A quoted block for the thing that happened — a comment, a chat message.
 *
 * `text` MUST already be plain text (run comment HTML through `htmlToText`
 * first). It is escaped here, so passing raw HTML yields visible tags rather
 * than markup — ugly, but never live.
 */
export function renderQuoteBlock(text: string): string {
  return `            <p style="margin:0 0 16px;padding:0 0 0 16px;border-left:3px solid ${COLOR.rule};color:${COLOR.body};font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(text)}</p>`;
}

/**
 * Label/value lines, for the handful of emails that carry figures (invoices,
 * invitations). A borderless two-column table rather than a panel — the numbers
 * are the content, the box around them was decoration.
 *
 * Both halves of each row must already be escaped.
 */
export function renderDetailRows(
  rows: { label: string; value: string }[],
): string {
  const body = rows
    .map(
      ({ label, value }) => `
              <tr>
                <td style="padding:4px 16px 4px 0;color:${COLOR.muted};font-size:15px;line-height:1.6;">${label}</td>
                <td style="padding:4px 0;color:${COLOR.heading};font-size:15px;line-height:1.6;font-weight:600;">${value}</td>
              </tr>`,
    )
    .join('');
  return `            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 16px;">${body}
            </table>`;
}

/**
 * A one-time code, shown big enough to read off a phone.
 *
 * Not a button and not a link: the code is the payload, and a code styled as a
 * CTA trains people to click things in emails that ask for credentials.
 */
export function renderCodeBlock(code: string): string {
  return `            <p style="margin:0 0 16px;color:${COLOR.heading};font-size:32px;font-weight:700;letter-spacing:6px;line-height:1.3;">${escapeHtml(code)}</p>`;
}
