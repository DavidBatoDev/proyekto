import { createFileRoute } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import { validateTimesheetReviewSearch } from "@/lib/timeSearch";

/**
 * `/time/timesheets/<id>`: the timesheet review screen (ux.md › Approvals),
 * shared by the submitter, the deciders and team managers who can view it.
 * Search params are final (`entry`); the body is a placeholder until the
 * review package replaces it.
 */
export const Route = createFileRoute(
	"/_execution/time/timesheets/$timesheetId",
)({
	validateSearch: validateTimesheetReviewSearch,
	component: TimesheetReviewPlaceholder,
});

function TimesheetReviewPlaceholder() {
	return (
		<div className="p-4 sm:p-6">
			<AppEmptyState
				icon={Clock}
				title="Coming together"
				description="Timesheet review is being set up here."
			/>
		</div>
	);
}
