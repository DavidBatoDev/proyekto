import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand/BrandMark";
import { DocsSidebar, DocsTabStrip } from "@/components/docs/DocsSidebar";
import { NotFoundRoute } from "@/components/layout/NotFoundRoute";

/**
 * The documentation site.
 *
 * It carries its own slim header rather than the app chrome, for the reason
 * `/pricing` does: this is a public page someone may land on from a search
 * result with no account, and the dashboard header would be wrong above it.
 * It is deliberately absent from `Header.tsx` `validPaths`.
 *
 * `notFoundComponent` is not optional — without it an unmatched `/docs/*` path
 * renders this layout with an empty Outlet, which is a blank page, instead of
 * bubbling to the root handler that forwards legacy URLs.
 */
export const Route = createFileRoute("/docs")({
	component: DocsLayout,
	notFoundComponent: NotFoundRoute,
});

function DocsLayout() {
	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
				<div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between px-5 sm:px-8">
					<div className="flex items-center gap-3">
						<Link to="/" aria-label="Proyekto home">
							<BrandMark variant="lockup" className="h-8" />
						</Link>
						<span className="hidden h-5 w-px bg-border sm:block" />
						<Link
							to="/docs"
							className="hidden text-sm font-semibold text-foreground sm:block"
						>
							Docs
						</Link>
					</div>
					<div className="flex items-center gap-2">
						<Link
							to="/auth/login"
							search={{ redirect: undefined }}
							className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							Log in
						</Link>
						<Link
							to="/auth/signup"
							search={{ redirect: undefined }}
							className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
						>
							Get started
						</Link>
					</div>
				</div>
				<DocsTabStrip />
			</header>

			<div className="mx-auto flex w-full max-w-[1400px]">
				<aside className="hidden h-[calc(100vh-4rem)] w-[248px] shrink-0 overflow-y-auto border-r border-border px-3 py-8 md:block sticky top-16">
					<DocsSidebar />
				</aside>
				<main className="min-w-0 flex-1">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
