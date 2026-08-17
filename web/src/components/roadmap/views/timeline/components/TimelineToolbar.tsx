import {
	CalendarPlus,
	ChevronLeft,
	ChevronRight,
	MoreHorizontal,
	PencilRuler,
	Search,
	TriangleAlert,
} from "lucide-react";
import type { AssigneeProfile } from "@/types/roadmap";
import { G_LABELS, GRANULARITIES } from "../../milestones/model/constants";
import type { Granularity } from "../../milestones/model/types";
import { TimelineFilterMenu, type TimelineFilters } from "./TimelineFilterMenu";

interface TimelineToolbarProps {
	periodLabel: string;
	query: string;
	granularity: Granularity;
	isDrawMode: boolean;
	canEditDates: boolean;
	matchCount: number | null;
	conflictCount: number;
	hiddenDependencyCount: number;
	filters: TimelineFilters;
	assignees: AssigneeProfile[];
	onFiltersChange: (filters: TimelineFilters) => void;
	onQueryChange: (value: string) => void;
	onGranularityChange: (granularity: Granularity) => void;
	onToggleDrawMode: () => void;
	onStepPeriod: (direction: -1 | 1) => void;
	onToday: () => void;
	onAddMilestone: () => void;
}

export const TimelineToolbar = ({
	periodLabel,
	query,
	granularity,
	isDrawMode,
	canEditDates,
	matchCount,
	conflictCount,
	hiddenDependencyCount,
	filters,
	assignees,
	onFiltersChange,
	onQueryChange,
	onGranularityChange,
	onToggleDrawMode,
	onStepPeriod,
	onToday,
	onAddMilestone,
}: TimelineToolbarProps) => {
	return (
		<div className="flex w-full min-w-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
			<div className="relative w-64 max-w-[40%]">
				<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
				<input
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder="Search"
					className="w-full rounded border border-gray-300 py-1.5 pl-8 pr-3 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
				/>
				{query && matchCount !== null && (
					<span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">
						{matchCount}
					</span>
				)}
			</div>

			<div className="ml-auto flex items-center gap-2">
				{conflictCount > 0 && (
					<span
						className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-700"
						title="Some work is scheduled to start before the work it depends on finishes"
					>
						<TriangleAlert className="h-3.5 w-3.5" />
						{conflictCount}
					</span>
				)}
				{hiddenDependencyCount > 0 && (
					<span
						className="text-[12px] text-gray-400"
						title="Links whose other end is filtered out or has no dates"
					>
						{hiddenDependencyCount} hidden
					</span>
				)}
				<span className="min-w-[120px] text-right text-[13px] font-semibold text-gray-700">
					{periodLabel}
				</span>

				<div className="flex items-center">
					<button
						type="button"
						onClick={() => onStepPeriod(-1)}
						className="rounded p-1 text-gray-500 hover:bg-gray-100"
						aria-label="Previous period"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => onStepPeriod(1)}
						className="rounded p-1 text-gray-500 hover:bg-gray-100"
						aria-label="Next period"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>

				<button
					type="button"
					onClick={onToday}
					className="rounded bg-gray-100 px-3 py-1 text-[13px] font-medium text-gray-700 hover:bg-gray-200"
				>
					Today
				</button>

				<div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 px-1">
					{GRANULARITIES.map((item) => (
						<button
							type="button"
							key={item}
							onClick={() => onGranularityChange(item)}
							className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${
								granularity === item
									? "bg-gray-900 text-white"
									: "text-gray-500 hover:bg-gray-100"
							}`}
						>
							{G_LABELS[item]}
						</button>
					))}
				</div>

				{canEditDates && (
					<button
						type="button"
						onClick={onToggleDrawMode}
						title={
							isDrawMode
								? "Exit draw mode"
								: "Draw a date range on any row that has none"
						}
						className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium ${
							isDrawMode
								? "bg-gray-900 text-white"
								: "text-gray-600 hover:bg-gray-100"
						}`}
					>
						<PencilRuler className="h-3.5 w-3.5" />
						Draw timeline
					</button>
				)}

				<TimelineFilterMenu
					filters={filters}
					assignees={assignees}
					onChange={onFiltersChange}
				/>

				{canEditDates && (
					<button
						type="button"
						onClick={onAddMilestone}
						title="Add milestone"
						className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-gray-600 hover:bg-gray-100"
					>
						<CalendarPlus className="h-3.5 w-3.5" />
						Milestone
					</button>
				)}

				<button
					type="button"
					disabled
					title="Coming soon"
					className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-gray-300"
				>
					<MoreHorizontal className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
};
