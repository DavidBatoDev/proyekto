import { Link } from "@tanstack/react-router";
import { Info, Plus } from "lucide-react";
import { useId } from "react";

export function DashboardCreateActions() {
	const roadmapNoticeId = useId();

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
			<div className="relative ml-12 mt-3 flex items-center gap-2">
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
				<span className="group/notice relative inline-flex">
					<button
						type="button"
						aria-label="About roadmap integration"
						aria-describedby={roadmapNoticeId}
						className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					>
						<Info className="h-4 w-4" />
					</button>
					<span
						id={roadmapNoticeId}
						role="tooltip"
						className="pointer-events-none invisible absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-border bg-popover px-3 py-2 text-xs font-medium leading-5 text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/notice:visible group-hover/notice:opacity-100 group-focus-within/notice:visible group-focus-within/notice:opacity-100"
					>
						A roadmap can be integrated to a project
					</span>
				</span>
			</div>
		</div>
	);
}
