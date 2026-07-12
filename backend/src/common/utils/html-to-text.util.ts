const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);?/gi, (match, raw: string) => {
      const isHex = raw[0]?.toLowerCase() === 'x';
      const parsed = Number.parseInt(
        isHex ? raw.slice(1) : raw,
        isHex ? 16 : 10,
      );
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0x10ffff) {
        return match;
      }
      try {
        return String.fromCodePoint(parsed);
      } catch {
        return match;
      }
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    });
}

/** Truncate prompt-facing text while keeping the returned string within cap. */
export function truncatePromptText(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  if (maxChars === 1) return '\u2026';
  return `${value.slice(0, maxChars - 1).trimEnd()}\u2026`;
}

/**
 * Convert the small rich-HTML subset emitted by the project overview editor
 * into prompt-grade plain text. This is intentionally not a general-purpose
 * HTML parser: it preserves useful paragraph/list structure, drops executable
 * or styling blocks, decodes common entities, and applies a hard output cap.
 */
export function htmlToText(
  html: string | null | undefined,
  maxChars = Number.MAX_SAFE_INTEGER,
): string {
  if (!html || maxChars <= 0) return '';

  const text = decodeHtmlEntities(
    html
      .replace(/\r\n?/g, '\n')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/li\s*>/gi, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(p|div|section|article|header|footer|h[1-6]|tr)\s*>/gi, '\n')
      .replace(/<(p|div|section|article|header|footer|h[1-6]|tr)\b[^>]*>/gi, '')
      .replace(/<\/(td|th)\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return truncatePromptText(text, maxChars);
}
