import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getRoadmapTemplateCategories } from "@/api";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * The marketplace's link directory.
 *
 * Every entry points at a route that exists today — a footer full of dead links
 * is worse than a short one, and this is the surface people use to work out
 * what the product actually does. Categories come from the live catalogue
 * rather than a duplicated hardcoded list.
 */
export function MarketplaceFooter() {
	const { data: categories } = useQuery({
		queryKey: ["roadmap-template-categories"],
		queryFn: getRoadmapTemplateCategories,
		staleTime: 1000 * 60 * 30,
	});

	return (
		<footer className="mt-14 border-t border-border bg-card">
			<div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
				<div className="grid grid-cols-2 gap-8 md:grid-cols-4">
					<div>
						<h4 className="mb-3 text-[13px] font-semibold text-foreground">
							Categories
						</h4>
						<ul className="space-y-2 text-[12.5px] text-muted-foreground">
							{(categories ?? []).slice(0, 6).map((category) => (
								<li key={category.id}>
									<Link
										to="/roadmap-templates"
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
									to="/marketplace/project-posting"
									search={{ roadmapId: undefined }}
									className="transition-colors hover:text-foreground"
								>
									Post a project
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
									to="/marketplace/consultant"
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
									to="/marketplace/talent"
									className="transition-colors hover:text-foreground"
								>
									Find work
								</Link>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="mb-3 text-[13px] font-semibold text-foreground">
							For talent
						</h4>
						<ul className="space-y-2 text-[12.5px] text-muted-foreground">
							<li>
								<Link
									to="/marketplace/freelancer/go-live"
									className="transition-colors hover:text-foreground"
								>
									Go live
								</Link>
							</li>
							<li>
								<Link
									to="/dashboard"
									className="transition-colors hover:text-foreground"
								>
									Your workspace
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
