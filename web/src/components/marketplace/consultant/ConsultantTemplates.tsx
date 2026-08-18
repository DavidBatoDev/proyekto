import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import type { ConsultantPublicTemplate } from "@/queries/consultants";

/**
 * Roadmap templates this consultant published.
 *
 * The ratings here are real — `roadmap_public_templates` carries
 * `rating_average` / `rating_count`, maintained by a trigger and only
 * ratable by someone who has used the template. That is why a star appears on
 * these cards and nowhere else on the profile.
 */
export function ConsultantTemplates({
	templates,
	isOwner,
	name,
}: {
	templates: ConsultantPublicTemplate[];
	isOwner: boolean;
	name: string;
}) {
	if (templates.length === 0) {
		return (
			<p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
				{isOwner
					? "You have not published a roadmap template yet. Publishing one puts your planning approach in front of every client browsing templates."
					: `${name} has not published any roadmap templates yet.`}
			</p>
		);
	}

	return (
		<div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{templates.map((template) => (
				<Link
					key={template.id}
					to="/roadmap-templates/$slug"
					params={{ slug: template.slug }}
					className="flex flex-col overflow-hidden rounded-xl border border-border transition-colors hover:border-foreground/30"
				>
					<img
						src={template.preview_url}
						alt={template.title}
						className="h-32 w-full object-cover"
						loading="lazy"
					/>
					<div className="flex flex-1 flex-col p-4">
						<h3 className="text-[15px] font-semibold leading-snug text-foreground">
							{template.title}
						</h3>
						<p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-muted-foreground">
							{template.summary}
						</p>
						<div className="mt-auto flex items-center gap-3 pt-4 text-[13px] text-muted-foreground">
							{template.rating_count > 0 && (
								<span className="inline-flex items-center gap-1 font-medium text-foreground">
									<Star className="h-3.5 w-3.5 fill-current" />
									{template.rating_average.toFixed(1)}
									<span className="font-normal text-muted-foreground">
										({template.rating_count})
									</span>
								</span>
							)}
							<span>{template.estimated_duration_days} days</span>
						</div>
					</div>
				</Link>
			))}
		</div>
	);
}
