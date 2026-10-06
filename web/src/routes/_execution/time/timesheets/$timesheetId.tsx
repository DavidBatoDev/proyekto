import { createFileRoute } from "@tanstack/react-router";
import { TimesheetReview } from "@/components/time/review/TimesheetReview";
import { validateTimesheetReviewSearch } from "@/lib/timeSearch";

/**
 * `/time/timesheets/<id>`: the timesheet review screen (ux.md › Approvals),
 * shared by the submitter, the deciders and team managers who can view it.
 * `?entry=<id>` opens that entry's detail over the screen; closing it drops
 * the param. Anyone who can't open the sheet gets the 404 card.
 */
export const Route = createFileRoute(
	"/_execution/time/timesheets/$timesheetId",
)({
	validateSearch: validateTimesheetReviewSearch,
	component: TimesheetReviewRoute,
});

function TimesheetReviewRoute() {
	const { timesheetId } = Route.useParams();
	const { entry } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<TimesheetReview
			timesheetId={timesheetId}
			entryId={entry ?? null}
			onOpenEntry={(entryId) =>
				void navigate({ search: (prev) => ({ ...prev, entry: entryId }) })
			}
			onCloseEntry={() =>
				void navigate({
					search: (prev) => ({ ...prev, entry: undefined }),
					replace: true,
				})
			}
		/>
	);
}
