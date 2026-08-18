import { Link } from "@tanstack/react-router";

/**
 * What a visitor sees on a category with no consultants yet.
 *
 * This is the common case at launch, not an edge case: the taxonomy shipped
 * before enrolment filled it in, so nearly every category page renders this.
 * It is treated as a landing page rather than a fallback - it names the gap
 * honestly, routes consultants toward applying, and gives everyone else
 * somewhere useful to go.
 *
 * Uses the token-based surface from the templates catalogue rather than
 * `AppEmptyState`, which hardcodes a light slate palette and would render a
 * white card in dark mode.
 */
export function CategoryEmptyState({ label }: { label: string }) {
	return (
		<div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
			<p className="text-[15px] font-semibold text-foreground">
				No consultants in {label} yet
			</p>
			<p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
				This category is new and still being staffed. Consultants are reviewed
				and verified before they can take work, so it fills in deliberately
				rather than all at once.
			</p>

			<div className="mt-5 flex flex-wrap items-center justify-center gap-3">
				<Link
					to="/marketplace/consultant/apply"
					className="rounded-xl bg-foreground px-4 py-2 text-[13px] font-bold text-background transition-opacity hover:opacity-90"
				>
					Apply to consult here
				</Link>
				<Link
					to="/roadmap-templates"
					className="rounded-xl border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
				>
					Browse roadmap templates
				</Link>
			</div>

			<Link
				to="/marketplace/consultant/browse"
				className="mt-4 inline-block text-[12.5px] font-medium text-primary hover:underline"
			>
				See every consultant instead
			</Link>
		</div>
	);
}
