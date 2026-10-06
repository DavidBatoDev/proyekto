import { createFileRoute } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import { validateTimePageSearch } from "@/lib/timeSearch";

/**
 * `/time`: the one personal Time page (ux.md › The Time Page). Search params
 * are final (`for`, `project`, `week`, `entry`; see lib/timeSearch.ts); the
 * body is a placeholder until the page package replaces it.
 */
export const Route = createFileRoute("/_execution/time/")({
	validateSearch: validateTimePageSearch,
	component: TimePagePlaceholder,
});

function TimePagePlaceholder() {
	return (
		<div className="p-4 sm:p-6">
			<AppEmptyState
				icon={Clock}
				title="Coming together"
				description="Time is being set up here."
			/>
		</div>
	);
}
