import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	DOC_ARTICLES,
	type DocArticle,
	type DocSection,
	sectionArticles,
	sectionsInOrder,
} from "@/content/docs.manifest";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { SECTION_ILLUSTRATION } from "./docsSectionIllustrations";

/**
 * The docs navigation.
 *
 * Structure over decoration: each section is announced by its icon chip and
 * name, and its articles hang off a single hairline beneath it. That rule is
 * what makes ten sections and forty-seven articles scan as a shape rather than
 * as one long list of links — the failure mode of a flat rail this size.
 *
 * The active article is marked twice, by a tinted ground AND by a solid bar on
 * the rule, because on a long scrolled rail the ground alone is easy to lose.
 *
 * Web-only articles are dropped on native rather than rendered and disabled: a
 * visible link that refuses to open is worse than an absent one, and the route
 * gate would bounce it anyway.
 */

export function visibleSections(
	native: boolean,
): { section: DocSection; articles: DocArticle[] }[] {
	return sectionsInOrder()
		.map((section) => ({
			section,
			articles: sectionArticles(section.id).filter(
				(article) => !(native && article.surface === "web"),
			),
		}))
		.filter((group) => group.articles.length > 0);
}

/** The article the current path points at, if any. */
function useCurrentSlug(): string | null {
	return useRouterState({
		select: (state) => {
			const match = state.location.pathname.match(
				/^\/docs\/([^/]+)\/([^/?#]+)/,
			);
			return match ? `${match[1]}/${match[2]}` : null;
		},
	});
}

/**
 * The tinted chip carrying a section's illustration.
 *
 * One tint for every section — the theme's own primary — rather than ten hues.
 * A rainbow reads as decoration bolted on; the product is purple, so the docs
 * are too. `text-primary` is load-bearing: the scenes draw their accent with
 * `fill-current`, so this is what colours the artwork.
 *
 * The small size is 28px rather than 24px: these are drawings, not glyphs, and
 * four points of extra room is the difference between reading the shape and
 * reading a smudge.
 */
export const SECTION_CHIP = "bg-primary/10 text-primary";

export function SectionIcon({
	section,
	size = "sm",
}: {
	section: DocSection["id"];
	size?: "sm" | "md";
}) {
	const Illustration = SECTION_ILLUSTRATION[section];
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden",
				size === "sm" ? "h-7 w-7 rounded-lg" : "h-11 w-11 rounded-xl",
				SECTION_CHIP,
			)}
		>
			<Illustration className={size === "sm" ? "h-6 w-6" : "h-9 w-9"} />
		</span>
	);
}

export function DocsSidebar() {
	const native = isNativeApp();
	const groups = useMemo(() => visibleSections(native), [native]);
	const current = useCurrentSlug();

	return (
		<nav aria-label="Documentation" className="space-y-6 pb-10">
			{groups.map(({ section, articles }) => (
				<div key={section.id}>
					<div className="flex items-center gap-2.5 px-2">
						<SectionIcon section={section.id} />
						<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							{section.title}
						</p>
					</div>

					{/* The rule the articles hang off. The active marker is drawn on it,
					    so the eye finds the current page by following one line. */}
					<ul className="mt-2 ml-[1.4rem] border-l border-border pl-3">
						{articles.map((article) => {
							const isCurrent =
								`${article.section}/${article.slug}` === current;
							return (
								<li key={article.slug} className="relative">
									{isCurrent ? (
										<span
											aria-hidden
											className="absolute -left-[13px] top-1.5 h-[calc(100%-0.75rem)] w-[2px] rounded-full bg-primary"
										/>
									) : null}
									<Link
										to="/docs/$section/$slug"
										params={{ section: article.section, slug: article.slug }}
										aria-current={isCurrent ? "page" : undefined}
										className={cn(
											"block rounded-md px-2.5 py-1.5 text-[13px] leading-snug transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
											isCurrent
												? "bg-primary/10 font-medium text-primary"
												: "text-muted-foreground hover:bg-muted hover:text-foreground",
										)}
									>
										{article.title}
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</nav>
	);
}

/** Every article the app shows, for the search corpus and tests. */
export function visibleArticles(native: boolean): DocArticle[] {
	return DOC_ARTICLES.filter(
		(article) => !(native && article.surface === "web"),
	);
}
