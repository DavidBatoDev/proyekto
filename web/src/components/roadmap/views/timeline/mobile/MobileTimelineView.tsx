import {
	CalendarSearch,
	ChartNoAxesGantt,
	FilterX,
	Link2,
	Plus,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useFeatureDependenciesQuery } from "@/hooks/useFeatureDependencies";
import { useToast } from "@/hooks/useToast";
import type {
	AssigneeProfile,
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapMilestone,
} from "@/types/roadmap";
import { getSortedEpics } from "../../../panels/explorer/RoadmapStructureHeader";
import { MilestoneEditorModal } from "../../milestones/components/MilestoneEditorModal";
import { useMilestoneEditor } from "../../milestones/hooks/useMilestoneEditor";
import type { Granularity } from "../../milestones/model/types";
import { addInterval } from "../../milestones/model/utils";
import { TimelineColumnsHeader } from "../components/TimelineColumnsHeader";
import { TimelineEmptyState } from "../components/TimelineEmptyState";
import {
	EMPTY_TIMELINE_FILTERS,
	type TimelineFilters,
} from "../components/TimelineFilterMenu";
import { TimelineGrid } from "../components/TimelineGrid";
import { TimelineTaskColumn } from "../components/TimelineTaskColumn";
import { useTimelineScale } from "../hooks/useTimelineScale";
import { useTimelineViewport } from "../hooks/useTimelineViewport";
import { type BarGeometry, resolveBarGeometry } from "../model/barGeometry";
import {
	detectConflicts,
	indexConflicts,
	type ScheduledFeature,
} from "../model/dependencyConflicts";
import { buildDependencyEdges } from "../model/dependencyGeometry";
import { buildMatchedRowKeys } from "../model/rowFilter";
import { buildTimelineRows, ROW_H, type TimelineRow } from "../model/rows";
import {
	type MobileDateCommit,
	MobileTimelineDetailSheet,
} from "./MobileTimelineDetailSheet";
import { MobileTimelineFilterSheet } from "./MobileTimelineFilterSheet";
import { MobileTimelineToolbar } from "./MobileTimelineToolbar";
import { type PinchAnchor, useTimelinePinch } from "./useTimelinePinch";

/**
 * Frozen task column, narrowed from the desktop's 320. On a 390px phone that
 * still leaves ~258px of chart — about two and a half months at the default
 * scale — while keeping enough room to read a truncated title.
 */
const MOBILE_TASK_COL_WIDTH = 132;

/**
 * Collapsed, the column gives its 132px back to the chart — worth a third of the
 * viewport on a phone. The row names then ride on the bars themselves, so
 * nothing is anonymous; what is lost is the epic expand/collapse chevron, which
 * is why this is a toggle and not the default.
 */
const COLLAPSED_TASK_COL_WIDTH = 0;

/**
 * Deliberately the same shape as `TimelineViewProps`, minus the desktop-only
 * `onAddFeature`, so `RoadmapCanvas` can hand the mobile view the very same
 * props it already assembles for the desktop one.
 */
export interface MobileTimelineViewProps {
	roadmap: Roadmap;
	milestones: RoadmapMilestone[];
	epics: RoadmapEpic[];
	onAddMilestone: (data: {
		title: string;
		target_date: string;
		description?: string;
		status?: RoadmapMilestone["status"];
		color?: string;
	}) => Promise<void> | void;
	onUpdateMilestone: (milestone: RoadmapMilestone) => Promise<void> | void;
	onDeleteMilestone: (id: string) => Promise<void> | void;
	onUpdateFeature: (feature: RoadmapFeature) => Promise<void> | void;
	onUpdateEpic?: (epic: RoadmapEpic) => Promise<void> | void;
	onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
	onOpenEpicEditor?: (epicId: string) => void;
	canEditTimelineDates?: boolean;
	onAddEpic?: () => void;
	onLinkRoadmap?: () => void;
}

/**
 * The Gantt on a phone.
 *
 * Shares the whole model layer with the desktop `TimelineView` — the same
 * scale, rows, bar geometry, conflict detection and dependency routing — and
 * replaces only the shell, because what has to change is all interaction:
 *
 *  - **Scrolling is the browser's.** `useTimelineViewport` runs with
 *    `panEnabled: false`, so the drag-to-pan that desktop layers on
 *    `pointerdown` never mounts. It fought native touch scrolling and its
 *    `pointerEvents: "none"` swallowed taps.
 *  - **Bars are inert.** `canEditDates={false}` disables move, resize, draw and
 *    dependency-create in one flag, which matters more here than it reads: the
 *    desktop bar begins a reschedule on `pointerdown`, so on touch every
 *    attempt to scroll across a bar would have silently moved real work.
 *  - **Tap replaces double-click and right-click**, both of which have no touch
 *    equivalent, and opens the detail sheet where dates are actually edited.
 *  - **Pinch replaces the zoom pills** (which are still there too — a gesture
 *    nobody discovers is not a control).
 */
export const MobileTimelineView = ({
	roadmap,
	milestones,
	epics,
	onAddMilestone,
	onUpdateMilestone,
	onDeleteMilestone,
	onUpdateFeature,
	onUpdateEpic,
	onOpenFeatureEditor,
	onOpenEpicEditor,
	canEditTimelineDates = false,
	onAddEpic,
	onLinkRoadmap,
}: MobileTimelineViewProps) => {
	const toast = useToast();

	const [granularity, setGranularity] = useState<Granularity>("month");
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [query, setQuery] = useState("");
	const [filters, setFilters] = useState<TimelineFilters>(
		EMPTY_TIMELINE_FILTERS,
	);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [isTaskColumnOpen, setIsTaskColumnOpen] = useState(true);
	const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
	const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [pendingDates, setPendingDates] = useState<
		Record<string, { startDate: string; endDate: string }>
	>({});

	const taskColWidth = isTaskColumnOpen
		? MOBILE_TASK_COL_WIDTH
		: COLLAPSED_TASK_COL_WIDTH;

	const sortedEpics = useMemo(() => getSortedEpics(epics), [epics]);
	const sortedMilestones = useMemo(
		() =>
			[...milestones].sort(
				(a, b) =>
					new Date(a.target_date).getTime() - new Date(b.target_date).getTime(),
			),
		[milestones],
	);

	const dependenciesQuery = useFeatureDependenciesQuery(roadmap.id);
	const dependencies = useMemo(
		() => dependenciesQuery.data ?? [],
		[dependenciesQuery.data],
	);

	const assigneeOptions = useMemo(() => {
		const byId = new Map<string, AssigneeProfile>();
		for (const epic of sortedEpics) {
			for (const feature of epic.features ?? []) {
				for (const assignee of feature.assignees ?? []) {
					byId.set(assignee.id, assignee);
				}
			}
		}
		return [...byId.values()].sort((a, b) =>
			(a.display_name ?? "").localeCompare(b.display_name ?? ""),
		);
	}, [sortedEpics]);

	const matchedRowKeys = useMemo(
		() => buildMatchedRowKeys({ epics: sortedEpics, query, filters }),
		[sortedEpics, query, filters],
	);

	const rows = useMemo(() => {
		const all = buildTimelineRows(sortedEpics, collapsed);
		if (!matchedRowKeys) return all;
		return all.filter((row) => matchedRowKeys.has(row.rowKey));
	}, [sortedEpics, collapsed, matchedRowKeys]);

	const scale = useTimelineScale(sortedEpics, sortedMilestones, granularity);
	const totalHeight = Math.max(rows.length * ROW_H, ROW_H);

	const {
		viewportRef,
		contentRef,
		window: viewWindow,
		scrollToPx,
	} = useTimelineViewport({
		rowCount: rows.length,
		columnCount: scale.columns.length,
		colWidth: scale.cw,
		// Touch scrolling is the browser's job here. Desktop's drag-to-pan would
		// double up with it and eat taps.
		panEnabled: false,
	});

	// Drop a visual override once the server value matches it.
	useEffect(() => {
		setPendingDates((prev) => {
			if (Object.keys(prev).length === 0) return prev;
			const next = { ...prev };
			let changed = false;
			for (const row of buildTimelineRows(sortedEpics, new Set())) {
				const draft = next[row.rowKey];
				if (!draft) continue;
				const entity = row.kind === "epic" ? row.epic : row.feature;
				if (
					entity.start_date === draft.startDate &&
					entity.end_date === draft.endDate
				) {
					delete next[row.rowKey];
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [sortedEpics]);

	const geometryByRowKey = useMemo(() => {
		const map = new Map<string, BarGeometry>();
		for (const row of rows) {
			// No drag drafts on mobile, so the draft resolver is a constant null.
			const geometry = resolveBarGeometry(
				row,
				pendingDates,
				() => null,
				scale.dateToPx,
			);
			if (geometry) map.set(row.rowKey, geometry);
		}
		return map;
	}, [rows, pendingDates, scale.dateToPx]);

	const rowIndexByRowKey = useMemo(() => {
		const map = new Map<string, number>();
		rows.forEach((row, index) => map.set(row.rowKey, index));
		return map;
	}, [rows]);

	const epicIdByFeatureId = useMemo(() => {
		const map = new Map<string, string>();
		for (const epic of sortedEpics) {
			for (const feature of epic.features ?? []) map.set(feature.id, epic.id);
		}
		return map;
	}, [sortedEpics]);

	const scheduledFeatureById = useMemo(() => {
		const map = new Map<string, ScheduledFeature>();
		for (const epic of sortedEpics) {
			for (const feature of epic.features ?? []) {
				const pending = pendingDates[`feature:${feature.id}`];
				map.set(feature.id, {
					id: feature.id,
					title: feature.title,
					start_date: pending?.startDate ?? feature.start_date,
					end_date: pending?.endDate ?? feature.end_date,
				});
			}
		}
		return map;
	}, [sortedEpics, pendingDates]);

	const {
		byDependencyId: conflictsByDependencyId,
		bySuccessorId: conflictsBySuccessorId,
	} = useMemo(
		() => indexConflicts(detectConflicts(dependencies, scheduledFeatureById)),
		[dependencies, scheduledFeatureById],
	);

	const { edges: dependencyEdges } = useMemo(
		() =>
			buildDependencyEdges({
				dependencies,
				rows,
				rowIndexByRowKey,
				epicIdByFeatureId,
				geometryByRowKey,
				conflictDependencyIds: new Set(conflictsByDependencyId.keys()),
			}),
		[
			dependencies,
			rows,
			rowIndexByRowKey,
			epicIdByFeatureId,
			geometryByRowKey,
			conflictsByDependencyId,
		],
	);

	const milestoneEditor = useMilestoneEditor({
		sortedMilestones,
		onAddMilestone,
		onUpdateMilestone,
		onDeleteMilestone,
	});

	const periodLabel = useMemo(() => {
		const firstVisible =
			scale.columns[Math.max(0, viewWindow.colStart + 2)] ?? scale.columns[0];
		if (!firstVisible) return "";
		return firstVisible.start.toLocaleDateString(undefined, {
			month: "long",
			year: "numeric",
		});
	}, [scale.columns, viewWindow.colStart]);

	const handleStepPeriod = useCallback(
		(direction: -1 | 1) => {
			const el = viewportRef.current;
			if (!el) return;
			const current = scale.pxToDate(el.scrollLeft);
			scrollToPx(scale.dateToPx(addInterval(current, "month", direction)));
		},
		[scale.pxToDate, scale.dateToPx, scrollToPx, viewportRef],
	);

	const handleToday = useCallback(() => {
		const el = viewportRef.current;
		const offset = el ? el.clientWidth / 2 - taskColWidth / 2 : 0;
		scrollToPx(scale.todayPx - offset);
	}, [scale.todayPx, scrollToPx, viewportRef]);

	const toggleExpand = useCallback((epicId: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(epicId)) next.delete(epicId);
			else next.add(epicId);
			return next;
		});
	}, []);

	/**
	 * Pinch anchoring. A granularity change rescales every column, so scrollLeft
	 * means something different on the other side of it; without restoring the
	 * anchor the chart lurches away from whatever the user was pinching on.
	 * Applied in a layout effect so it lands before paint.
	 */
	const pinchAnchorRef = useRef<PinchAnchor | null>(null);

	useTimelinePinch({
		targetRef: viewportRef,
		granularity,
		taskColWidth: taskColWidth,
		pxToDate: scale.pxToDate,
		onGranularityChange: (next, anchor) => {
			pinchAnchorRef.current = anchor;
			setGranularity(next);
		},
	});

	useLayoutEffect(() => {
		const anchor = pinchAnchorRef.current;
		const el = viewportRef.current;
		if (!anchor || !el) return;
		pinchAnchorRef.current = null;
		el.scrollLeft = Math.max(0, scale.dateToPx(anchor.date) - anchor.offsetX);
	}, [scale.dateToPx, viewportRef]);

	// Centre on today the first time a usable scale exists.
	const didCentreRef = useRef(false);
	useEffect(() => {
		if (didCentreRef.current || !scale.todayInRange) return;
		didCentreRef.current = true;
		const el = viewportRef.current;
		if (!el) return;
		el.scrollLeft = Math.max(0, scale.todayPx - el.clientWidth / 3);
	}, [scale.todayInRange, scale.todayPx, viewportRef]);

	const selectedRow = useMemo(
		() => rows.find((row) => row.rowKey === selectedRowKey) ?? null,
		[rows, selectedRowKey],
	);

	const openRowEditor = useCallback(
		(row: TimelineRow) => {
			setSelectedRowKey(null);
			if (row.kind === "epic") onOpenEpicEditor?.(row.epic.id);
			else onOpenFeatureEditor?.(row.epic.id, row.feature.id);
		},
		[onOpenEpicEditor, onOpenFeatureEditor],
	);

	const handleCommitDates = useCallback(
		async ({ row, startDate, endDate }: MobileDateCommit) => {
			if (!canEditTimelineDates) return;

			// Optimistic overlay first, exactly as the desktop drag commit does, so
			// the bar moves under the sheet as it closes.
			setPendingDates((prev) => ({
				...prev,
				[row.rowKey]: { startDate, endDate },
			}));
			setSelectedRowKey(null);
			setIsSaving(true);

			try {
				if (row.kind === "feature") {
					await onUpdateFeature({
						...row.feature,
						start_date: startDate,
						end_date: endDate,
						updated_at: new Date().toISOString(),
					});
				} else if (onUpdateEpic) {
					await onUpdateEpic({
						...row.epic,
						start_date: startDate,
						end_date: endDate,
						updated_at: new Date().toISOString(),
					});
				}
			} catch (error) {
				console.error("Failed to update timeline dates", error);
				toast.error("Could not save the new dates");
				setPendingDates((prev) => {
					const next = { ...prev };
					delete next[row.rowKey];
					return next;
				});
			} finally {
				setIsSaving(false);
			}
		},
		[canEditTimelineDates, onUpdateFeature, onUpdateEpic, toast],
	);

	const handleClearDates = useCallback(
		async (row: TimelineRow) => {
			if (!canEditTimelineDates) return;

			setPendingDates((prev) => {
				const next = { ...prev };
				delete next[row.rowKey];
				return next;
			});
			setSelectedRowKey(null);
			setIsSaving(true);

			try {
				if (row.kind === "feature") {
					await onUpdateFeature({
						...row.feature,
						start_date: undefined,
						end_date: undefined,
						updated_at: new Date().toISOString(),
					});
				} else if (onUpdateEpic) {
					await onUpdateEpic({
						...row.epic,
						start_date: undefined,
						end_date: undefined,
						updated_at: new Date().toISOString(),
					});
				}
			} catch (error) {
				console.error("Failed to clear timeline dates", error);
				toast.error("Could not remove it from the timeline");
			} finally {
				setIsSaving(false);
			}
		},
		[canEditTimelineDates, onUpdateFeature, onUpdateEpic, toast],
	);

	const displayedMarkers = useMemo(
		() => scale.milestoneMarkers,
		[scale.milestoneMarkers],
	);

	const hasEpics = sortedEpics.length > 0;

	return (
		<div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
			<MobileTimelineToolbar
				periodLabel={periodLabel}
				granularity={granularity}
				query={query}
				filters={filters}
				matchCount={matchedRowKeys ? rows.length : null}
				conflictCount={conflictsByDependencyId.size}
				isSearchOpen={isSearchOpen}
				isTaskColumnOpen={isTaskColumnOpen}
				onToggleTaskColumn={() => setIsTaskColumnOpen((open) => !open)}
				onToggleSearch={() => {
					setIsSearchOpen((open) => {
						if (open) setQuery("");
						return !open;
					});
				}}
				onQueryChange={setQuery}
				onGranularityChange={setGranularity}
				onStepPeriod={handleStepPeriod}
				onToday={handleToday}
				onOpenFilters={() => setIsFilterSheetOpen(true)}
			/>

			{!hasEpics ? (
				<TimelineEmptyState
					icon={ChartNoAxesGantt}
					title="Nothing scheduled yet"
					description="Add an epic, then give its features dates to build the timeline."
				>
					{onAddEpic && (
						<button
							type="button"
							onClick={onAddEpic}
							className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white"
						>
							<Plus className="h-4 w-4" />
							Add epic
						</button>
					)}
					{onLinkRoadmap && (
						<button
							type="button"
							onClick={onLinkRoadmap}
							className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
						>
							<Link2 className="h-4 w-4" />
							Link a roadmap
						</button>
					)}
				</TimelineEmptyState>
			) : rows.length === 0 ? (
				<TimelineEmptyState
					icon={CalendarSearch}
					title="No work matches your filters"
					description={
						query.trim()
							? `Nothing matches “${query.trim()}” with the current filters.`
							: "Try widening or clearing the filters to see more."
					}
				>
					<button
						type="button"
						onClick={() => {
							setQuery("");
							setFilters(EMPTY_TIMELINE_FILTERS);
						}}
						className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
					>
						<FilterX className="h-4 w-4" />
						Clear filters
					</button>
				</TimelineEmptyState>
			) : (
				<div
					ref={viewportRef}
					className="relative min-w-0 flex-1 overflow-auto overscroll-contain"
					// One finger scrolls (composited, so it stays smooth); two fingers
					// belong to useTimelinePinch rather than to the browser's own zoom.
					style={{ touchAction: "pan-x pan-y" }}
				>
					<TimelineColumnsHeader
						columns={scale.columns}
						groups={scale.groups}
						cw={scale.cw}
						totalWidth={scale.totalWidth}
						colStart={viewWindow.colStart}
						colEnd={viewWindow.colEnd}
						todayColIndex={scale.todayColIndex}
						milestoneMarkers={displayedMarkers}
						canEditDates={false}
						gridBackground={scale.gridBackground}
						taskColWidth={taskColWidth}
						onMilestoneSelect={(marker) =>
							milestoneEditor.startEditMilestone(marker.milestone)
						}
						// Milestones are read-only here; dragging their date needs the same
						// precision the bar handles do.
						onMilestonePointerDown={() => {}}
					/>

					<div
						ref={contentRef}
						className="flex"
						style={{
							width: taskColWidth + scale.totalWidth,
							height: totalHeight,
						}}
					>
						{isTaskColumnOpen && (
							<TimelineTaskColumn
								rows={rows}
								rowStart={viewWindow.rowStart}
								rowEnd={viewWindow.rowEnd}
								totalHeight={totalHeight}
								selectedIds={new Set<string>()}
								canReorder={false}
								reorderRowKey={null}
								dropIndex={null}
								taskColWidth={taskColWidth}
								compact
								onToggleSelect={() => {}}
								onToggleExpand={toggleExpand}
								onOpenRow={(row) => setSelectedRowKey(row.rowKey)}
								onReorderPointerDown={() => {}}
							/>
						)}

						<TimelineGrid
							rows={rows}
							rowStart={viewWindow.rowStart}
							rowEnd={viewWindow.rowEnd}
							totalWidth={scale.totalWidth}
							totalHeight={totalHeight}
							gridBackground={scale.gridBackground}
							todayColLeft={scale.todayColLeft}
							todayInRange={scale.todayInRange}
							cw={scale.cw}
							milestoneMarkers={displayedMarkers}
							// Disables move, resize, draw and dependency-create in one flag.
							// Load-bearing on touch: the desktop bar starts a reschedule on
							// pointerdown, so without this, scrolling across a bar would drag it.
							canEditDates={false}
							isDrawMode={false}
							geometryByRowKey={geometryByRowKey}
							dependencyEdges={dependencyEdges}
							selectedDependencyId={null}
							dependencyDraftPath={null}
							dependencyDraftIsValid={false}
							dependencyDraftTargetRowTop={null}
							onSelectDependency={() => {}}
							onRemoveDependency={() => {}}
							onDependencyHandlePointerDown={() => {}}
							onBarGesture={() => {}}
							onOpenRow={(row) => setSelectedRowKey(row.rowKey)}
							onBarClick={(row) => setSelectedRowKey(row.rowKey)}
							onBarContextMenu={() => {}}
							disableContextMenu
							// With the column collapsed, the bars are the only thing naming
							// the rows.
							showBarLabels={!isTaskColumnOpen}
						/>
					</div>
				</div>
			)}

			<MobileTimelineFilterSheet
				open={isFilterSheetOpen}
				filters={filters}
				assignees={assigneeOptions}
				onChange={setFilters}
				onClose={() => setIsFilterSheetOpen(false)}
			/>

			<MobileTimelineDetailSheet
				row={selectedRow}
				canEditDates={canEditTimelineDates}
				isSaving={isSaving}
				conflictFixDate={
					selectedRow?.kind === "feature"
						? (conflictsBySuccessorId.get(selectedRow.feature.id)
								?.earliestStart ?? null)
						: null
				}
				onCommitDates={(commit) => void handleCommitDates(commit)}
				onClearDates={(row) => void handleClearDates(row)}
				onOpenRow={openRowEditor}
				onClose={() => setSelectedRowKey(null)}
			/>

			<MilestoneEditorModal
				isOpen={milestoneEditor.isMilestoneModalOpen}
				mode={milestoneEditor.milestoneModalMode}
				isSaving={milestoneEditor.isSavingMilestone}
				isDeleting={milestoneEditor.isDeletingMilestone}
				draftTitle={milestoneEditor.draftTitle}
				draftDate={milestoneEditor.draftDate}
				draftStatus={milestoneEditor.draftStatus}
				draftColor={milestoneEditor.draftColor}
				onDraftTitleChange={milestoneEditor.setDraftTitle}
				onDraftDateChange={milestoneEditor.setDraftDate}
				onDraftStatusChange={milestoneEditor.setDraftStatus}
				onDraftColorChange={milestoneEditor.setDraftColor}
				onCancel={milestoneEditor.cancelMilestoneEditor}
				onSubmit={milestoneEditor.submitMilestone}
				onDelete={milestoneEditor.deleteEditingMilestone}
			/>
		</div>
	);
};
