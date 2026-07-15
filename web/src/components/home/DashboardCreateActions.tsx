import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

const actionClassName =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:px-3 sm:text-sm";

export function DashboardCreateActions() {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
			<Link
				to="/project-posting"
				search={{ roadmapId: undefined }}
				className={actionClassName}
			>
				<Plus className="h-3.5 w-3.5" />
				Create project
			</Link>
			<Link
				to="/project/$projectId/roadmap/create"
				params={{ projectId: "n" }}
				className={actionClassName}
			>
				<Plus className="h-3.5 w-3.5" />
				Create roadmap
			</Link>
		</div>
	);
}
