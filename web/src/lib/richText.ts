import DOMPurify from "dompurify";

/**
 * The shared rules for text authored in this app's rich-text editor.
 *
 * Two formats live side by side and both have to render: HTML, which is what
 * `RichTextEditor` produces, and markdown, which is what service sections were
 * written in before the editor existed. Nothing rewrites the old rows — the
 * renderer decides per body, so a service saved in 2026-08 keeps reading
 * exactly as it did.
 */

/** True when the value has no visible text — tags and &nbsp; are not content. */
export function isRichTextEmpty(value: string | null | undefined): boolean {
	if (!value) return true;
	return (
		value
			.replace(/<[^>]*>/g, "")
			.replace(/&nbsp;/g, " ")
			.trim() === ""
	);
}

/**
 * Whether to render this body as HTML rather than markdown.
 *
 * Deliberately narrow: a block-level tag the editor actually emits. Prose that
 * merely mentions `<div>` or uses a `<` comparison stays markdown, which is the
 * safer mistake — markdown escapes raw HTML, so a wrong answer here renders
 * visible text rather than live markup.
 */
export function looksLikeHtml(value: string): boolean {
	return /<(p|div|ul|ol|li|h[1-6]|blockquote|pre|br|strong|em|b|i|u|s|a|span)\b[^>]*>/i.test(
		value,
	);
}

/**
 * Tags and attributes a seller's body may contain.
 *
 * This is an allow-list, so anything the editor gains later renders as nothing
 * until it is added here — the failure mode is a missing bullet, not a script
 * on a public marketplace page. No `img` (the gallery owns images), no `style`,
 * no `id`/`class` (they would let a body reach into the page's own styling).
 */
const ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"ul",
	"ol",
	"li",
	"a",
	"blockquote",
	"code",
	"pre",
	"h1",
	"h2",
	"h3",
	"h4",
	"span",
];

/**
 * Sanitise a body for rendering. The editor already cleans what it produces,
 * but the API accepts any string a seller's own request carries, and this text
 * is shown to strangers on a public page — so the render is where the boundary
 * belongs, not the write.
 */
export function sanitizeRichHtml(value: string): string {
	return DOMPurify.sanitize(value, {
		ALLOWED_TAGS,
		ALLOWED_ATTR: ["href", "target", "rel"],
		// javascript:/data: hrefs, on* handlers and unknown protocols are dropped
		// by DOMPurify's own URI policy; this keeps the surface to what we list.
		ALLOW_DATA_ATTR: false,
	});
}

/**
 * Visible text only — for places that need a sentence rather than a document:
 * card blurbs, meta descriptions, the plain `description` mirror.
 */
export function richTextToPlain(value: string): string {
	const withoutTags = looksLikeHtml(value)
		? value
				.replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, " ")
				.replace(/<br\s*\/?>/gi, " ")
				.replace(/<[^>]*>/g, "")
		: value;
	return withoutTags
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}
