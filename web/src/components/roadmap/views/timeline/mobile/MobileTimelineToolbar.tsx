import {
	ChevronLeft,
	ChevronRight,
	ListFilter,
	PanelLeftClose,
	PanelLeftOpen,
	Search,
	TriangleAlert,
	X,
} from "lucide-react";
import { G_LABELS, GRANULARITIES } from "../../milestones/model/constants";
import type { Granularity } from "../../milestones/model/types";
import {
	countActiveFilters,
	type TimelineFilters,
} from "../components/TimelineFilterMenu";

interface MobileTimelineToolbarProps {
	periodLabel: string;
	granularity: Granularity;
	query: string;
	filters: TimelineFilters;
	matchCount: number | null;
	conflictCount: number;
	isSearchOpen: boolean;
	isTaskColumnOpen: boolean;
	onToggleTaskColumn: () => void;
	onToggleSearch: () => void;
	onQueryChange: (value: string) => void;
	onGranularityChange: (granularity: Granularity) => void;
	onStepPeriod: (direction: -1 | 1) => void;
	onToday: () => void;
	onOpenFilters: () => void;
}

/**
 * The phone-sized replacement for `TimelineToolbar`, which packs ten controls
 * into one `flex-wrap` row and would stack three or four deep here, eating the
 * chart.
 *
 * Two fixed rows: navigation, then the time scale as a full-width segmented
 * control. Search collapses into a third row only while it is in use, and the
 * filters move behind a sheet. Every control clears a 40px touch target.
 */
export const MobileTimelineToolbar = ({
	periodLabel,
	granularity,
	query,
	filters,
	matchCount,
	conflictCount,
	isSearchOpen,
	isTaskColumnOpen,
	onToggleTaskColumn,
	onToggleSearch,
	onQueryChange,
	onGranularityChange,
	onStepPeriod,
	onToday,
	onOpenFilters,
}: MobileTimelineToolbarProps) => {
	const activeFilterCount = countActiveFilters(filters);

	return (
		<div className="shrink-0 border-b border-gray-200 bg-white">
			<div className="flex items-center gap-1 px-2 py-1.5">
				<button
					type="button"
					onClick={onToggleTaskColumn}
					aria-pressed={!isTaskColumnOpen}
					aria-label={
						isTaskColumnOpen ? "Hide the name column" : "Show the name column"
					}
					title={
						isTaskColumnOpen ? "Hide the name column" : "Show the name column"
					}
					className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
						isTaskColumnOpen
							? "text-gray-500 active:bg-gray-100"
							: "bg-blue-50 text-blue-700"
					}`}
				>
					{isTaskColumnOpen ? (
						<PanelLeftClose className="h-[18px] w-[18px]" />
					) : (
						<PanelLeftOpen className="h-[18px] w-[18px]" />
					)}
				</button>

				<button
					type="button"
					onClick={() => onStepPeriod(-1)}
					className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-gray-100"
					aria-label="Previous month"
				>
					<ChevronLeft className="h-5 w-5" />
				</button>

				<span className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold text-gray-800">
					{periodLabel}
				</span>

				<button
					type="button"
					onClick={() => onStepPeriod(1)}
					className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-gray-100"
					aria-label="Next month"
				>
					<ChevronRight className="h-5 w-5" />
				</button>

				<button
					type="button"
					onClick={onToday}
					className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-[13px] font-medium text-gray-700 active:bg-gray-200"
				>
					Today
				</button>

				<button
					type="button"
					onClick={onToggleSearch}
					aria-label={isSearchOpen ? "Close search" : "Search"}
					aria-pressed={isSearchOpen}
					className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
						isSearchOpen || query
							? "bg-blue-50 text-blue-700"
							: "text-gray-500 active:bg-gray-100"
					}`}
				>
					<Search className="h-[18px] w-[18px]" />
				</button>

				<button
					type="button"
					onClick={onOpenFilters}
					aria-label="Filters"
					className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
						activeFilterCount > 0
							? "bg-blue-50 text-blue-700"
							: "text-gray-500 active:bg-gray-100"
					}`}
				>
					<ListFilter className="h-[18px] w-[18px]" />
					{activeFilterCount > 0 && (
						<span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
							{activeFilterCount}
						</span>
					)}
				</button>
			</div>

			{isSearchOpen && (
				<div className="flex items-center gap-2 px-2 pb-1.5">
					<div className="relative min-w-0 flex-1">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
						<input
							// The field only exists once the user taps search, so focusing
							// it is the whole point of the tap.
							autoFocus
							value={query}
							onChange={(event) => onQueryChange(event.target.value)}
							placeholder="Search epics and features"
							className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-14 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
						/>
						{query && matchCount !== null && (
							<span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">
								{matchCount}
							</span>
						)}
					</div>
					<button
						type="button"
						onClick={onToggleSearch}
						aria-label="Close search"
						className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-gray-100"
					>
						<X className="h-[18px] w-[18px]" />
					</button>
				</div>
			)}

			<div className="flex items-center gap-1 px-2 pb-1.5">
				<div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
					{GRANULARITIES.map((item) => (
						<button
							type="button"
							key={item}
							onClick={() => onGranularityChange(item)}
							aria-pressed={granularity === item}
							className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition-colors ${
								granularity === item
									? "bg-white text-gray-900 shadow-sm"
									: "text-gray-500"
							}`}
						>
							{G_LABELS[item]}
						</button>
					))}
				</div>

				{conflictCount > 0 && (
					<span
						className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[12px] font-medium text-amber-700"
						title="Some work is scheduled to start before the work it depends on finishes"
					>
						<TriangleAlert className="h-3.5 w-3.5" />
						{conflictCount}
					</span>
				)}
			</div>
		</div>
	);
};
