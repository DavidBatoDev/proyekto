import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	DOC_ARTICLES,
	type DocArticle,
	type DocSection,
	docHref,
	sectionArticles,
	sectionsInOrder,
} from "@/content/docs.manifest";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { sectionStyle } from "./docsSectionStyle";

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

/** The tinted square that carries a section's icon. One size everywhere. */
export function SectionIcon({
	section,
	size = "sm",
}: {
	section: DocSection["id"];
	size?: "sm" | "md";
}) {
	const { icon: Icon, tone } = sectionStyle(section);
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg",
				size === "sm" ? "h-6 w-6" : "h-10 w-10 rounded-xl",
				tone,
			)}
		>
			<Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5"} aria-hidden />
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

/**
 * The phone version: one scrolling row of every article.
 *
 * A collapsed accordion on a phone hides the thing you came for behind two
 * taps; a strip keeps every destination one tap away. Docs ship inside the
 * installed app, so this is the primary nav for a real share of readers.
 */
export function DocsTabStrip() {
	const native = isNativeApp();
	const groups = useMemo(() => visibleSections(native), [native]);
	const current = useCurrentSlug();
	const flat = groups.flatMap((g) => g.articles);

	return (
		<nav
			aria-label="Documentation"
			className="flex gap-1.5 overflow-x-auto px-4 pb-3 md:hidden"
		>
			{flat.map((article) => {
				const isCurrent = `${article.section}/${article.slug}` === current;
				return (
					<Link
						key={docHref(article)}
						to="/docs/$section/$slug"
						params={{ section: article.section, slug: article.slug }}
						data-active={isCurrent}
						aria-current={isCurrent ? "page" : undefined}
						className={cn(
							"flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors",
							isCurrent
								? "border-primary/30 bg-primary/10 font-medium text-primary"
								: "border-border text-muted-foreground hover:bg-muted",
						)}
					>
						{article.title}
					</Link>
				);
			})}
		</nav>
	);
}

/** Every article the app shows, for the search corpus and tests. */
export function visibleArticles(native: boolean): DocArticle[] {
	return DOC_ARTICLES.filter(
		(article) => !(native && article.surface === "web"),
	);
}
