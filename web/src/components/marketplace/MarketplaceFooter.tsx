import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand/BrandMark";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";

/**
 * The marketplace's link directory.
 *
 * Every entry points at a route that exists today — a footer full of dead links
 * is worse than a short one, and this is the surface people use to work out
 * what the product actually does. Categories come from the live taxonomy rather
 * than a duplicated hardcoded list, so retiring one cannot leave a 404 down
 * here.
 *
 * There is deliberately no social row, language picker or currency switcher:
 * the product has none of those, and a control that does nothing is a worse
 * lie in a footer than anywhere else, because that is where people go looking
 * for the real thing.
 */
export function MarketplaceFooter() {
	const { data: categories } = useMarketplaceCategoryNavigationQuery();

	return (
		<footer className="border-t border-border bg-card">
			<div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
				<div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-3 lg:grid-cols-5">
					<div>
						<h4 className="mb-3 text-[13px] font-semibold text-foreground">
							Categories
						</h4>
						<ul className="space-y-2 text-[12.5px] text-muted-foreground">
							{(categories ?? []).slice(0, 8).map((category) => (
								<li key={category.id}>
									<Link
										to="/marketplace/category/$categorySlug"
										params={{ categorySlug: category.slug }}
										preload="intent"
										className="transition-colors hover:text-foreground"
									>
										{category.name}
									</Link>
								</li>
							))}
						</ul>
					</div>

					<div>
						<h4 className="mb-3 text-[13px] font-semibold text-foreground">
							For clients
						</h4>
						<ul className="space-y-2 text-[12.5px] text-muted-foreground">
							<li>
								<Link
									to="/brief/new"
									search={{ need: undefined }}
									className="transition-colors hover:text-foreground"
								>
									Post a brief
								</Link>
							</li>
							<li>
								<Link
									to="/marketplace/consultant/browse"
									className="transition-colors hover:text-foreground"
								>
									Browse consultants
								</Link>
							</li>
							<li>
								<Link
									to="/marketplace/talent/browse"
									className="transition-colors hover:text-foreground"
								>
									Browse talent
								</Link>
							</li>
							<li>
								<Link
									to="/roadmap-templates"
									className="transition-colors hover:text-foreground"
								>
									Solution templates
								</Link>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="mb-3 text-[13px] font-semibold text-foreground">
							For consultants
						</h4>
						<ul className="space-y-2 text-[12.5px] text-muted-foreground">
							<li>
								<Link
									to="/start-selling"
									hash="lead-engagements"
									className="transition-colors hover:text-foreground"
								>
									Become a consultant
								</Link>
							</li>
							<li>
								<Link
									to="/marketplace/consultant/apply"
									className="transition-colors hover:text-foreground"
								>
									Apply to lead
								</Link>
							</li>
							<li>
								<Link
									to="/marketplace/consultant/templates"
									className="transition-colors hover:text-foreground"
								>
									Publish a template
								</Link>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="mb-3 text-[13px] font-semibold text-foreground">
							For talent
						</h4>
						<ul className="space-y-2 text-[12.5px] text-muted-foreground">
							{/* Above "Go live" on purpose: the landing page explains what
							    going live requires, and the wizard refuses people who
							    arrive without it. Mirrors "Become a consultant" sitting
							    above "Apply to lead" in the consultants column. */}
							<li>
								<Link
									to="/start-selling"
									className="transition-colors hover:text-foreground"
								>
									Start selling
								</Link>
							</li>
							<li>
								<Link
									to="/marketplace/talent/go-live"
									className="transition-colors hover:text-foreground"
								>
									Go live
								</Link>
							</li>
							<li>
								<Link
									to="/marketplace/talent/browse"
									className="transition-colors hover:text-foreground"
								>
									Find work
								</Link>
							</li>
							<li>
								<Link
									to="/invites"
									search={{ inviteId: undefined }}
									className="transition-colors hover:text-foreground"
								>
									Invitations
								</Link>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="mb-3 text-[13px] font-semibold text-foreground">
							Your workspace
						</h4>
						<ul className="space-y-2 text-[12.5px] text-muted-foreground">
							<li>
								<Link
									to="/dashboard"
									className="transition-colors hover:text-foreground"
								>
									Dashboard
								</Link>
							</li>
							<li>
								<Link
									to="/notifications"
									className="transition-colors hover:text-foreground"
								>
									Notifications
								</Link>
							</li>
							<li>
								<Link
									to="/settings"
									className="transition-colors hover:text-foreground"
								>
									Settings
								</Link>
							</li>
						</ul>
					</div>
				</div>

				<div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
					<Link to="/" className="w-fit">
						<BrandMark className="h-7 text-primary" />
					</Link>
					<p className="text-[12px] text-muted-foreground">
						© {new Date().getFullYear()} Proyekto. Managed delivery for digital
						projects.
					</p>
				</div>
			</div>
		</footer>
	);
}
