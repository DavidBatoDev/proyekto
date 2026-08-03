/**
 * The plain-text alternative for an email.
 *
 * Worth building deliberately rather than leaning on MailerService's
 * `stripHtml` fallback: spam filters weigh a real text/plain part, and it is
 * what a screen reader or a text-only client actually reads.
 *
 * Takes already-plain strings — nothing here escapes or strips, because there
 * should be no markup to strip by the time a caller gets here.
 */
export function renderTextEmail(lines: (string | null | undefined)[]): string {
  return lines
    .filter((line): line is string => line !== null && line !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
