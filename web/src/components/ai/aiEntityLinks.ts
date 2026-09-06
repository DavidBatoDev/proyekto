import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import type { AiMentionKind } from "./aiMentions";

export const ENTITY_URI_SCHEME = "proyekto:";

const ENTITY_HREF_PATTERN =
	/^proyekto:\/\/(project|roadmap|epic|feature|task|milestone|team|workspace)\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i;

/** Mirror entity_registry.normalize_title, including Unicode case folding. */
export function normalizeEntityLabel(label: string): string {
	const folded = Array.from(label.normalize("NFKC"), (character) => {
		// Per-character upper/lower folds expansions (ß) and final sigma. The
		// exceptions preserve Python casefold's dotless I and Cherokee casing.
		if (character === "\u0131") return character;
		if (character === "\u1e9e") return "ss";
		if (/^[\u13a0-\u13ff\uab70-\uabbf]$/.test(character)) {
			return character.toUpperCase();
		}
		return character.toUpperCase().toLowerCase();
	}).join("");
	// Python's Unicode whitespace includes NEL/control separators, not BOM.
	return folded
		.replace(
			/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*\([^)]*\)[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*/,
			"",
		)
		.replace(/[^\p{L}\p{N}]/gu, "");
}

export function entityLabelsMatch(left: string, right: string): boolean {
	const a = normalizeEntityLabel(left);
	const b = normalizeEntityLabel(right);
	if (!a || !b) return false;
	return (
		a === b ||
		(Math.min(Array.from(a).length, Array.from(b).length) >= 12 &&
			(a.includes(b) || b.includes(a)))
	);
}

export function parseEntityHref(
	href: string | undefined | null,
): { kind: AiMentionKind; id: string } | null {
	const match = href?.match(ENTITY_HREF_PATTERN);
	return match
		? {
				kind: match[1].toLowerCase() as AiMentionKind,
				id: match[2].toLowerCase(),
			}
		: null;
}

export const aiMarkdownUrlTransform: UrlTransform = (url, _key, _node) =>
	parseEntityHref(url) ? url : defaultUrlTransform(url);

/** Plain-text surfaces retain titles, including handles in streaming text. */
export function stripEntityLinks(text: string): string {
	return text.replace(
		/\[((?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])*)\]\(proyekto:(?:\/\/[^)\s]*\)|[^)\s]*$)/g,
		(_match, label: string) => label.replace(/\\([\\`*_[\]])/g, "$1"),
	);
}

export function entityKey(kind: AiMentionKind, id: string): string {
	return `${kind}:${id}`;
}
