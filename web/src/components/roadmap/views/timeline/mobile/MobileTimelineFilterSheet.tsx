import { AppDialog } from "@/components/common/AppDialog";
import type { AssigneeProfile, FeatureStatus } from "@/types/roadmap";
import {
	countActiveFilters,
	EMPTY_TIMELINE_FILTERS,
	SCHEDULE_LABELS,
	type ScheduleFilter,
	STATUS_LABELS,
	type TimelineFilters,
} from "../components/TimelineFilterMenu";

interface MobileTimelineFilterSheetProps {
	open: boolean;
	filters: TimelineFilters;
	assignees: AssigneeProfile[];
	onChange: (filters: TimelineFilters) => void;
	onClose: () => void;
}

const STATUSES = Object.keys(STATUS_LABELS) as FeatureStatus[];
const SCHEDULES = Object.keys(SCHEDULE_LABELS) as ScheduleFilter[];

const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
	const next = new Set(set);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return next;
};

const chipClass = (active: boolean): string =>
	`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
		active
			? "border-blue-600 bg-blue-50 text-blue-700"
			: "border-gray-300 bg-white text-gray-700"
	}`;

/**
 * `TimelineFilterMenu` in sheet form. The desktop component bundles its own
 * trigger and anchored popover, neither of which works on a phone, so this
 * re-lays the same options — importing its labels and its `TimelineFilters`
 * shape so the two cannot drift.
 */
export const MobileTimelineFilterSheet = ({
	open,
	filters,
	assignees,
	onChange,
	onClose,
}: MobileTimelineFilterSheetProps) => {
	const activeCount = countActiveFilters(filters);

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			variant="bottom-sheet"
			title="Filters"
			footer={
				<div className="flex items-center justify-between gap-3">
					<button
						type="button"
						onClick={() => onChange(EMPTY_TIMELINE_FILTERS)}
						disabled={activeCount === 0}
						className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 disabled:opacity-40"
					>
						Clear all
					</button>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white"
					>
						Done
					</button>
				</div>
			}
		>
			<div className="space-y-5 px-5 py-4">
				<section>
					<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
						Status
					</h3>
					<div className="flex flex-wrap gap-2">
						{STATUSES.map((status) => (
							<button
								type="button"
								key={status}
								onClick={() =>
									onChange({
										...filters,
										statuses: toggle(filters.statuses, status),
									})
								}
								aria-pressed={filters.statuses.has(status)}
								className={chipClass(filters.statuses.has(status))}
							>
								{STATUS_LABELS[status]}
							</button>
						))}
					</div>
				</section>

				<section>
					<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
						Schedule
					</h3>
					<div className="flex flex-wrap gap-2">
						{SCHEDULES.map((schedule) => (
							<button
								type="button"
								key={schedule}
								onClick={() => onChange({ ...filters, schedule })}
								aria-pressed={filters.schedule === schedule}
								className={chipClass(filters.schedule === schedule)}
							>
								{SCHEDULE_LABELS[schedule]}
							</button>
						))}
					</div>
				</section>

				{assignees.length > 0 && (
					<section>
						<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
							Assignee
						</h3>
						<div className="flex flex-wrap gap-2">
							{assignees.map((assignee) => (
								<button
									type="button"
									key={assignee.id}
									onClick={() =>
										onChange({
											...filters,
											assigneeIds: toggle(filters.assigneeIds, assignee.id),
										})
									}
									aria-pressed={filters.assigneeIds.has(assignee.id)}
									className={`max-w-[12rem] truncate ${chipClass(
										filters.assigneeIds.has(assignee.id),
									)}`}
								>
									{assignee.display_name ?? assignee.email ?? "Unnamed member"}
								</button>
							))}
						</div>
					</section>
				)}
			</div>
		</AppDialog>
	);
};
