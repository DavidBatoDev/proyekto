import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import type { AiMentionKind } from "./aiMentions";

export const ENTITY_URI_SCHEME = "proyekto:";

const ENTITY_HREF_PATTERN =
	/^proyekto:\/\/(project|roadmap|epic|feature|task|milestone|team)\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i;

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
