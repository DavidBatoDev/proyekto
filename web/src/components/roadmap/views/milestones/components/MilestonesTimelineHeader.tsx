import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { DATE_HEADER_HEIGHT, SUB_ROW_H, SUPER_ROW_H } from "../model/constants";
import type {
	Granularity,
	MilestoneMarker,
	SuperGroup,
} from "../model/types";
import {
	dateFromTimelinePx,
	floorToUnit,
	fmtShort,
	subLabel,
	toISODateString,
	toTimelinePx,
} from "../model/utils";

export type MilestoneDateDraftCommit = {
	milestone: MilestoneMarker["milestone"];
	oldTargetDate: string;
	newTargetDate: string;
};

interface MilestonesTimelineHeaderProps {
	totalWidth: number;
	rightHeaderTopHeight: number;
	cw: number;
	columns: Date[];
	superGroups: SuperGroup[] | null;
	todayColIndex: number;
	granularity: Granularity;
	gridBg: CSSProperties;
	milestoneMarkers: MilestoneMarker[];
	rangeStart: Date;
	canEditDateRanges?: boolean;
	onMilestoneSelect: (marker: MilestoneMarker) => void;
	onMilestoneDateDraftCommit?: (change: MilestoneDateDraftCommit) => void;
	stickyTop?: number;
}

const MilestoneLines = ({
	milestoneMarkers,
	canEditDateRanges,
	onMarkerMouseDown,
}: {
	milestoneMarkers: MilestoneMarker[];
	canEditDateRanges: boolean;
	onMarkerMouseDown: (
		event: ReactMouseEvent<HTMLDivElement>,
		marker: MilestoneMarker,
	) => void;
}) => {
	return milestoneMarkers.map(({ milestone, left }) => (
		<div
			key={milestone.id}
			className={`absolute top-0 bottom-0 -translate-x-1/2 group/milestone ${
				canEditDateRanges ? "cursor-ew-resize pointer-events-auto" : "pointer-events-none"
			}`}
			style={{ left: Math.max(0, left) }}
			onMouseDown={(event) =>
				canEditDateRanges
					? onMarkerMouseDown(event, { milestone, left })
					: undefined
			}
			data-no-pan="true"
		>
			<div
				className="absolute top-0 bottom-0 w-0.5"
				style={{
					backgroundImage: `repeating-linear-gradient(to bottom, ${milestone.color ?? "#6366f1"} 0px, ${milestone.color ?? "#6366f1"} 7px, transparent 7px, transparent 12px)`,
					opacity: 0.95,
				}}
			/>
		</div>
	));
};

export const MilestonesTimelineHeader = ({
	totalWidth,
	rightHeaderTopHeight,
	cw,
	columns,
	superGroups,
	todayColIndex,
	granularity,
	gridBg,
	milestoneMarkers,
	rangeStart,
	canEditDateRanges = true,
	onMilestoneSelect,
	onMilestoneDateDraftCommit,
	stickyTop = 0,
}: MilestonesTimelineHeaderProps) => {
	const [dragState, setDragState] = useState<{
		marker: MilestoneMarker;
		anchorClientX: number;
		initialDate: Date;
		initialLeft: number;
		draftDate: Date;
		hasMoved: boolean;
	} | null>(null);
	const draggedMarkerIdRef = useRef<string | null>(null);

	const handleMarkerDragStart = useCallback(
		(
			event: ReactMouseEvent<HTMLButtonElement | HTMLDivElement>,
			marker: MilestoneMarker,
		) => {
			if (!canEditDateRanges) return;
			event.preventDefault();
			event.stopPropagation();
			const initialDate = floorToUnit(new Date(marker.milestone.target_date), "day");
			setDragState({
				marker,
				anchorClientX: event.clientX,
				initialDate,
				initialLeft: marker.left,
				draftDate: initialDate,
				hasMoved: false,
			});
		},
		[canEditDateRanges],
	);

	useEffect(() => {
		if (!dragState) return;

		const handleMouseMove = (event: MouseEvent) => {
			const dx = event.clientX - dragState.anchorClientX;
			const nextDate = dateFromTimelinePx(
				dragState.initialLeft + dx,
				rangeStart,
				granularity,
				cw,
			);
			setDragState((prev) =>
				prev
					? {
							...prev,
							draftDate: nextDate,
							hasMoved:
								prev.hasMoved ||
								Math.abs(event.clientX - prev.anchorClientX) >= 2,
						}
					: prev,
			);
		};

		const handleMouseUp = () => {
			const oldTargetDate = toISODateString(dragState.initialDate);
			const newTargetDate = toISODateString(dragState.draftDate);
			if (
				dragState.hasMoved &&
				oldTargetDate !== newTargetDate &&
				onMilestoneDateDraftCommit
			) {
				draggedMarkerIdRef.current = dragState.marker.milestone.id;
				onMilestoneDateDraftCommit({
					milestone: dragState.marker.milestone,
					oldTargetDate,
					newTargetDate,
				});
			}
			setDragState(null);
		};

		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [dragState, rangeStart, granularity, cw, onMilestoneDateDraftCommit]);

	const displayedMilestoneMarkers = milestoneMarkers.map((marker) => {
		const markerDragState =
			dragState?.marker.milestone.id === marker.milestone.id ? dragState : null;
		if (!markerDragState) return marker;
		return {
			...marker,
			left: toTimelinePx(markerDragState.draftDate, rangeStart, granularity, cw),
		};
	});

	let groupStartColumnIndex = 0;

	return (
		<>
			<div
				className="absolute left-0 right-0 bottom-0 z-20 pointer-events-none"
				style={{
					top: rightHeaderTopHeight + DATE_HEADER_HEIGHT - 1,
					width: totalWidth,
				}}
			>
				<MilestoneLines
					milestoneMarkers={displayedMilestoneMarkers}
					canEditDateRanges={canEditDateRanges}
					onMarkerMouseDown={handleMarkerDragStart}
				/>
			</div>

			<div className="sticky z-30 bg-white border-b border-gray-200" style={{ top: stickyTop }}>
				{rightHeaderTopHeight > 0 && (
					<div
						className="relative border-b border-gray-100 bg-white"
						style={{ height: rightHeaderTopHeight, width: totalWidth }}
					>
						{displayedMilestoneMarkers.map((marker) => {
							const clampedLeft = Math.max(
								0,
								Math.min(totalWidth, marker.left),
							);
							return (
								<div
									key={`banner-${marker.milestone.id}`}
									className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
									style={{ left: clampedLeft }}
								>
									<button
										type="button"
										onMouseDown={(event) =>
											handleMarkerDragStart(event, marker)
										}
										onClick={(event) => {
											if (draggedMarkerIdRef.current === marker.milestone.id) {
												event.preventDefault();
												event.stopPropagation();
												draggedMarkerIdRef.current = null;
												return;
											}
											onMilestoneSelect(marker);
										}}
										className={`flex flex-col items-center gap-1 pointer-events-auto ${
											canEditDateRanges ? "cursor-ew-resize" : "cursor-pointer"
										}`}
										data-no-pan="true"
									>
										<span
											className="text-[11px] font-semibold whitespace-nowrap px-2 py-0.5 rounded bg-white/80"
											style={{ color: marker.milestone.color ?? "#6366f1" }}
										>
											{marker.milestone.title}
										</span>
										<span
											className="h-3 w-3 rotate-45 rounded-[2px]"
											style={{
												backgroundColor: marker.milestone.color ?? "#6366f1",
											}}
										/>
									</button>
								</div>
							);
						})}
					</div>
				)}

				<div
					className="absolute left-0 right-0 z-0 pointer-events-none"
					style={{ top: rightHeaderTopHeight, height: DATE_HEADER_HEIGHT }}
				>
					<MilestoneLines
						milestoneMarkers={displayedMilestoneMarkers}
						canEditDateRanges={canEditDateRanges}
						onMarkerMouseDown={handleMarkerDragStart}
					/>
				</div>

				<div
					className="flex"
					style={{ height: SUPER_ROW_H, width: totalWidth }}
				>
					{superGroups
						? superGroups.map((group) => {
								const groupStartColumn =
									columns[groupStartColumnIndex]?.getTime() ??
									groupStartColumnIndex;
								groupStartColumnIndex += group.colCount;
								return (
									<div
										key={`${group.label}-${groupStartColumn}`}
										className="shrink-0 flex items-center justify-center border-r border-gray-200 overflow-hidden"
										style={{ width: group.colCount * cw }}
									>
										<span className="text-[11px] font-semibold text-blue-500 truncate">
											{group.label}
										</span>
									</div>
								);
							})
						: null}
				</div>

				<div
					className="flex border-t border-gray-100"
					style={{ height: SUB_ROW_H, width: totalWidth, ...gridBg }}
				>
					{columns.map((column, index) => (
						<div
							key={column.getTime()}
							className="shrink-0 flex items-center justify-center select-none"
							style={{
								width: cw,
								backgroundColor:
									index === todayColIndex ? "#fff7ed" : undefined,
							}}
							title={fmtShort(column.toISOString())}
						>
							<span
								className={`text-[11px] font-medium ${
									index === todayColIndex
										? "text-orange-500 font-semibold"
										: "text-gray-500"
								}`}
							>
								{subLabel(column, granularity)}
							</span>
						</div>
					))}
				</div>
			</div>
		</>
	);
};
