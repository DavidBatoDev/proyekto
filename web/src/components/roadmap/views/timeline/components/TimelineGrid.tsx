import type { CSSProperties } from "react";
import {
	FEATURE_LABEL_CHAR_PX,
	FEATURE_LABEL_HORIZONTAL_PADDING,
	FEATURE_LABEL_MIN_INSIDE_WIDTH,
	FEATURE_LABEL_OUTSIDE_GAP,
} from "../../milestones/model/constants";
import type { MilestoneMarker } from "../../milestones/model/types";
import type { DependencyHandleSide } from "../hooks/useDependencyDrag";
import type { BarGestureMode } from "../hooks/useTimelineBarDrag";
import { type BarGeometry, barWidth } from "../model/barGeometry";
import type { DependencyEdgeGeometry } from "../model/dependencyGeometry";
import { BAR_H, ROW_H, type TimelineRow } from "../model/rows";
import { TimelineDependencyLayer } from "./TimelineDependencyLayer";

interface TimelineGridProps {
	rows: TimelineRow[];
	rowStart: number;
	rowEnd: number;
	totalWidth: number;
	totalHeight: number;
	gridBackground: CSSProperties;
	todayColLeft: number;
	todayInRange: boolean;
	cw: number;
	milestoneMarkers: MilestoneMarker[];
	canEditDates: boolean;
	isDrawMode: boolean;
	onBarGesture: (
		event: React.PointerEvent,
		row: TimelineRow,
		mode: BarGestureMode,
	) => void;
	onOpenRow: (row: TimelineRow) => void;
	onBarContextMenu: (event: React.MouseEvent, row: TimelineRow) => void;
	/**
	 * Single-click/tap on a bar. Touch has no double-click — double-tap is the
	 * browser's own zoom — so mobile opens its detail sheet from here instead of
	 * from `onOpenRow`'s double-click. Desktop leaves this unset and keeps
	 * double-click, so a single click there still just selects.
	 */
	onBarClick?: (row: TimelineRow) => void;
	/**
	 * Draw each row's title on its bar. Used when the task column is collapsed,
	 * which is the only thing naming the rows — without it the chart is a field
	 * of anonymous bars.
	 */
	showBarLabels?: boolean;
	/**
	 * Suppress the right-click menu. Chrome on Android fires `contextmenu` on a
	 * long press, which would open the desktop menu underneath the mobile sheet.
	 */
	disableContextMenu?: boolean;
	/** Bar extents, resolved once by the view so arrows cannot drift from bars. */
	geometryByRowKey: Map<string, BarGeometry>;
	dependencyEdges: DependencyEdgeGeometry[];
	selectedDependencyId: string | null;
	dependencyDraftPath: string | null;
	dependencyDraftIsValid: boolean;
	dependencyDraftTargetRowTop: number | null;
	onSelectDependency: (dependencyId: string | null) => void;
	onRemoveDependency: (dependencyId: string) => void;
	onDependencyHandlePointerDown: (
		event: React.PointerEvent,
		row: TimelineRow,
		side: DependencyHandleSide,
	) => void;
}

const barColor = (row: TimelineRow): string => {
	if (row.kind === "epic") return row.epic.color ?? "#6366f1";
	switch (row.feature.status) {
		case "completed":
			return "#22a06b";
		case "blocked":
			return "#6b778c";
		default:
			return "#2563eb";
	}
};

/**
 * The bar surface. Rows are absolutely positioned at `index * ROW_H`, so only
 * the windowed slice is mounted and the scroll height still reflects the whole
 * roadmap.
 */
export const TimelineGrid = ({
	rows,
	rowStart,
	rowEnd,
	totalWidth,
	totalHeight,
	gridBackground,
	todayColLeft,
	todayInRange,
	cw,
	milestoneMarkers,
	canEditDates,
	isDrawMode,
	onBarGesture,
	onOpenRow,
	onBarContextMenu,
	onBarClick,
	disableContextMenu = false,
	showBarLabels = false,
	geometryByRowKey,
	dependencyEdges,
	selectedDependencyId,
	dependencyDraftPath,
	dependencyDraftIsValid,
	dependencyDraftTargetRowTop,
	onSelectDependency,
	onRemoveDependency,
	onDependencyHandlePointerDown,
}: TimelineGridProps) => {
	return (
		<div
			className={`relative shrink-0 ${
				isDrawMode && canEditDates ? "cursor-pencil" : ""
			}`}
			style={{ width: totalWidth, height: totalHeight, ...gridBackground }}
			// Clicking the grid itself dismisses a selected link, so its
			// "Remove link" chip cannot linger over unrelated content.
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) onSelectDependency(null);
			}}
		>
			<TimelineDependencyLayer
				edges={dependencyEdges}
				totalWidth={totalWidth}
				totalHeight={totalHeight}
				selectedDependencyId={selectedDependencyId}
				draftPath={dependencyDraftPath}
				draftIsValid={dependencyDraftIsValid}
				draftTargetRowTop={dependencyDraftTargetRowTop}
				canEdit={canEditDates}
				onSelectDependency={onSelectDependency}
				onRemoveDependency={onRemoveDependency}
			/>

			{todayInRange && (
				<div
					className="absolute top-0 bottom-0 z-0 pointer-events-none"
					style={{
						// Column-aligned, not the fractional position of "now" —
						// otherwise the band straddles two columns.
						left: todayColLeft,
						width: cw,
						backgroundColor: "#f97316",
						opacity: 0.07,
					}}
				/>
			)}

			{milestoneMarkers.map((marker) => (
				<div
					key={marker.milestone.id}
					className="absolute top-0 bottom-0 z-0 w-px pointer-events-none"
					style={{
						left: marker.left,
						backgroundColor: marker.milestone.color ?? "#6366f1",
						opacity: 0.25,
					}}
				/>
			))}

			{rows.slice(rowStart, rowEnd).map((row, index) => {
				const rowIndex = rowStart + index;
				// Resolved by the view via resolveBarGeometry so the dependency
				// arrows anchor to exactly these coordinates.
				const geometry = geometryByRowKey.get(row.rowKey) ?? null;
				const left = geometry ? geometry.left : null;
				const width = geometry ? barWidth(geometry) : 0;

				const color = barColor(row);
				const isEpic = row.kind === "epic";

				return (
					<div
						key={row.rowKey}
						className="absolute left-0 border-b border-gray-100"
						style={{ top: rowIndex * ROW_H, height: ROW_H, width: totalWidth }}
					>
						{left === null
							? isDrawMode &&
								canEditDates && (
									<div
										className="absolute inset-0 cursor-pencil"
										data-no-pan="true"
										onPointerDown={(event) => onBarGesture(event, row, "draw")}
									/>
								)
							: null}

						{left !== null && (
							<div
								className={`group absolute z-10 flex items-center ${
									isEpic ? "rounded-[3px]" : "rounded-sm"
								} ${
									isDrawMode && canEditDates
										? "cursor-pencil"
										: canEditDates
											? "cursor-grab"
											: "cursor-pointer"
								}`}
								data-no-pan="true"
								style={{
									left,
									width,
									top: (ROW_H - (isEpic ? BAR_H - 8 : BAR_H)) / 2,
									height: isEpic ? BAR_H - 8 : BAR_H,
									backgroundColor: color,
									opacity: isEpic ? 0.85 : 1,
								}}
								onPointerDown={(event) => onBarGesture(event, row, "move")}
								onClick={onBarClick ? () => onBarClick(row) : undefined}
								onDoubleClick={() => onOpenRow(row)}
								onContextMenu={
									disableContextMenu
										? (event) => event.preventDefault()
										: (event) => onBarContextMenu(event, row)
								}
								title={row.kind === "epic" ? row.epic.title : row.feature.title}
							>
								{/* The only label while `showBarLabels` is on; the desktop's
								    inside-only label below is suppressed in that case, or the
								    two double up on any bar wide enough for both. */}
								{showBarLabels &&
									(() => {
										const label =
											row.kind === "epic" ? row.epic.title : row.feature.title;
										// Fit the WHOLE title or put it outside — never truncate.
										// A clipped "Featur…" names nothing, and the bar already
										// carries its own tooltip.
										const estimatedLabelWidth =
											label.length * FEATURE_LABEL_CHAR_PX +
											FEATURE_LABEL_HORIZONTAL_PADDING;
										const fitsInside =
											width >=
											Math.max(
												FEATURE_LABEL_MIN_INSIDE_WIDTH,
												estimatedLabelWidth,
											);

										return fitsInside ? (
											<span className="pointer-events-none w-full truncate px-1.5 text-[11px] font-medium leading-none text-white">
												{label}
											</span>
										) : (
											// Parked just past the right edge. The bar is
											// overflow-visible so this is not clipped, and
											// pointer-events-none keeps the tap on the bar.
											<span
												className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-medium leading-none text-gray-700"
												style={{ marginLeft: FEATURE_LABEL_OUTSIDE_GAP }}
											>
												{label}
											</span>
										);
									})()}

								{canEditDates && (
									<>
										<button
											type="button"
											data-no-pan="true"
											aria-label="Change start date"
											className="absolute left-0 top-0 bottom-0 z-20 w-2 cursor-ew-resize rounded-l-sm bg-black/0 group-hover:bg-black/20"
											onPointerDown={(event) =>
												onBarGesture(event, row, "resize-start")
											}
										/>
										<button
											type="button"
											data-no-pan="true"
											aria-label="Change end date"
											className="absolute right-0 top-0 bottom-0 z-20 w-2 cursor-ew-resize rounded-r-sm bg-black/0 group-hover:bg-black/20"
											onPointerDown={(event) =>
												onBarGesture(event, row, "resize-end")
											}
										/>
									</>
								)}

								{/* Dependency handles sit OUTSIDE the bar: the inner 8px
								    at each edge already belongs to the resize buttons.
								    data-no-pan keeps the pan gesture off them, and the
								    pointerdown stops propagation so the bar's own move
								    gesture never starts. */}
								{canEditDates && !isDrawMode && !isEpic && (
									<>
										<button
											type="button"
											data-no-pan="true"
											aria-label="Drag to link a predecessor"
											title="Drag to link a predecessor"
											className="absolute top-1/2 z-20 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-white bg-slate-400 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-blue-600"
											style={{ left: -10 }}
											onPointerDown={(event) =>
												onDependencyHandlePointerDown(event, row, "start")
											}
										/>
										<button
											type="button"
											data-no-pan="true"
											aria-label="Drag to link a successor"
											title="Drag to link a successor"
											className="absolute top-1/2 z-20 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-white bg-slate-400 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-blue-600"
											style={{ right: -10 }}
											onPointerDown={(event) =>
												onDependencyHandlePointerDown(event, row, "end")
											}
										/>
									</>
								)}

								{!showBarLabels && !isEpic && width > 60 && (
									<span className="pointer-events-none truncate px-2 text-[11px] font-medium text-white">
										{row.feature.title}
									</span>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
};
