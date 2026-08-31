import type { CSSProperties } from "react";
import type { MilestoneMarker } from "../../milestones/model/types";
import type { TimelineColumn, TimelineGroup } from "../model/columns";
import {
	HEADER_H,
	SUB_ROW_H,
	SUPER_ROW_H,
	TASK_COL_WIDTH,
} from "../model/rows";

interface TimelineColumnsHeaderProps {
	columns: TimelineColumn[];
	groups: TimelineGroup[];
	cw: number;
	totalWidth: number;
	colStart: number;
	colEnd: number;
	todayColIndex: number;
	milestoneMarkers: MilestoneMarker[];
	canEditDates: boolean;
	gridBackground: CSSProperties;
	/** Frozen task-column width. Narrowed on mobile; defaults to the desktop 320. */
	taskColWidth?: number;
	onMilestoneSelect: (marker: MilestoneMarker) => void;
	onMilestonePointerDown: (
		event: React.PointerEvent,
		marker: MilestoneMarker,
	) => void;
}

/**
 * Sticky date header: a group band (month, or year at the month scale) above
 * the individual columns. Only columns inside the horizontal window are
 * mounted, each absolutely positioned so the window can move without
 * disturbing layout.
 */
export const TimelineColumnsHeader = ({
	columns,
	groups,
	cw,
	totalWidth,
	colStart,
	colEnd,
	todayColIndex,
	milestoneMarkers,
	canEditDates,
	gridBackground,
	taskColWidth = TASK_COL_WIDTH,
	onMilestoneSelect,
	onMilestonePointerDown,
}: TimelineColumnsHeaderProps) => {
	const windowStart = Math.max(0, colStart);
	const windowEnd = Math.min(columns.length, colEnd);

	return (
		<div
			className="sticky top-0 z-30 flex bg-white border-b border-gray-200"
			style={{ height: HEADER_H, width: taskColWidth + totalWidth }}
		>
			{/* Task-column corner, pinned against horizontal scroll. */}
			<div
				className="sticky left-0 z-20 shrink-0 h-full bg-white border-r border-gray-200 flex items-end"
				style={{ width: taskColWidth }}
			>
				<span className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
					Task
				</span>
			</div>

			<div
				className="relative shrink-0"
				style={{ width: totalWidth, height: HEADER_H }}
			>
				<div
					className="absolute left-0 top-0 border-b border-gray-100"
					style={{ height: SUPER_ROW_H, width: totalWidth }}
				>
					{groups.map((group) => {
						// Culled in px, not in columns: a band boundary can fall inside a
						// column at the week scale, so it has no column index to compare.
						if (
							group.left + group.width < windowStart * cw ||
							group.left > windowEnd * cw
						) {
							return null;
						}
						return (
							<div
								key={group.key}
								className="absolute top-0 h-full overflow-hidden border-r border-gray-200"
								style={{ left: group.left, width: group.width }}
							>
								{/* Sticky inside its own band: a group wider than the
								    viewport keeps its label on screen instead of centring
								    it somewhere off to the side. */}
								<span className="sticky left-0 inline-block px-3 py-1.5 text-[11px] font-semibold text-gray-600 whitespace-nowrap">
									{group.label}
								</span>
							</div>
						);
					})}
				</div>

				<div
					className="absolute left-0"
					style={{
						top: SUPER_ROW_H,
						height: SUB_ROW_H,
						width: totalWidth,
						...gridBackground,
					}}
				>
					{columns.slice(windowStart, windowEnd).map((column, index) => {
						const columnIndex = windowStart + index;
						const isToday = columnIndex === todayColIndex;
						return (
							<div
								key={column.start.getTime()}
								className="absolute top-0 h-full flex flex-col items-center justify-center gap-0.5"
								style={{
									left: columnIndex * cw,
									width: cw,
									backgroundColor: isToday
										? "#fff7ed"
										: column.isWeekend
											? "#f8fafc"
											: undefined,
								}}
							>
								{column.subLabel && (
									<span
										className={`text-[9px] uppercase leading-none ${
											isToday ? "text-orange-400" : "text-gray-400"
										}`}
									>
										{column.subLabel}
									</span>
								)}
								<span
									className={`text-[11px] leading-none ${
										isToday
											? "font-semibold text-orange-500"
											: "font-medium text-gray-600"
									}`}
								>
									{column.label}
								</span>
							</div>
						);
					})}
				</div>

				{milestoneMarkers.map((marker) => (
					<button
						key={marker.milestone.id}
						type="button"
						data-no-pan="true"
						onClick={() => onMilestoneSelect(marker)}
						onPointerDown={(event) => onMilestonePointerDown(event, marker)}
						className={`absolute top-0 z-20 -translate-x-1/2 flex flex-col items-center ${
							canEditDates ? "cursor-ew-resize" : "cursor-pointer"
						}`}
						style={{ left: Math.max(0, Math.min(totalWidth, marker.left)) }}
						title={marker.milestone.title}
					>
						<span
							className="h-2.5 w-2.5 rotate-45 rounded-[2px] mt-1"
							style={{
								backgroundColor: marker.milestone.color ?? "#6366f1",
							}}
						/>
					</button>
				))}
			</div>
		</div>
	);
};
