import { useMemo } from "react";
import { looksLikeHtml, sanitizeRichHtml } from "@/lib/richText";
import { cn } from "@/lib/utils";

/**
 * A body that may be rich HTML or may be plain text, rendered correctly either
 * way.
 *
 * Fields that gain a rich-text editor do not get their existing rows rewritten
 * — a backfill that reformats everyone's prose is a worse trade than a renderer
 * that can read both. So the format is decided per value: markup written since
 * the editor arrived renders as HTML, and everything written before it renders
 * as text with its line breaks intact.
 *
 * The HTML branch is sanitized here, at the render. The API accepts whatever
 * string a direct request carries, so even with a server-side sanitizer on the
 * write path this is the boundary that covers rows written before it existed.
 *
 * A sibling of `marketplace/services/ServiceRichBody`, which does the same job
 * for bodies whose legacy format was markdown rather than plain text.
 */
export function RichBody({
	value,
	className,
}: {
	value: string;
	className?: string;
}) {
	const html = useMemo(
		() => (looksLikeHtml(value) ? sanitizeRichHtml(value) : null),
		[value],
	);

	if (html === null) {
		// whitespace-pre-wrap so a plain-text description keeps the paragraph
		// breaks its author typed.
		return <p className={cn("whitespace-pre-wrap", className)}>{value}</p>;
	}

	return (
		<div
			// Sanitized directly above through the allow-list in lib/richText.
			dangerouslySetInnerHTML={{ __html: html }}
			className={cn("rich-prose", className)}
		/>
	);
}
