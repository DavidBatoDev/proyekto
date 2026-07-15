import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

export function DashboardCreateActions() {
	return (
		<div className="flex w-fit shrink-0 flex-col items-start">
			<Link
				to="/project-posting"
				search={{ roadmapId: undefined }}
				data-hierarchy-level="project"
				className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:text-sm"
			>
				<Plus className="h-3.5 w-3.5" />
				Create project
			</Link>
			<div className="relative ml-12 mt-3">
				<span
					aria-hidden="true"
					className="absolute -left-6 -top-3 h-[calc(50%+0.75rem)] w-6 rounded-bl-2xl border-b-2 border-l-2 border-primary/30"
				/>
				<Link
					to="/project/$projectId/roadmap/create"
					params={{ projectId: "n" }}
					data-hierarchy-level="roadmap"
					className="relative inline-flex items-center gap-1.5 rounded-full border-2 border-primary bg-card px-3 py-1.5 text-[12px] font-semibold text-primary shadow-sm transition-colors hover:bg-primary/10 sm:text-[13px]"
				>
					<Plus className="h-3.5 w-3.5" />
					Create roadmap
				</Link>
			</div>
		</div>
	);
}
