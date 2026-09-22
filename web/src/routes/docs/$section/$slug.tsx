import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ArticleCallouts } from "@/components/docs/DocsCallouts";
import { DocsMarkdown } from "@/components/docs/DocsMarkdown";
import { SectionIcon } from "@/components/docs/DocsSidebar";
import {
	DOC_ARTICLES,
	DOC_SECTIONS,
	type DocArticle,
	findArticle,
	sectionArticles,
} from "@/content/docs.manifest";
import { loadArticleBody } from "@/content/docsContent";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

/**
 * One documentation article.
 *
 * The body is loaded in the route loader rather than in an effect so the page
 * never renders a flash of empty prose, and so an unknown slug 404s before
 * anything mounts.
 */
export const Route = createFileRoute("/docs/$section/$slug")({
	loader: async ({ params }) => {
		const article = findArticle(params.section, params.slug);
		if (!article) throw notFound();
		return { article, body: await loadArticleBody(article) };
	},
	component: DocsArticlePage,
});

/**
 * A list of onward links, as cards.
 *
 * Bare links at the foot of a long article read as a footer and get skipped;
 * a card with the article's own description is the only version anyone
 * actually clicks.
 */
function ArticleLinks({
	title,
	articles,
}: {
	title: string;
	articles: DocArticle[];
}) {
	return (
		<section className="mt-14 border-t border-border pt-8">
			<h2 className="text-sm font-semibold text-foreground">{title}</h2>
			<div className="mt-4 grid gap-3 sm:grid-cols-2">
				{articles.map((item) => (
					<Link
						key={`${item.section}/${item.slug}`}
						to="/docs/$section/$slug"
						params={{ section: item.section, slug: item.slug }}
						className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40"
					>
						<SectionIcon section={item.section} />
						<span className="min-w-0">
							<span className="block text-sm font-medium text-foreground">
								{item.title}
							</span>
							<span className="mt-0.5 line-clamp-2 block text-[13px] leading-relaxed text-muted-foreground">
								{item.description}
							</span>
						</span>
					</Link>
				))}
			</div>
		</section>
	);
}

function DocsArticlePage() {
	const { article, body } = Route.useLoaderData();
	useDocumentTitle(article.title);

	const section = DOC_SECTIONS.find((s) => s.id === article.section);
	const siblings = sectionArticles(article.section);
	const related = (article.related ?? [])
		.map((slug) => DOC_ARTICLES.find((a) => a.slug === slug))
		.filter((a): a is (typeof DOC_ARTICLES)[number] => Boolean(a));

	return (
		<article className="mx-auto w-full max-w-[912px] px-5 py-10 md:px-10 lg:px-14">
			<Link
				to="/docs"
				className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:hidden"
			>
				<ArrowLeft className="h-3.5 w-3.5" aria-hidden />
				All docs
			</Link>

			{section ? (
				<div className="mt-4 flex items-center gap-2.5 md:mt-0">
					<SectionIcon section={section.id} />
					<span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						{section.title}
					</span>
				</div>
			) : null}
			<h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
				{article.title}
			</h1>
			<p className="mt-3 text-base leading-relaxed text-muted-foreground">
				{article.description}
			</p>

			<ArticleCallouts article={article} />

			<div className="mt-10">
				<DocsMarkdown>{body}</DocsMarkdown>
			</div>

			{article.hub ? (
				<ArticleLinks
					title={`Everything in ${section?.title ?? "this section"}`}
					articles={siblings.filter((s) => s.slug !== article.slug)}
				/>
			) : null}

			{related.length > 0 ? (
				<ArticleLinks title="Related" articles={related} />
			) : null}

			<p className="mt-14 text-xs text-muted-foreground">
				Last updated {article.updated}
			</p>
		</article>
	);
}
