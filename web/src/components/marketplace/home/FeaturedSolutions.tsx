import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Star } from "lucide-react";
import { getFeaturedRoadmapTemplates } from "@/api";

/**
 * Published roadmap templates, presented as what a buyer is actually shopping
 * for: a scoped plan with a shape, a duration and a track record.
 *
 * This is the marketplace's differentiator made visible before the sale — the
 * buyer sees the roadmap they would get, not just a person's rate card. Every
 * figure shown (duration, rating, uses) is a real column on
 * `roadmap_public_templates`; nothing is invented to fill the card.
 */
export function FeaturedSolutions() {
	const { data, isPending } = useQuery({
		queryKey: ["roadmap-templates", "featured"],
		queryFn: getFeaturedRoadmapTemplates,
		staleTime: 1000 * 60 * 10,
	});

	const items = data?.items?.slice(0, 6) ?? [];
	if (!isPending && items.length === 0) return null;

	return (
		<section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
			<div className="flex items-end justify-between gap-4">
				<div>
					<h2 className="text-[17px] font-semibold text-foreground">
						Solutions you can start from
					</h2>
					<p className="mt-0.5 text-[13px] text-muted-foreground">
						Proven roadmaps, scoped and ready to adapt.
					</p>
				</div>
				<Link
					to="/roadmap-templates"
					className="shrink-0 text-[13px] font-medium text-primary hover:underline"
				>
					See all
				</Link>
			</div>

			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{isPending
					? Array.from({ length: 3 }, (_, index) => (
							<div
								key={`solution-skeleton-${index}`}
								className="h-[132px] animate-pulse rounded-xl border border-border bg-card"
							/>
						))
					: items.map((template) => (
							<Link
								key={template.id}
								to="/roadmap-templates/$slug"
								params={{ slug: template.slug }}
								preload="intent"
								className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
							>
								<span className="text-[11px] font-medium uppercase tracking-wide text-primary">
									{template.category.name}
								</span>
								<span className="mt-1.5 line-clamp-1 text-[14px] font-semibold text-foreground">
									{template.title}
								</span>
								<span className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">
									{template.summary}
								</span>
								<span className="mt-3 flex items-center gap-3 text-[12px] text-muted-foreground">
									<span className="inline-flex items-center gap-1">
										<Clock className="h-3.5 w-3.5" />
										{template.schedule.estimated_duration_days}d
									</span>
									{template.rating_count > 0 && (
										<span className="inline-flex items-center gap-1">
											<Star className="h-3.5 w-3.5" />
											{template.rating_average.toFixed(1)}
										</span>
									)}
									{template.use_count > 0 && (
										<span>{template.use_count} used</span>
									)}
									<ArrowRight className="ml-auto h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
								</span>
							</Link>
						))}
			</div>
		</section>
	);
}
