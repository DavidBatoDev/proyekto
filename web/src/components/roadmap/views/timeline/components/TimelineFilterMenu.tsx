import { ListFilter, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssigneeProfile, FeatureStatus } from "@/types/roadmap";

export type ScheduleFilter = "all" | "scheduled" | "unscheduled";

export interface TimelineFilters {
	statuses: ReadonlySet<FeatureStatus>;
	assigneeIds: ReadonlySet<string>;
	schedule: ScheduleFilter;
}

export const EMPTY_TIMELINE_FILTERS: TimelineFilters = {
	statuses: new Set<FeatureStatus>(),
	assigneeIds: new Set<string>(),
	schedule: "all",
};

export const countActiveFilters = (filters: TimelineFilters): number =>
	filters.statuses.size +
	filters.assigneeIds.size +
	(filters.schedule === "all" ? 0 : 1);

export const STATUS_LABELS: Record<FeatureStatus, string> = {
	not_started: "Not started",
	in_progress: "In progress",
	in_review: "In review",
	completed: "Completed",
	blocked: "Blocked",
};

export const SCHEDULE_LABELS: Record<ScheduleFilter, string> = {
	all: "All",
	scheduled: "Scheduled",
	unscheduled: "No dates",
};

interface TimelineFilterMenuProps {
	filters: TimelineFilters;
	assignees: AssigneeProfile[];
	onChange: (filters: TimelineFilters) => void;
}

const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
	const next = new Set(set);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return next;
};

export const TimelineFilterMenu = ({
	filters,
	assignees,
	onChange,
}: TimelineFilterMenuProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const activeCount = countActiveFilters(filters);

	useEffect(() => {
		if (!isOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setIsOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [isOpen]);

	return (
		<div ref={containerRef} className="relative" data-no-pan="true">
			<button
				type="button"
				onClick={() => setIsOpen((value) => !value)}
				className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium ${
					activeCount > 0
						? "bg-blue-50 text-blue-700"
						: "text-gray-600 hover:bg-gray-100"
				}`}
			>
				<ListFilter className="h-3.5 w-3.5" />
				Filter
				{activeCount > 0 && (
					<span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
						{activeCount}
					</span>
				)}
			</button>

			{isOpen && (
				<div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
					<div className="mb-3 flex items-center justify-between">
						<span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
							Filters
						</span>
						{activeCount > 0 && (
							<button
								type="button"
								onClick={() => onChange(EMPTY_TIMELINE_FILTERS)}
								className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700"
							>
								<X className="h-3 w-3" />
								Clear
							</button>
						)}
					</div>

					<div className="mb-3">
						<span className="mb-1.5 block text-[12px] font-medium text-gray-700">
							Status
						</span>
						<div className="flex flex-col gap-1">
							{(Object.keys(STATUS_LABELS) as FeatureStatus[]).map((status) => (
								<label
									key={status}
									className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700"
								>
									<input
										type="checkbox"
										checked={filters.statuses.has(status)}
										onChange={() =>
											onChange({
												...filters,
												statuses: toggle(filters.statuses, status),
											})
										}
										className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
									/>
									{STATUS_LABELS[status]}
								</label>
							))}
						</div>
					</div>

					<div className="mb-3">
						<span className="mb-1.5 block text-[12px] font-medium text-gray-700">
							Dates
						</span>
						<div className="inline-flex rounded-md border border-gray-200 p-0.5">
							{(Object.keys(SCHEDULE_LABELS) as ScheduleFilter[]).map(
								(value) => (
									<button
										key={value}
										type="button"
										onClick={() => onChange({ ...filters, schedule: value })}
										className={`rounded px-2 py-0.5 text-[12px] font-medium ${
											filters.schedule === value
												? "bg-gray-900 text-white"
												: "text-gray-500 hover:bg-gray-100"
										}`}
									>
										{SCHEDULE_LABELS[value]}
									</button>
								),
							)}
						</div>
					</div>

					{assignees.length > 0 && (
						<div>
							<span className="mb-1.5 block text-[12px] font-medium text-gray-700">
								Assignee
							</span>
							<div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
								{assignees.map((assignee) => (
									<label
										key={assignee.id}
										className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700"
									>
										<input
											type="checkbox"
											checked={filters.assigneeIds.has(assignee.id)}
											onChange={() =>
												onChange({
													...filters,
													assigneeIds: toggle(filters.assigneeIds, assignee.id),
												})
											}
											className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
										/>
										<span className="truncate">
											{assignee.display_name ??
												assignee.email ??
												"Unnamed member"}
										</span>
									</label>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
