import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * An article body.
 *
 * Modelled on `ServiceMarkdown`, with one deliberate difference: that renderer
 * downgrades every heading to bold text, because a seller's section body must
 * not compete with the section's own heading. A docs article is a long
 * document that needs real headings to be scannable, so `h2` and `h3` render
 * as headings here — and get an `id` so the on-page table of contents can link
 * to them.
 *
 * As there, raw HTML is not enabled (no `rehype-raw`). ReactMarkdown escapes it
 * by default, and that is the sanitisation boundary.
 */

/** "Roadmaps & work" -> "roadmaps-work". Stable enough to link to. */
export function headingId(children: React.ReactNode): string {
	const text = String(children);
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-");
}

export function DocsMarkdown({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"text-[15px] leading-[1.75] text-muted-foreground",
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: ({ children: kids }) => (
						// Articles carry no `# Title` — the page renders it from the
						// manifest. A stray one is treated as a section heading.
						<h2
							id={headingId(kids)}
							className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight text-foreground first:mt-0"
						>
							{kids}
						</h2>
					),
					h2: ({ children: kids }) => (
						<h2
							id={headingId(kids)}
							className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight text-foreground first:mt-0"
						>
							{kids}
						</h2>
					),
					h3: ({ children: kids }) => (
						<h3
							id={headingId(kids)}
							className="mt-8 scroll-mt-24 text-base font-semibold text-foreground"
						>
							{kids}
						</h3>
					),
					p: ({ children: kids }) => <p className="mt-4 first:mt-0">{kids}</p>,
					strong: ({ children: kids }) => (
						<strong className="font-semibold text-foreground">{kids}</strong>
					),
					em: ({ children: kids }) => <em className="italic">{kids}</em>,
					ul: ({ children: kids }) => (
						<ul className="mt-4 list-disc space-y-2 pl-5">{kids}</ul>
					),
					ol: ({ children: kids }) => (
						<ol className="mt-4 list-decimal space-y-2 pl-5">{kids}</ol>
					),
					li: ({ children: kids }) => <li className="pl-1">{kids}</li>,
					blockquote: ({ children: kids }) => (
						<blockquote className="mt-4 border-l-2 border-border py-1 pl-4 text-muted-foreground">
							{kids}
						</blockquote>
					),
					code: ({ children: kids, className: codeClass }) => {
						// ReactMarkdown gives fenced blocks a language class and inline
						// code none; there is no syntax highlighter installed, so both
						// render as plain monospace on a muted ground.
						const fenced = Boolean(codeClass);
						return fenced ? (
							<code className="block whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-foreground">
								{kids}
							</code>
						) : (
							<code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
								{kids}
							</code>
						);
					},
					pre: ({ children: kids }) => (
						<pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-muted/50 p-4">
							{kids}
						</pre>
					),
					a: ({ children: kids, href }) => {
						const external = /^https?:\/\//i.test(href ?? "");
						return (
							<a
								href={href}
								className="font-medium text-primary underline underline-offset-4 hover:no-underline"
								{...(external
									? { target: "_blank", rel: "noopener noreferrer" }
									: {})}
							>
								{kids}
							</a>
						);
					},
					hr: () => <hr className="mt-10 border-border" />,
					table: ({ children: kids }) => (
						<div className="mt-6 overflow-x-auto">
							<table className="w-full border-collapse text-left text-sm">
								{kids}
							</table>
						</div>
					),
					th: ({ children: kids }) => (
						<th className="border-b border-border pb-2 pr-4 font-semibold text-foreground">
							{kids}
						</th>
					),
					td: ({ children: kids }) => (
						<td className="border-b border-border/60 py-2 pr-4 align-top">
							{kids}
						</td>
					),
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
