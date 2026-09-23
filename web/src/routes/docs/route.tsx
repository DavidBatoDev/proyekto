import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { SiteDrawer } from "@/components/common/SiteDrawer";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
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
	const [navOpen, setNavOpen] = useState(false);

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
				<div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between px-5 sm:px-8">
					<div className="flex items-center gap-2 sm:gap-3">
						{/* The rail is `md:block`, so below that this is the only way
						    into the other 46 articles. */}
						<button
							type="button"
							aria-expanded={navOpen}
							aria-label="Open documentation menu"
							onClick={() => setNavOpen(true)}
							className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
						>
							<Menu className="h-5 w-5" aria-hidden />
						</button>
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
			</header>

			<SiteDrawer
				isOpen={navOpen}
				onClose={() => setNavOpen(false)}
				title="Docs"
			>
				<DocsSidebar />
			</SiteDrawer>

			<div className="mx-auto flex w-full max-w-[1400px]">
				<aside className="no-scrollbar sticky top-16 hidden h-[calc(100vh-4rem)] w-[300px] shrink-0 overflow-y-auto border-r border-border bg-card px-4 py-8 md:block">
					<DocsSidebar />
				</aside>
				<main className="min-w-0 flex-1">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
