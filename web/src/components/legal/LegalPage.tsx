import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * The shell both legal pages share.
 *
 * Built like `/pricing`: its own slim sticky header, one reading column, no
 * motion. These are documents someone reads top to bottom — and, more often,
 * documents a store reviewer opens from a listing URL with no account — so the
 * app chrome would be wrong above them and they are deliberately absent from
 * `Header.tsx` `validPaths`.
 *
 * The measure is `max-w-3xl` rather than pricing's `max-w-6xl`: this is
 * continuous prose, and 6xl gives lines too long to track.
 */

export interface LegalSection {
	/** Used as the heading and as the anchor id. */
	id: string;
	heading: string;
	body: ReactNode;
}

export function LegalPage({
	title,
	intro,
	updated,
	sections,
}: {
	title: string;
	intro: string;
	updated: string;
	sections: LegalSection[];
}) {
	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
				<div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5 sm:px-8">
					<Link to="/" aria-label="Proyekto home">
						<BrandMark variant="lockup" className="h-8" />
					</Link>
					<div className="flex items-center gap-2">
						<Link
							to="/docs"
							className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							Docs
						</Link>
						<Link
							to="/contact"
							className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							Contact
						</Link>
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-3xl px-5 pb-24 sm:px-8">
				<section className="pb-8 pt-16">
					<h1 className="text-4xl font-bold tracking-tight text-foreground">
						{title}
					</h1>
					<p className="mt-3 text-base leading-relaxed text-muted-foreground">
						{intro}
					</p>
					<p className="mt-4 text-sm text-muted-foreground">
						Last updated {updated}
					</p>
				</section>

				{/* A contents list: these run long, and a reviewer or a user is
				    usually looking for one specific clause. */}
				<nav
					aria-label="Contents"
					className="rounded-2xl border border-border bg-card px-5 py-4"
				>
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						Contents
					</p>
					<ol className="mt-3 space-y-1.5">
						{sections.map((section, index) => (
							<li key={section.id}>
								<a
									href={`#${section.id}`}
									className="text-sm text-muted-foreground transition-colors hover:text-foreground"
								>
									<span className="tabular-nums">{index + 1}.</span>{" "}
									{section.heading}
								</a>
							</li>
						))}
					</ol>
				</nav>

				<div className="mt-4">
					{sections.map((section, index) => (
						<section
							key={section.id}
							id={section.id}
							className="scroll-mt-24 border-t border-border pt-10 [&:first-child]:border-t-0"
						>
							<h2 className="mt-10 text-xl font-semibold tracking-tight text-foreground">
								<span className="tabular-nums text-muted-foreground">
									{index + 1}.
								</span>{" "}
								{section.heading}
							</h2>
							<div className="mt-3 space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
								{section.body}
							</div>
						</section>
					))}
				</div>

				<p className="mt-14 rounded-2xl border border-border bg-muted/40 px-5 py-4 text-sm leading-relaxed text-muted-foreground">
					Questions about this document?{" "}
					<Link
						to="/contact"
						className="font-medium text-primary underline underline-offset-4"
					>
						Get in touch
					</Link>{" "}
					— a person reads those.
				</p>
			</main>
		</div>
	);
}
