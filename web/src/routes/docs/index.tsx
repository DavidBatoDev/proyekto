import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, MessageCircle } from "lucide-react";
import { DocsSectionCards, PopularCard } from "@/components/docs/DocsCards";
import { DocsSearch } from "@/components/docs/DocsSearch";
import { DOC_ARTICLES, popularArticles } from "@/content/docs.manifest";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { isNativeApp } from "@/lib/platform";

export const Route = createFileRoute("/docs/")({
	component: DocsHome,
});

function DocsHome() {
	useDocumentTitle("Docs");
	const popular = popularArticles();
	const native = isNativeApp();
	const count = DOC_ARTICLES.filter(
		(article) => !(native && article.surface === "web"),
	).length;

	return (
		<div className="mx-auto w-full max-w-[912px] px-5 py-10 md:px-10 md:py-14 lg:px-14">
			{/* A tinted band rather than bare text: the docs home is the one page
			    here with no sidebar context above it, so it has to introduce
			    itself. */}
			<section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 py-10 sm:px-10">
				<span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					<BookOpen className="h-3.5 w-3.5" aria-hidden />
					{count} articles
				</span>
				<h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground">
					Proyekto Docs
				</h1>
				<p className="mt-2.5 max-w-xl text-base leading-relaxed text-muted-foreground">
					How Proyekto works — planning the work, delivering it, and the people
					doing it.
				</p>
				<DocsSearch className="mt-7 max-w-lg" />
			</section>

			<section className="pt-14">
				<h2 className="text-xl font-semibold tracking-tight text-foreground">
					Start with these
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					The four pages most people need first.
				</p>
				<div className="mt-5 grid gap-4 sm:grid-cols-2">
					{popular.map((article) => (
						<PopularCard key={article.slug} article={article} />
					))}
				</div>
			</section>

			<section className="pt-14">
				<h2 className="text-xl font-semibold tracking-tight text-foreground">
					Browse by section
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Everything, grouped the way the product is.
				</p>
				<div className="mt-5">
					<DocsSectionCards />
				</div>
			</section>

			<section className="mt-14 flex flex-col gap-4 rounded-2xl border border-border bg-muted/40 px-6 py-7 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
						<MessageCircle className="h-5 w-5" aria-hidden />
					</span>
					<div>
						<h2 className="text-sm font-semibold text-foreground">
							Still stuck?
						</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">
							Tell us what you were trying to do and we will get back to you.
						</p>
					</div>
				</div>
				<Link
					to="/contact"
					className="inline-flex h-10 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
				>
					Contact us
				</Link>
			</section>
		</div>
	);
}
