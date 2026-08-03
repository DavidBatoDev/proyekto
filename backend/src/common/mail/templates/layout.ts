import { escapeHtml } from './escape';

/**
 * The shared chrome for Proyekto email: slate page, 600px white card, dark
 * header band with the brand eyebrow, blue CTA, muted footer.
 *
 * Table-based with inline styles because that is the only thing mail clients
 * render consistently — no flexbox, no external stylesheet, no class selectors.
 *
 * Scope note: the project-invite and invoice templates predate this and are NOT
 * routed through it. They are visually of the same family but differ in
 * whitespace, heading sizes and spacing, so folding them in would either change
 * two shipped emails or require so many parameters that this stops being a
 * layout. They keep their own markup, pinned by snapshot tests; everything new
 * builds on this.
 */

export interface EmailCta {
  label: string;
  href: string;
}

export interface EmailLayoutInput {
  /** Hidden preview line shown by inboxes next to the subject. */
  preheader: string;
  /** Small uppercase label above the title. Defaults to the brand name. */
  eyebrow?: string;
  title: string;
  /** Optional line under the title, inside the dark header. Pre-escaped HTML. */
  subtitleHtml?: string | null;
  /** The message body. Pre-escaped HTML — callers own their own escaping. */
  bodyHtml: string;
  cta?: EmailCta | null;
  /** Small print under the CTA, e.g. why this landed in their inbox. */
  footerNote: string;
  /** One-click unsubscribe target, rendered beside the footer note. */
  unsubscribeHref?: string | null;
}

const BRAND = 'Proyekto';

export function renderEmailLayout(input: EmailLayoutInput): string {
  const {
    preheader,
    eyebrow = BRAND,
    title,
    subtitleHtml,
    bodyHtml,
    cta,
    footerNote,
    unsubscribeHref,
  } = input;

  const ctaBlock = cta
    ? `
                <div style="margin:30px 0;text-align:center;">
                  <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:14px 28px;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">${escapeHtml(cta.label)}</a>
                </div>
                <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.5;">Button not working? Copy and paste this link:</p>
                <p style="margin:0;line-height:1.6;">
                  <a href="${escapeHtml(cta.href)}" style="color:#1d4ed8;font-size:12px;text-decoration:underline;word-break:break-all;">${escapeHtml(cta.href)}</a>
                </p>`
    : '';

  const unsubscribeBlock = unsubscribeHref
    ? `
                <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
                  <a href="${escapeHtml(unsubscribeHref)}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe from these emails</a>
                </p>`
    : '';

  const subtitleBlock = subtitleHtml
    ? `
                <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.5;">${subtitleHtml}</p>`
    : '';

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:26px 32px;background-color:#0f172a;">
                <p style="margin:0 0 14px;color:#93c5fd;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;line-height:1.2;font-weight:700;">${escapeHtml(title)}</h1>${subtitleBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px;">
${bodyHtml}${ctaBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">${escapeHtml(footerNote)}</p>${unsubscribeBlock}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/**
 * A quoted block for the thing that happened — a comment, a chat message.
 *
 * `text` MUST already be plain text (run comment HTML through `htmlToText`
 * first). It is escaped here, so passing raw HTML yields visible tags rather
 * than markup — ugly, but never live.
 */
export function renderQuoteBlock(text: string): string {
  return `                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0;color:#334155;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(text)}</p>
                    </td>
                  </tr>
                </table>`;
}

/** A lead paragraph in the body column. `html` must already be escaped. */
export function renderParagraph(html: string): string {
  return `                <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;">${html}</p>`;
}
