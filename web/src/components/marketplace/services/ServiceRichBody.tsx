import { useMemo } from "react";
import { looksLikeHtml, sanitizeRichHtml } from "@/lib/richText";
import { cn } from "@/lib/utils";
import { ServiceMarkdown } from "./ServiceMarkdown";

/**
 * A section body, however it was written.
 *
 * New bodies come from the rich-text editor as HTML; every section written
 * before it is markdown. Both render here so nothing had to be migrated and a
 * seller who never reopens an old service sees no change at all.
 *
 * The HTML branch is sanitised at render — the API accepts whatever string a
 * seller's own request carries, and this page is public, so the boundary sits
 * here rather than on the write where a direct POST would skip it.
 */
export function ServiceRichBody({
	body,
	className,
}: {
	body: string;
	className?: string;
}) {
	const html = useMemo(
		() => (looksLikeHtml(body) ? sanitizeRichHtml(body) : null),
		[body],
	);

	if (html === null) {
		return <ServiceMarkdown className={className}>{body}</ServiceMarkdown>;
	}

	return (
		<div
			// Sanitised directly above through the allow-list in lib/richText —
			// putting that boundary here, at the render, is this component's job.
			dangerouslySetInnerHTML={{ __html: html }}
			className={cn(
				"rich-prose text-[15px] leading-relaxed text-foreground",
				className,
			)}
		/>
	);
}
