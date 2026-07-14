import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";

export type TemplateEntry = {
	id: string;
	name: string;
	category: "SaaS" | "AI" | "Web Apps" | "E-commerce";
	description: string;
	milestones: string[];
};

type Props = {
	template: TemplateEntry;
	index: number;
};

export function TemplateEntryCard({ template, index }: Props) {
	const epics = template.milestones.map((milestone, milestoneIndex) => ({
		id: `${template.id}-${milestoneIndex}`,
		title: milestone,
		position: milestoneIndex,
	}));

	return (
		<motion.div
			initial={{ opacity: 0, y: 18 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-30px" }}
			transition={{ duration: 0.26, delay: index * 0.04 }}
		>
			<RoadmapPreviewCard
				variant="template"
				title={template.name}
				description={template.description}
				epics={epics}
				status={
					<span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
						Template
					</span>
				}
				footerLeading={
					<span className="text-[11px] text-slate-500">
						{template.category} template
					</span>
				}
				footerAction={
					<Link
						to="/auth/signup"
						search={{ redirect: window.location.pathname }}
						className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-900 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-slate-700"
					>
						Use template
						<ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
					</Link>
				}
			/>
		</motion.div>
	);
}
