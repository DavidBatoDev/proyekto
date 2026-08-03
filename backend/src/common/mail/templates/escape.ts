/**
 * HTML-escape a value destined for an email body.
 *
 * Email bodies are assembled by string concatenation — there is no DOM and no
 * templating engine doing this for us — so every caller-supplied value must pass
 * through here. Escaping the five characters below is what keeps a comment, a
 * project name or a provider name from becoming live markup in someone's inbox.
 *
 * Previously duplicated verbatim as `escapeHtml` in the project-invite template
 * and `esc` in the invoice template.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only http(s) URLs may be embedded in an email.
 *
 * Blocks `javascript:`, `data:` and friends from reaching an `href` or `src`.
 * Returns null when the URL is unusable so callers can omit the element rather
 * than emit a broken or dangerous one.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return escapeHtml(trimmed);
}
