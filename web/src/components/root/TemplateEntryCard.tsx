import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowUpRight, Star } from "lucide-react";
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";
import type { RoadmapTemplateSummary } from "@/types/roadmap-template";

export type TemplateEntry = RoadmapTemplateSummary;

export function TemplateEntryCard({
	template,
	index,
}: {
	template: TemplateEntry;
	index: number;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 18 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-30px" }}
			transition={{ duration: 0.26, delay: index * 0.04 }}
		>
			<RoadmapPreviewCard
				variant="template"
				interactive
				title={template.title}
				description={template.summary}
				epics={template.preview.epics}
				status={
					<span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
						Free
					</span>
				}
				footerLeading={
					<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
						{template.rating_count > 0 ? (
							<Star className="h-3 w-3 fill-amber-400 text-amber-400" />
						) : null}
						{template.rating_count > 0
							? template.rating_average.toFixed(1)
							: template.category.name}
					</span>
				}
				footerAction={
					<Link
						to="/roadmap-templates/$slug"
						params={{ slug: template.slug }}
						onClick={(event) => event.stopPropagation()}
						className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-foreground px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-background shadow-(--app-shadow-sm) transition-opacity hover:opacity-85"
					>
						Use template
						<ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
					</Link>
				}
			/>
		</motion.div>
	);
}
