import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Section bodies are seller-written markdown. Rendering is deliberately
 * narrow: headings inside a section would compete with the section's own
 * heading, so they render as bold text, and every element is themed rather
 * than left to browser defaults. ReactMarkdown escapes raw HTML by default
 * (no rehype-raw here) — that is the sanitisation boundary for text a
 * stranger can put on a public page.
 */
export function ServiceMarkdown({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div
			className={cn("text-[15px] leading-relaxed text-foreground", className)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					p: ({ children: kids }) => <p className="mb-3 last:mb-0">{kids}</p>,
					strong: ({ children: kids }) => (
						<strong className="font-semibold text-foreground">{kids}</strong>
					),
					em: ({ children: kids }) => <em className="italic">{kids}</em>,
					ul: ({ children: kids }) => (
						<ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{kids}</ul>
					),
					ol: ({ children: kids }) => (
						<ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">
							{kids}
						</ol>
					),
					li: ({ children: kids }) => <li className="pl-0.5">{kids}</li>,
					h1: ({ children: kids }) => (
						<p className="mb-2 font-semibold text-foreground">{kids}</p>
					),
					h2: ({ children: kids }) => (
						<p className="mb-2 font-semibold text-foreground">{kids}</p>
					),
					h3: ({ children: kids }) => (
						<p className="mb-2 font-semibold text-foreground">{kids}</p>
					),
					blockquote: ({ children: kids }) => (
						<blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
							{kids}
						</blockquote>
					),
					code: ({ children: kids }) => (
						<code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">
							{kids}
						</code>
					),
					a: ({ children: kids, href }) => (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer nofollow"
							className="text-primary underline underline-offset-2"
						>
							{kids}
						</a>
					),
					hr: () => <hr className="my-4 border-border" />,
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
