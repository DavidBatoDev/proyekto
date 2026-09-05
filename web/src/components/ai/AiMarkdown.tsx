import { cloneElement, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// =============================================================================
// Assistant-turn Markdown renderer. Lifted from the old roadmap panel
// (`renderBracketTagText` / `renderBracketTagsInNode` + the ReactMarkdown
// component overrides). `[bracket tags]` in model text become small pills.
// Theme tokens only — the same body renders on the roadmap page and inside
// the dashboard's sidebar-toned rail.
// =============================================================================

const BRACKET_TAG_PATTERN = /\[([^\[\]\n]{1,120})\]/g;

export const renderBracketTagText = (text: string): ReactNode => {
	BRACKET_TAG_PATTERN.lastIndex = 0;
	if (!BRACKET_TAG_PATTERN.test(text)) return text;
	BRACKET_TAG_PATTERN.lastIndex = 0;

	const parts: ReactNode[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = BRACKET_TAG_PATTERN.exec(text)) !== null) {
		const [fullMatch, label] = match;
		const start = match.index;
		const end = start + fullMatch.length;

		if (start > lastIndex) {
			parts.push(text.slice(lastIndex, start));
		}

		parts.push(
			<span
				key={`assistant-tag-${start}-${end}`}
				className="mx-0.5 inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
			>
				{label}
			</span>,
		);

		lastIndex = end;
	}

	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return parts;
};

export const renderBracketTagsInNode = (node: ReactNode): ReactNode => {
	if (typeof node === "string") return renderBracketTagText(node);
	if (Array.isArray(node)) {
		return node.map((child) => renderBracketTagsInNode(child));
	}
	if (isValidElement<{ children?: ReactNode }>(node)) {
		if (node.props.children === undefined) return node;
		return cloneElement(
			node,
			undefined,
			renderBracketTagsInNode(node.props.children),
		);
	}
	return node;
};

export interface AiMarkdownProps {
	content: string;
	className?: string;
}

export function AiMarkdown({ content, className }: AiMarkdownProps) {
	return (
		<div
			className={
				className ??
				"text-xs leading-relaxed text-foreground [&_a]:text-primary"
			}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					p: ({ children }) => (
						<p className="mb-2 last:mb-0 whitespace-pre-wrap">
							{renderBracketTagsInNode(children)}
						</p>
					),
					ul: ({ children }) => (
						<ul className="mb-2 list-disc pl-4 space-y-1">
							{renderBracketTagsInNode(children)}
						</ul>
					),
					ol: ({ children }) => (
						<ol className="mb-2 list-decimal pl-4 space-y-1">
							{renderBracketTagsInNode(children)}
						</ol>
					),
					code: ({ children }) => (
						<code className="rounded bg-muted px-1 py-0.5 text-[11px]">
							{children}
						</code>
					),
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}

export default AiMarkdown;
