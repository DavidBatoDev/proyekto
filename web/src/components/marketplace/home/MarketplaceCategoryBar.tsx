import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getRoadmapTemplateCategories } from "@/api";

/**
 * The category strip across the top of the marketplace home.
 *
 * Categories are the real `roadmap_template_categories` rows, not a hardcoded
 * list, so the strip stays in step with the catalogue as it grows. Every entry
 * links to the template catalogue: `/roadmap-templates` has no category search
 * param yet, so this cannot deep-link into a filtered view — noted rather than
 * faked with a param the route would reject.
 */
export function MarketplaceCategoryBar() {
	const { data: categories } = useQuery({
		queryKey: ["roadmap-template-categories"],
		queryFn: getRoadmapTemplateCategories,
		staleTime: 1000 * 60 * 30,
	});

	if (!categories?.length) return null;

	return (
		<nav
			aria-label="Marketplace categories"
			className="border-b border-border bg-card"
		>
			<div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-2.5 sm:px-6 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{categories.slice(0, 10).map((category) => (
					<Link
						key={category.id}
						to="/roadmap-templates"
						preload="intent"
						className="whitespace-nowrap text-[13px] text-muted-foreground transition-colors hover:text-foreground"
					>
						{category.name}
					</Link>
				))}
			</div>
		</nav>
	);
}
