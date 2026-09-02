import sanitizeHtml from 'sanitize-html';

/**
 * Server-side sanitization for text authored in the web's rich-text editor.
 *
 * The web already sanitizes at render (`web/src/lib/richText.ts`), and that
 * pass stays — it is what protects rows written before this existed. But the
 * render is not a sufficient boundary on its own: `PATCH /api/teams/:id` is a
 * plain authenticated endpoint, so any owner or admin can curl arbitrary markup
 * straight past the browser. Once unsanitized HTML is in the row, every present
 * and future reader inherits it: the Capacitor WebView, an email template, a
 * contract render, an LLM context window. Cleaning on write means the stored
 * value is already safe no matter who reads it next.
 *
 * The allow-list mirrors `ALLOWED_TAGS` in `web/src/lib/richText.ts` exactly.
 * Keep the two in step: a tag allowed there but stripped here silently eats
 * formatting the user just typed, and the reverse stores markup no renderer
 * will show. No `img` (nothing uploads through this path), no `style`, no
 * `id`/`class` — those would let a description reach into the page's own
 * styling.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'span',
];

export function sanitizeRichHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    // href/target/rel on links only. DOMPurify allows these three globally;
    // scoping them to `a` here is strictly narrower, and they are meaningless
    // anywhere else.
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    // Anything not on this list — javascript:, data:, vbscript: — is dropped.
    allowedSchemes: ['http', 'https', 'mailto'],
    // Drop the contents of <script>/<style> rather than leaving the text behind
    // as visible prose.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  });
}

/**
 * Sanitize a value that may be absent. Returns the input unchanged when there
 * is nothing to clean, so callers can pass an optional DTO field straight
 * through without a null dance.
 */
export function sanitizeOptionalRichHtml<T extends string | null | undefined>(
  value: T,
): T {
  if (typeof value !== 'string' || value === '') return value;
  return sanitizeRichHtml(value) as T;
}
