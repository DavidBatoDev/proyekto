import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The trail across the top of every finance page.
 *
 * Worth having only now that the sections are addressable: while they were
 * `?tab=` values there was nothing above a page to point back at, so a
 * breadcrumb would have been decoration. It takes rendered nodes rather than
 * `{label, to}` objects because the router's `to` is typed per route, and a
 * generic crumb type would have to widen it to `string` and lose that.
 *
 * The last item is the current page and is rendered as plain text by the
 * caller, not a link.
 */
export function FinanceBreadcrumbs({ items }: { items: ReactNode[] }) {
	return (
		<nav aria-label="Breadcrumb">
			<ol className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
				{/* Crumbs are positional and have no id of their own; the list is
			    rebuilt whenever the route changes, so the index is stable for as
			    long as the list exists. */}
				{items.map((item, index) => (
					<li key={index} className="flex items-center gap-1">
						{index > 0 && (
							<ChevronRight
								aria-hidden="true"
								className="h-3 w-3 shrink-0 text-muted-foreground/60"
							/>
						)}
						{item}
					</li>
				))}
			</ol>
		</nav>
	);
}

/** Shared styling for the clickable crumbs, so they match across pages. */
export const FINANCE_CRUMB_LINK_CLASS =
	"rounded-sm text-muted-foreground transition-colors hover:text-foreground hover:underline";

/** The final, non-navigable crumb naming the page you are on. */
export function FinanceCurrentCrumb({ children }: { children: ReactNode }) {
	return (
		<span aria-current="page" className="font-medium text-foreground">
			{children}
		</span>
	);
}
