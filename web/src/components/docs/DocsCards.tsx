import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import type { DocArticle } from "@/content/docs.manifest";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { visibleSections } from "./DocsSidebar";
import { sectionStyle } from "./docsSectionStyle";

/**
 * The card surfaces on the docs home.
 *
 * Two shapes only — a Popular card and a Section card — because a docs index
 * with four card treatments is a page you have to learn before you can use it.
 * Both are drawn with a hairline and a hover lift rather than a shadow, which
 * is what the rest of the marketing surface does.
 */

/** One of the four cards in the top grid. */
export function PopularCard({ article }: { article: DocArticle }) {
	const { icon: Icon, tone } = sectionStyle(article.section);
	return (
		<Link
			to="/docs/$section/$slug"
			params={{ section: article.section, slug: article.slug }}
			className="group relative flex flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40"
		>
			<span
				className={cn(
					"flex h-10 w-10 items-center justify-center rounded-xl",
					tone,
				)}
			>
				<Icon className="h-5 w-5" aria-hidden />
			</span>
			<span className="mt-4 text-sm font-semibold text-foreground">
				{article.title}
			</span>
			<span className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
				{article.description}
			</span>
			<ArrowUpRight
				className="absolute right-4 top-4 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
				aria-hidden
			/>
		</Link>
	);
}

/**
 * A section, with the first few articles inside it.
 *
 * Showing three titles rather than a bare count is the difference between "a
 * section exists" and "I can see whether my answer is in it" — which is the
 * only question someone on an index page is actually asking.
 */
export function DocsSectionCards() {
	const native = isNativeApp();
	const groups = useMemo(() => visibleSections(native), [native]);

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{groups.map(({ section, articles }) => {
				const { icon: Icon, tone } = sectionStyle(section.id);
				const shown = articles.slice(0, 3);
				const rest = articles.length - shown.length;
				return (
					<div
						key={section.id}
						className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30"
					>
						<div className="flex items-start gap-3">
							<span
								className={cn(
									"flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
									tone,
								)}
							>
								<Icon className="h-5 w-5" aria-hidden />
							</span>
							<div className="min-w-0">
								<h3 className="text-sm font-semibold text-foreground">
									{section.title}
								</h3>
								<p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
									{section.purpose}
								</p>
							</div>
						</div>

						<ul className="mt-4 space-y-1">
							{shown.map((article) => (
								<li key={article.slug}>
									<Link
										to="/docs/$section/$slug"
										params={{ section: article.section, slug: article.slug }}
										className="block rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									>
										{article.title}
									</Link>
								</li>
							))}
						</ul>

						{rest > 0 ? (
							<Link
								to="/docs/$section/$slug"
								params={{
									section: articles[0].section,
									slug: articles[0].slug,
								}}
								className="mt-2 inline-block px-2 text-[13px] font-medium text-primary transition-opacity hover:opacity-80"
							>
								{rest} more
							</Link>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
