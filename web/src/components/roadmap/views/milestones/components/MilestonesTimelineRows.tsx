import {
	useCallback,
	useEffect,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
} from "react";
import type { RoadmapEpic, RoadmapFeature } from "@/types/roadmap";
import { calculateFeatureProgressFromTasks } from "../../../shared/featureProgress";
import {
	EPIC_LINE_HEIGHT,
	EPIC_LINE_OPACITY,
	FEATURE_BAR_BORDER_COLOR,
	FEATURE_BAR_FILL_COLOR,
	FEATURE_BAR_HEIGHT,
	FEATURE_BAR_ROUNDED_CLASS,
	FEATURE_BAR_TRACK_COLOR,
	FEATURE_LABEL_CHAR_PX,
	FEATURE_LABEL_HORIZONTAL_PADDING,
	FEATURE_LABEL_MIN_INSIDE_WIDTH,
	FEATURE_LABEL_OUTSIDE_GAP,
	FIRST_EPIC_EXTRA_HEIGHT,
	ROW_HEIGHT,
} from "../model/constants";
import type { Granularity } from "../model/types";
import {
	addDays,
	clampDate,
	computeEpicRange,
	dateFromTimelinePx,
	daysBetween,
	fmtEpicDateRange,
	fmtShort,
	floorToUnit,
	getInclusiveDays,
	toISODateString,
	toTimelinePx,
} from "../model/utils";

type FeatureDragMode = "start" | "end" | "move";

export type FeatureDateDraftCommit = {
	feature: RoadmapFeature;
	oldStartDate: string;
	oldEndDate: string;
	newStartDate: string;
	newEndDate: string;
};

export type FeatureDateVisualDraft = {
	startDate: string;
	endDate: string;
};

export type EpicDateDraftCommit = {
	epic: RoadmapEpic;
	oldStartDate: string;
	oldEndDate: string;
	newStartDate: string;
	newEndDate: string;
};

type DrawDragState = {
	kind: "epic" | "feature";
	entity: RoadmapEpic | RoadmapFeature;
	anchorDate: Date;
	draftStartDate: Date;
	draftEndDate: Date;
	hasMoved: boolean;
};

interface MilestonesTimelineRowsProps {
	sortedEpics: RoadmapEpic[];
	collapsed: Set<string>;
	totalWidth: number;
	gridBg: CSSProperties;
	todayColInRange: boolean;
	todayColLeft: number;
	cw: number;
	rangeStart: Date;
	granularity: Granularity;
	canEditDateRanges?: boolean;
	featureDateVisualDrafts?: Record<string, FeatureDateVisualDraft>;
	onFeatureSelect?: (feature: RoadmapFeature) => void;
	onFeatureDateDraftCommit?: (change: FeatureDateDraftCommit) => void;
	isDateDrawMode?: boolean;
	clientXToDate?: (clientX: number) => Date;
	onEpicDateCreate?: (epic: RoadmapEpic, startDate: string, endDate: string) => void;
	onFeatureDateCreate?: (feature: RoadmapFeature, startDate: string, endDate: string) => void;
	epicDateVisualDrafts?: Record<string, { startDate: string; endDate: string }>;
	onEpicDateDraftCommit?: (change: EpicDateDraftCommit) => void;
}

export const MilestonesTimelineRows = ({
	sortedEpics,
	collapsed,
	totalWidth,
	gridBg,
	todayColInRange,
	todayColLeft,
	cw,
	rangeStart,
	granularity,
	canEditDateRanges = true,
	featureDateVisualDrafts = {},
	onFeatureSelect,
	onFeatureDateDraftCommit,
	isDateDrawMode = false,
	clientXToDate,
	onEpicDateCreate,
	onFeatureDateCreate,
	epicDateVisualDrafts = {},
	onEpicDateDraftCommit,
}: MilestonesTimelineRowsProps) => {
	const [dragState, setDragState] = useState<{
		feature: RoadmapFeature;
		mode: FeatureDragMode;
		anchorClientX: number;
		initialStartDate: Date;
		initialEndDate: Date;
		draftStartDate: Date;
		draftEndDate: Date;
		hasMoved: boolean;
	} | null>(null);

	const [epicDragState, setEpicDragState] = useState<{
		epic: RoadmapEpic;
		mode: FeatureDragMode;
		anchorClientX: number;
		initialStartDate: Date;
		initialEndDate: Date;
		draftStartDate: Date;
		draftEndDate: Date;
		hasMoved: boolean;
	} | null>(null);

	const [drawDragState, setDrawDragState] = useState<DrawDragState | null>(null);

	const handleDragStart = useCallback(
		(
			event: ReactMouseEvent<HTMLDivElement>,
			feature: RoadmapFeature,
			mode: FeatureDragMode,
			effectiveStartDate?: Date | null,
			effectiveEndDate?: Date | null,
		) => {
			if (!canEditDateRanges) return;
			const startDate = effectiveStartDate
				? floorToUnit(effectiveStartDate, "day")
				: feature.start_date
					? floorToUnit(new Date(feature.start_date), "day")
					: null;
			const endDate = effectiveEndDate
				? floorToUnit(effectiveEndDate, "day")
				: feature.end_date
					? floorToUnit(new Date(feature.end_date), "day")
					: null;
			if (!startDate || !endDate) return;
			event.preventDefault();
			event.stopPropagation();

			setDragState({
				feature,
				mode,
				anchorClientX: event.clientX,
				initialStartDate: startDate,
				initialEndDate: endDate,
				draftStartDate: startDate,
				draftEndDate: endDate,
				hasMoved: false,
			});
		},
		[canEditDateRanges],
	);

	const handleEpicDragStart = useCallback(
		(
			event: ReactMouseEvent<HTMLDivElement>,
			epic: RoadmapEpic,
			mode: FeatureDragMode,
			effectiveStartDate?: Date | null,
			effectiveEndDate?: Date | null,
		) => {
			if (!canEditDateRanges) return;
			const startDate = effectiveStartDate
				? floorToUnit(effectiveStartDate, "day")
				: epic.start_date
					? floorToUnit(new Date(epic.start_date), "day")
					: null;
			const endDate = effectiveEndDate
				? floorToUnit(effectiveEndDate, "day")
				: epic.end_date
					? floorToUnit(new Date(epic.end_date), "day")
					: null;
			if (!startDate || !endDate) return;
			event.preventDefault();
			event.stopPropagation();
			setEpicDragState({
				epic,
				mode,
				anchorClientX: event.clientX,
				initialStartDate: startDate,
				initialEndDate: endDate,
				draftStartDate: startDate,
				draftEndDate: endDate,
				hasMoved: false,
			});
		},
		[canEditDateRanges],
	);

	const handleDrawStart = useCallback(
		(
			event: ReactMouseEvent<HTMLDivElement>,
			kind: "epic" | "feature",
			entity: RoadmapEpic | RoadmapFeature,
		) => {
			if (!isDateDrawMode || !clientXToDate) return;
			event.preventDefault();
			event.stopPropagation();
			const anchorDate = floorToUnit(clientXToDate(event.clientX), "day");
			setDrawDragState({
				kind,
				entity,
				anchorDate,
				draftStartDate: anchorDate,
				draftEndDate: anchorDate,
				hasMoved: false,
			});
		},
		[isDateDrawMode, clientXToDate],
	);

	useEffect(() => {
		if (!dragState) return;

		const handleMouseMove = (event: MouseEvent) => {
			const dx = event.clientX - dragState.anchorClientX;
			const hasMoved = Math.abs(dx) >= 2;
			const initialStartPx = toTimelinePx(
				dragState.initialStartDate,
				rangeStart,
				granularity,
				cw,
			);
			const initialEndPx = toTimelinePx(
				dragState.initialEndDate,
				rangeStart,
				granularity,
				cw,
			);

			if (dragState.mode === "move") {
				const shiftedStartDate = dateFromTimelinePx(
					initialStartPx + dx,
					rangeStart,
					granularity,
					cw,
				);
				const deltaDays = Math.round(
					daysBetween(dragState.initialStartDate, shiftedStartDate),
				);
				setDragState((prev) =>
					prev
						? {
								...prev,
								draftStartDate: addDays(prev.initialStartDate, deltaDays),
								draftEndDate: addDays(prev.initialEndDate, deltaDays),
								hasMoved: prev.hasMoved || hasMoved,
							}
						: prev,
				);
				return;
			}

			if (dragState.mode === "start") {
				const rawStartDate = dateFromTimelinePx(
					initialStartPx + dx,
					rangeStart,
					granularity,
					cw,
				);
				const nextStartDate = clampDate(
					rawStartDate,
					undefined,
					dragState.initialEndDate,
				);
				setDragState((prev) =>
					prev
						? {
								...prev,
								draftStartDate: nextStartDate,
								draftEndDate: prev.initialEndDate,
								hasMoved: prev.hasMoved || hasMoved,
							}
						: prev,
				);
				return;
			}

			const rawEndDate = dateFromTimelinePx(
				initialEndPx + dx,
				rangeStart,
				granularity,
				cw,
			);
			const nextEndDate = clampDate(
				rawEndDate,
				dragState.initialStartDate,
				undefined,
			);
			setDragState((prev) =>
				prev
					? {
							...prev,
							draftStartDate: prev.initialStartDate,
							draftEndDate: nextEndDate,
							hasMoved: prev.hasMoved || hasMoved,
						}
					: prev,
			);
		};

		const handleMouseUp = () => {
			if (!dragState.hasMoved && dragState.mode === "move" && onFeatureSelect) {
				onFeatureSelect(dragState.feature);
				setDragState(null);
				return;
			}

			const oldStartDate = toISODateString(dragState.initialStartDate);
			const oldEndDate = toISODateString(dragState.initialEndDate);
			const newStartDate = toISODateString(dragState.draftStartDate);
			const newEndDate = toISODateString(dragState.draftEndDate);

			if (
				(oldStartDate !== newStartDate || oldEndDate !== newEndDate) &&
				onFeatureDateDraftCommit
			) {
				onFeatureDateDraftCommit({
					feature: dragState.feature,
					oldStartDate,
					oldEndDate,
					newStartDate,
					newEndDate,
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
	}, [dragState, rangeStart, granularity, cw, onFeatureDateDraftCommit, onFeatureSelect]);

	useEffect(() => {
		if (!epicDragState) return;

		const handleMouseMove = (event: MouseEvent) => {
			const dx = event.clientX - epicDragState.anchorClientX;
			const hasMoved = Math.abs(dx) >= 2;
			const initialStartPx = toTimelinePx(epicDragState.initialStartDate, rangeStart, granularity, cw);
			const initialEndPx = toTimelinePx(epicDragState.initialEndDate, rangeStart, granularity, cw);

			if (epicDragState.mode === "move") {
				const shiftedStart = dateFromTimelinePx(initialStartPx + dx, rangeStart, granularity, cw);
				const deltaDays = Math.round(daysBetween(epicDragState.initialStartDate, shiftedStart));
				setEpicDragState((prev) =>
					prev
						? {
								...prev,
								draftStartDate: addDays(prev.initialStartDate, deltaDays),
								draftEndDate: addDays(prev.initialEndDate, deltaDays),
								hasMoved: prev.hasMoved || hasMoved,
							}
						: prev,
				);
				return;
			}

			if (epicDragState.mode === "start") {
				const rawStart = dateFromTimelinePx(initialStartPx + dx, rangeStart, granularity, cw);
				const nextStart = clampDate(rawStart, undefined, epicDragState.initialEndDate);
				setEpicDragState((prev) =>
					prev ? { ...prev, draftStartDate: nextStart, draftEndDate: prev.initialEndDate, hasMoved: prev.hasMoved || hasMoved } : prev,
				);
				return;
			}

			const rawEnd = dateFromTimelinePx(initialEndPx + dx, rangeStart, granularity, cw);
			const nextEnd = clampDate(rawEnd, epicDragState.initialStartDate, undefined);
			setEpicDragState((prev) =>
				prev ? { ...prev, draftStartDate: prev.initialStartDate, draftEndDate: nextEnd, hasMoved: prev.hasMoved || hasMoved } : prev,
			);
		};

		const handleMouseUp = () => {
			const oldStartDate = toISODateString(epicDragState.initialStartDate);
			const oldEndDate = toISODateString(epicDragState.initialEndDate);
			const newStartDate = toISODateString(epicDragState.draftStartDate);
			const newEndDate = toISODateString(epicDragState.draftEndDate);
			if (
				epicDragState.hasMoved &&
				(oldStartDate !== newStartDate || oldEndDate !== newEndDate) &&
				onEpicDateDraftCommit
			) {
				onEpicDateDraftCommit({ epic: epicDragState.epic, oldStartDate, oldEndDate, newStartDate, newEndDate });
			}
			setEpicDragState(null);
		};

		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [epicDragState, rangeStart, granularity, cw, onEpicDateDraftCommit]);

	useEffect(() => {
		if (!drawDragState || !clientXToDate) return;

		document.body.style.userSelect = "none";
		document.body.style.cursor = "text";

		const handleMouseMove = (event: MouseEvent) => {
			const currentDate = floorToUnit(clientXToDate(event.clientX), "day");
			const { anchorDate } = drawDragState;
			const newStart = currentDate < anchorDate ? currentDate : anchorDate;
			const newEnd = currentDate < anchorDate ? anchorDate : currentDate;
			setDrawDragState((prev) =>
				prev
					? {
							...prev,
							draftStartDate: newStart,
							draftEndDate: newEnd,
							hasMoved: true,
						}
					: prev,
			);
		};

		const handleMouseUp = () => {
			if (drawDragState.hasMoved) {
				const startDate = toISODateString(drawDragState.draftStartDate);
				const endDate = toISODateString(drawDragState.draftEndDate);
				if (startDate !== endDate) {
					if (drawDragState.kind === "epic" && onEpicDateCreate) {
						onEpicDateCreate(drawDragState.entity as RoadmapEpic, startDate, endDate);
					} else if (drawDragState.kind === "feature" && onFeatureDateCreate) {
						onFeatureDateCreate(drawDragState.entity as RoadmapFeature, startDate, endDate);
					}
				}
			}
			setDrawDragState(null);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [drawDragState, clientXToDate, onEpicDateCreate, onFeatureDateCreate]);

	return (
		<>
			{sortedEpics.map((epic, epicIndex) => {
				const isCollapsed = collapsed.has(epic.id);
				const epicColor = epic.color ?? "#6366f1";
				const epicRange = computeEpicRange(epic);
				const features = epic.features ?? [];
				const epicRowHeight =
					ROW_HEIGHT + (epicIndex === 0 ? FIRST_EPIC_EXTRA_HEIGHT : 0);

				const epicDragForThis = epicDragState?.epic.id === epic.id ? epicDragState : null;
				const epicVisualDraft = epicDateVisualDrafts[epic.id];
				const epicHasStoredDates = !!(epic.start_date && epic.end_date);
				const epicEffectiveStart = epicDragForThis
					? epicDragForThis.draftStartDate
					: epicVisualDraft
						? floorToUnit(new Date(epicVisualDraft.startDate), "day")
						: epicHasStoredDates
							? floorToUnit(new Date(epic.start_date ?? ""), "day")
							: null;
				const epicEffectiveEnd = epicDragForThis
					? epicDragForThis.draftEndDate
					: epicVisualDraft
						? floorToUnit(new Date(epicVisualDraft.endDate), "day")
						: epicHasStoredDates
							? floorToUnit(new Date(epic.end_date ?? ""), "day")
							: null;
				const isDraggingThisEpic = epicDragForThis !== null;

				const isDrawingThisEpic =
					drawDragState?.kind === "epic" &&
					(drawDragState.entity as RoadmapEpic).id === epic.id;
				const epicDrawPreviewLeft = isDrawingThisEpic
					? toTimelinePx(drawDragState.draftStartDate, rangeStart, granularity, cw)
					: 0;
				const epicDrawPreviewRight = isDrawingThisEpic
					? toTimelinePx(drawDragState.draftEndDate, rangeStart, granularity, cw)
					: 0;
				const epicDrawPreviewWidth = Math.max(2, epicDrawPreviewRight - epicDrawPreviewLeft);

				return (
					<div key={`right-${epic.id}`}>
						<div
							className="relative border-b border-gray-200"
							style={{
								height: epicRowHeight,
								width: totalWidth,
								...gridBg,
							}}
						>
							{todayColInRange && (
								<div
									className="absolute top-0 bottom-0 pointer-events-none"
									style={{
										left: todayColLeft,
										width: cw,
										backgroundColor: "#f97316",
										opacity: 0.07,
									}}
								/>
							)}

							{isDateDrawMode && (
								<div
									className="absolute inset-0 z-10 cursor-text"
									data-no-pan="true"
									onMouseDown={(e) => handleDrawStart(e, "epic", epic)}
								/>
							)}

							{isDrawingThisEpic && drawDragState.hasMoved && (
								<div
									className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20 rounded-sm"
									style={{
										left: Math.max(0, epicDrawPreviewLeft),
										width: epicDrawPreviewWidth,
										height: EPIC_LINE_HEIGHT + 2,
										backgroundColor: "#2563eb",
										opacity: 0.35,
										border: "1.5px dashed #2563eb",
									}}
								/>
							)}

							{epicRange &&
								(() => {
									const left = toTimelinePx(
										epicRange.start,
										rangeStart,
										granularity,
										cw,
									);
									const right = toTimelinePx(
										epicRange.end,
										rangeStart,
										granularity,
										cw,
									);
									const lineLeft = Math.max(0, left);
									const lineWidth = Math.max(6, right - left);
									const durationDays = getInclusiveDays(
										epicRange.start,
										epicRange.end,
									);
									const epicLabel = `${epic.title} | ${fmtEpicDateRange(epicRange.start, epicRange.end)} | (${durationDays} day${durationDays > 1 ? "s" : ""})`;
									return (
										<div
											className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
											style={{ left: lineLeft }}
										>
											<div className="text-[11px] text-gray-700 font-medium whitespace-nowrap truncate max-w-[420px]">
												{epicLabel}
											</div>
											<div
												className="mt-1 rounded-sm"
												style={{
													width: lineWidth,
													height: EPIC_LINE_HEIGHT,
													backgroundColor: epicColor,
													opacity: EPIC_LINE_OPACITY,
												}}
											/>
										</div>
									);
								})()}

						{epicEffectiveStart && epicEffectiveEnd && (() => {
							const barLeft = toTimelinePx(epicEffectiveStart, rangeStart, granularity, cw);
							const barRight = toTimelinePx(epicEffectiveEnd, rangeStart, granularity, cw);
							const barWidth = Math.max(6, barRight - barLeft);
							return (
								<div
									className={`absolute top-1/2 rounded-sm group z-10 ${
										canEditDateRanges
											? isDraggingThisEpic
												? "cursor-grabbing"
												: "cursor-pointer"
											: "cursor-default"
									}`}
									data-no-pan="true"
									onMouseDown={(e) => handleEpicDragStart(e, epic, "move", epicEffectiveStart, epicEffectiveEnd)}
									style={{
										left: Math.max(0, barLeft),
										width: barWidth,
										height: 12,
										marginTop: 0,
										backgroundColor: epicColor,
										opacity: 0.85,
									}}
								>
									{canEditDateRanges && (
										<>
											<div
												className="absolute left-0 top-0 bottom-0 z-20 w-2 cursor-ew-resize bg-black/0 hover:bg-black/20 rounded-l-sm"
												data-no-pan="true"
												onMouseDown={(e) => handleEpicDragStart(e, epic, "start", epicEffectiveStart, epicEffectiveEnd)}
											/>
											<div
												className="absolute right-0 top-0 bottom-0 z-20 w-2 cursor-ew-resize bg-black/0 hover:bg-black/20 rounded-r-sm"
												data-no-pan="true"
												onMouseDown={(e) => handleEpicDragStart(e, epic, "end", epicEffectiveStart, epicEffectiveEnd)}
											/>
										</>
									)}
								</div>
							);
						})()}
						</div>

						{!isCollapsed &&
							features.map((feature) => {
								const hasDates = !!(feature.start_date && feature.end_date);
								const visualDraft = featureDateVisualDrafts[feature.id];
								const featureDragState =
									dragState?.feature.id === feature.id ? dragState : null;
								const isDraggingThisFeature = featureDragState !== null;
								const effectiveStartDate = featureDragState
									? featureDragState.draftStartDate
									: visualDraft
										? floorToUnit(new Date(visualDraft.startDate), "day")
									: hasDates
										? floorToUnit(new Date(feature.start_date ?? ""), "day")
										: null;
								const effectiveEndDate = featureDragState
									? featureDragState.draftEndDate
									: visualDraft
										? floorToUnit(new Date(visualDraft.endDate), "day")
									: hasDates
										? floorToUnit(new Date(feature.end_date ?? ""), "day")
										: null;
								const taskProgress = calculateFeatureProgressFromTasks(
									feature.tasks,
								);
								const clampedProgress = Math.max(0, Math.min(100, taskProgress));
								const barLeft = effectiveStartDate
									? toTimelinePx(effectiveStartDate, rangeStart, granularity, cw)
									: 0;
								const barRight = effectiveEndDate
									? toTimelinePx(effectiveEndDate, rangeStart, granularity, cw)
									: 0;
								const barWidth = Math.max(6, barRight - barLeft);
								const rawFillWidth = (barWidth * clampedProgress) / 100;
								const fillWidth = clampedProgress > 0 ? Math.max(3, rawFillWidth) : 0;
								const estimatedLabelWidth =
									feature.title.length * FEATURE_LABEL_CHAR_PX +
									FEATURE_LABEL_HORIZONTAL_PADDING;
								const labelFitsInside =
									barWidth >=
									Math.max(FEATURE_LABEL_MIN_INSIDE_WIDTH, estimatedLabelWidth);
								const startTooltipDate = effectiveStartDate
									? toISODateString(effectiveStartDate)
									: feature.start_date ?? "";
								const endTooltipDate = effectiveEndDate
									? toISODateString(effectiveEndDate)
									: feature.end_date ?? "";
								const tooltip = hasDates
									? `${fmtShort(startTooltipDate)} -> ${fmtShort(endTooltipDate)} | ${clampedProgress}%`
									: "No dates set";

								const isDrawingThisFeature =
									drawDragState?.kind === "feature" &&
									(drawDragState.entity as RoadmapFeature).id === feature.id;
								const featureDrawLeft = isDrawingThisFeature
									? toTimelinePx(drawDragState.draftStartDate, rangeStart, granularity, cw)
									: 0;
								const featureDrawRight = isDrawingThisFeature
									? toTimelinePx(drawDragState.draftEndDate, rangeStart, granularity, cw)
									: 0;
								const featureDrawWidth = Math.max(2, featureDrawRight - featureDrawLeft);

								return (
									<div
										key={`right-feature-${feature.id}`}
										className="relative border-b border-gray-100"
										style={{
											height: ROW_HEIGHT,
											width: totalWidth,
											...gridBg,
										}}
									>
										{todayColInRange && (
											<div
												className="absolute top-0 bottom-0 pointer-events-none"
												style={{
													left: todayColLeft,
													width: cw,
													backgroundColor: "#f97316",
													opacity: 0.07,
												}}
											/>
										)}

										{isDateDrawMode && !hasDates && (
											<div
												className="absolute inset-0 z-10 cursor-text"
												data-no-pan="true"
												onMouseDown={(e) => handleDrawStart(e, "feature", feature)}
											/>
										)}

										{isDrawingThisFeature && drawDragState.hasMoved && (
											<div
												className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20 rounded-sm"
												style={{
													left: Math.max(0, featureDrawLeft),
													width: featureDrawWidth,
													height: FEATURE_BAR_HEIGHT,
													backgroundColor: FEATURE_BAR_TRACK_COLOR,
													opacity: 0.7,
													border: "1.5px dashed #2563eb",
												}}
											/>
										)}

										{hasDates && (
											<>
												<div
													className={`absolute top-1/2 -translate-y-1/2 ${FEATURE_BAR_ROUNDED_CLASS} group ${
														canEditDateRanges
															? isDraggingThisFeature
																? "cursor-grabbing"
																: "cursor-pointer"
															: "cursor-default"
													}`}
													data-no-pan="true"
													onMouseDown={(event) =>
														handleDragStart(
															event,
															feature,
															"move",
															effectiveStartDate,
															effectiveEndDate,
														)
													}
													style={{
														left: Math.max(0, barLeft),
														width: barWidth,
														height: FEATURE_BAR_HEIGHT,
														backgroundColor: FEATURE_BAR_TRACK_COLOR,
														borderColor: FEATURE_BAR_BORDER_COLOR,
														borderWidth: 1,
													}}
												>
													<div
														className={`absolute left-0 top-0 bottom-0 ${FEATURE_BAR_ROUNDED_CLASS}`}
														style={{
															width: fillWidth,
															backgroundColor: FEATURE_BAR_FILL_COLOR,
														}}
													/>

													{canEditDateRanges && (
														<>
															<div className="pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-px bg-gray-600/70" />
															<div className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-px bg-gray-600/70" />
															<div
																className="absolute left-0 top-0 bottom-0 z-20 w-4 -translate-x-1/2 cursor-ew-resize bg-black/0 hover:bg-black/15 transition-colors"
																data-no-pan="true"
																onMouseDown={(event) =>
																	handleDragStart(
																		event,
																		feature,
																		"start",
																		effectiveStartDate,
																		effectiveEndDate,
																	)
																}
															/>
															<div
																className="absolute right-0 top-0 bottom-0 z-20 w-4 translate-x-1/2 cursor-ew-resize bg-black/0 hover:bg-black/15 transition-colors"
																data-no-pan="true"
																onMouseDown={(event) =>
																	handleDragStart(
																		event,
																		feature,
																		"end",
																		effectiveStartDate,
																		effectiveEndDate,
																	)
																}
															/>
														</>
													)}

													<div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
														<div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-1.5 whitespace-nowrap shadow-xl">
															<div className="font-semibold mb-0.5">
																{feature.title}
															</div>
															<div className="text-gray-300 text-[11px]">{tooltip}</div>
														</div>
													</div>

													{labelFitsInside && (
														<span className="absolute inset-0 flex items-center px-2 text-[10px] text-gray-800 font-medium truncate select-none">
															{feature.title}
														</span>
													)}
												</div>

												{!labelFitsInside && (
													<span
														className="absolute top-1/2 -translate-y-1/2 text-[11px] text-gray-700 font-medium whitespace-nowrap select-none pointer-events-none"
														style={{
															left:
																Math.max(0, barLeft) +
																barWidth +
																FEATURE_LABEL_OUTSIDE_GAP,
														}}
													>
														{feature.title}
													</span>
												)}
											</>
										)}
									</div>
								);
							})}
					</div>
				);
			})}
		</>
	);
};
