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
import {
	useAddFeatureDependency,
	useFeatureDependenciesQuery,
	useRemoveFeatureDependency,
} from "@/hooks/useFeatureDependencies";
import { useToast } from "@/hooks/useToast";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type {
	AssigneeProfile,
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapMilestone,
} from "@/types/roadmap";
import { EpicReorderConfirmModal } from "../../panels/EpicReorderConfirmModal";
import { getSortedEpics } from "../../panels/explorer/RoadmapStructureHeader";
import { FeatureReorderConfirmModal } from "../../panels/FeatureReorderConfirmModal";
import {
	type DateChangeConfirmPayload,
	FeatureDateChangeConfirmModal,
} from "../milestones/components/FeatureDateChangeConfirmModal";
import { MilestoneEditorModal } from "../milestones/components/MilestoneEditorModal";
import { useMilestoneEditor } from "../milestones/hooks/useMilestoneEditor";
import type { Granularity, MilestoneMarker } from "../milestones/model/types";
import {
	addInterval,
	floorToUnit,
	toISODateString,
} from "../milestones/model/utils";
import {
	type BarContextMenuState,
	TimelineBarContextMenu,
} from "./components/TimelineBarContextMenu";
import { TimelineColumnsHeader } from "./components/TimelineColumnsHeader";
import { TimelineEmptyState } from "./components/TimelineEmptyState";
import {
	EMPTY_TIMELINE_FILTERS,
	type TimelineFilters,
} from "./components/TimelineFilterMenu";
import { TimelineGrid } from "./components/TimelineGrid";
import { TimelineTaskColumn } from "./components/TimelineTaskColumn";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { useDependencyDrag } from "./hooks/useDependencyDrag";
import {
	type BarCommit,
	type BarGestureMode,
	useTimelineBarDrag,
} from "./hooks/useTimelineBarDrag";
import { useTimelineScale } from "./hooks/useTimelineScale";
import { useTimelineViewport } from "./hooks/useTimelineViewport";
import type { BarGeometry } from "./model/barGeometry";
import { resolveBarGeometry } from "./model/barGeometry";
import {
	detectConflicts,
	indexConflicts,
	proposeReschedule,
	type ScheduledFeature,
} from "./model/dependencyConflicts";
import { buildDependencyEdges } from "./model/dependencyGeometry";
import { buildAdjacency } from "./model/dependencyGraph";
import { buildMatchedRowKeys } from "./model/rowFilter";
import {
	buildTimelineRows,
	HEADER_H,
	ROW_H,
	TASK_COL_WIDTH,
	type TimelineRow,
} from "./model/rows";

export interface TimelineViewProps {
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
	onAddFeature?: (epicId: string) => void;
	onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
	onOpenEpicEditor?: (epicId: string) => void;
	canEditTimelineDates?: boolean;
	onAddEpic?: () => void;
	onLinkRoadmap?: () => void;
}

const DATE_CONFIRM_SKIP_KEY = "roadmap.timeline.skipDragDateConfirm";
const FEATURE_REORDER_SKIP_KEY = "roadmap.timeline.skipFeatureReorderConfirm";
const EPIC_REORDER_SKIP_KEY = "roadmap.timeline.skipEpicReorderConfirm";

type PendingDateChange = {
	commit: BarCommit;
	payload: DateChangeConfirmPayload;
};

type PendingReorder =
	| {
			kind: "feature";
			epicId: string;
			title: string;
			previousOrderIds: string[];
			nextOrderIds: string[];
	  }
	| {
			kind: "epic";
			title: string;
			previousOrderIds: string[];
			nextOrderIds: string[];
	  };

const readSkipFlag = (key: string): boolean => {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(key) === "true";
	} catch {
		return false;
	}
};

const writeSkipFlag = (key: string, value: boolean) => {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(key, value ? "true" : "false");
	} catch {
		// storage unavailable — the confirm simply keeps asking
	}
};

/**
 * Timeline (Gantt) view.
 *
 * Rebuilt around a single two-axis scroll container with a virtualized row
 * window, so cost tracks the viewport rather than the size of the roadmap.
 * The left task tree and the bar grid are two columns of that one scroller,
 * which keeps them in lockstep without any scroll-sync bookkeeping.
 */
export const TimelineView = ({
	roadmap,
	milestones,
	epics,
	onAddMilestone,
	onUpdateMilestone,
	onDeleteMilestone,
	onUpdateFeature,
	onUpdateEpic,
	onAddFeature,
	onOpenFeatureEditor,
	onOpenEpicEditor,
	canEditTimelineDates = true,
	onAddEpic,
	onLinkRoadmap,
}: TimelineViewProps) => {
	const toast = useToast();
	const reorderFeaturesInEpic = useRoadmapStore(
		(state) => state.reorderFeaturesInEpic,
	);
	const previewFeatureOrderInEpic = useRoadmapStore(
		(state) => state.previewFeatureOrderInEpic,
	);
	const reorderEpicsInRoadmap = useRoadmapStore(
		(state) => state.reorderEpicsInRoadmap,
	);
	const previewEpicOrderInRoadmap = useRoadmapStore(
		(state) => state.previewEpicOrderInRoadmap,
	);

	const [granularity, setGranularity] = useState<Granularity>("week");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [query, setQuery] = useState("");
	const [isDrawMode, setIsDrawMode] = useState(false);
	const [filters, setFilters] = useState<TimelineFilters>(
		EMPTY_TIMELINE_FILTERS,
	);
	const [pendingDates, setPendingDates] = useState<
		Record<string, { startDate: string; endDate: string }>
	>({});
	const [pendingDateChange, setPendingDateChange] =
		useState<PendingDateChange | null>(null);
	const [pendingReorder, setPendingReorder] = useState<PendingReorder | null>(
		null,
	);
	const [barContextMenu, setBarContextMenu] =
		useState<BarContextMenuState | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [skipDateConfirm, setSkipDateConfirm] = useState(false);
	const [skipReorderConfirm, setSkipReorderConfirm] = useState(false);

	const sortedEpics = useMemo(() => getSortedEpics(epics), [epics]);
	const sortedMilestones = useMemo(
		() =>
			[...milestones].sort(
				(a, b) =>
					new Date(a.target_date).getTime() - new Date(b.target_date).getTime(),
			),
		[milestones],
	);

	/** Everyone assigned to a feature, for the Filter menu's assignee list. */
	const assigneeOptions = useMemo(() => {
		const byId = new Map<string, AssigneeProfile>();
		for (const epic of sortedEpics) {
			for (const feature of epic.features ?? []) {
				for (const assignee of feature.assignees ?? []) {
					if (!byId.has(assignee.id)) byId.set(assignee.id, assignee);
				}
			}
		}
		return [...byId.values()].sort((a, b) =>
			(a.display_name ?? "").localeCompare(b.display_name ?? ""),
		);
	}, [sortedEpics]);

	/**
	 * Search + filters resolve to the set of rows worth showing. An epic
	 * survives if it matches itself or if any of its features do, so a matching
	 * feature is never orphaned from its parent.
	 */
	const matchedRowKeys = useMemo(
		() => buildMatchedRowKeys({ epics: sortedEpics, query, filters }),
		[query, sortedEpics, filters],
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
		isPanning,
		scrollToPx,
	} = useTimelineViewport({
		rowCount: rows.length,
		columnCount: scale.columns.length,
		colWidth: scale.cw,
		panEnabled: true,
	});

	// clientX -> timeline px, i.e. relative to the grid's left edge including
	// horizontal scroll. Read from the scroller so a drag needs no React state.
	const clientXToTimelinePx = useCallback(
		(clientX: number) => {
			const el = viewportRef.current;
			if (!el) return 0;
			const rect = el.getBoundingClientRect();
			return clientX - rect.left + el.scrollLeft - TASK_COL_WIDTH;
		},
		[viewportRef],
	);

	/**
	 * clientY -> grid px. Extracted from the row-reorder gesture so the
	 * dependency drop target and the reorder insertion point cannot drift
	 * apart. Callers round differently: floor() for "which row am I over",
	 * round() for "which gap am I between".
	 */
	const clientYToTimelinePx = useCallback(
		(clientY: number) => {
			const el = viewportRef.current;
			if (!el) return 0;
			const rect = el.getBoundingClientRect();
			return clientY - rect.top + el.scrollTop - HEADER_H;
		},
		[viewportRef],
	);

	const milestoneEditor = useMilestoneEditor({
		sortedMilestones,
		onAddMilestone,
		onUpdateMilestone,
		onDeleteMilestone,
	});

	useEffect(() => {
		setSkipDateConfirm(readSkipFlag(DATE_CONFIRM_SKIP_KEY));
		setSkipReorderConfirm(
			readSkipFlag(FEATURE_REORDER_SKIP_KEY) ||
				readSkipFlag(EPIC_REORDER_SKIP_KEY),
		);
	}, []);

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

	const persistDateChange = useCallback(
		async (commit: BarCommit) => {
			setIsSaving(true);
			try {
				if (commit.row.kind === "feature") {
					await onUpdateFeature({
						...commit.row.feature,
						start_date: commit.newStartDate,
						end_date: commit.newEndDate,
						updated_at: new Date().toISOString(),
					});
				} else if (onUpdateEpic) {
					await onUpdateEpic({
						...commit.row.epic,
						start_date: commit.newStartDate,
						end_date: commit.newEndDate,
						updated_at: new Date().toISOString(),
					});
				}
			} catch (error) {
				console.error("Failed to update timeline dates", error);
				toast.error("Could not save the new dates");
				setPendingDates((prev) => {
					const next = { ...prev };
					delete next[commit.row.rowKey];
					return next;
				});
			} finally {
				setIsSaving(false);
			}
		},
		[onUpdateFeature, onUpdateEpic, toast],
	);

	const handleBarCommit = useCallback(
		(commit: BarCommit) => {
			if (!canEditTimelineDates) return;

			setPendingDates((prev) => ({
				...prev,
				[commit.row.rowKey]: {
					startDate: commit.newStartDate,
					endDate: commit.newEndDate,
				},
			}));

			// Creating a range on a bar that had none is not a "change" worth a
			// confirm — there is nothing to overwrite.
			const isCreation = !commit.oldStartDate || !commit.oldEndDate;
			if (isCreation || skipDateConfirm) {
				void persistDateChange(commit);
				return;
			}

			setPendingDateChange({
				commit,
				payload: {
					entityLabel:
						commit.row.kind === "epic"
							? commit.row.epic.title
							: commit.row.feature.title,
					oldStartDate: commit.oldStartDate ?? "",
					oldEndDate: commit.oldEndDate ?? "",
					newStartDate: commit.newStartDate,
					newEndDate: commit.newEndDate,
				},
			});
		},
		[canEditTimelineDates, skipDateConfirm, persistDateChange],
	);

	const barDrag = useTimelineBarDrag({
		pxToDate: scale.pxToDate,
		dateToPx: scale.dateToPx,
		clientXToTimelinePx,
		onCommit: handleBarCommit,
		enabled: canEditTimelineDates,
	});

	const handleBarGesture = useCallback(
		(event: React.PointerEvent, row: TimelineRow, mode: BarGestureMode) => {
			if (!canEditTimelineDates) return;
			barDrag.beginGesture(event, row, mode);
		},
		[barDrag, canEditTimelineDates],
	);

	// ---- Milestone drag on the header -------------------------------------
	const milestoneDragRef = useRef<{ marker: MilestoneMarker } | null>(null);
	const [milestoneDraft, setMilestoneDraft] = useState<Record<string, string>>(
		{},
	);

	const handleMilestonePointerDown = useCallback(
		(event: React.PointerEvent, marker: MilestoneMarker) => {
			if (!canEditTimelineDates) return;
			event.preventDefault();
			event.stopPropagation();
			milestoneDragRef.current = { marker };

			const onMove = (moveEvent: PointerEvent) => {
				const date = floorToUnit(
					scale.pxToDate(clientXToTimelinePx(moveEvent.clientX)),
					"day",
				);
				setMilestoneDraft((prev) => ({
					...prev,
					[marker.milestone.id]: toISODateString(date),
				}));
			};

			const onUp = () => {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				const dragged = milestoneDragRef.current;
				milestoneDragRef.current = null;
				if (!dragged) return;

				setMilestoneDraft((prev) => {
					const nextDate = prev[dragged.marker.milestone.id];
					if (nextDate && nextDate !== dragged.marker.milestone.target_date) {
						void Promise.resolve(
							onUpdateMilestone({
								...dragged.marker.milestone,
								target_date: nextDate,
							}),
						).catch((error) => {
							console.error("Failed to move milestone", error);
							toast.error("Could not move the milestone");
						});
					}
					const next = { ...prev };
					delete next[dragged.marker.milestone.id];
					return next;
				});
			};

			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		},
		[
			canEditTimelineDates,
			scale.pxToDate,
			clientXToTimelinePx,
			onUpdateMilestone,
			toast,
		],
	);

	const displayedMarkers = useMemo(
		() =>
			scale.milestoneMarkers.map((marker) => {
				const draftDate = milestoneDraft[marker.milestone.id];
				return draftDate
					? { ...marker, left: scale.dateToPx(draftDate) }
					: marker;
			}),
		[scale.milestoneMarkers, scale.dateToPx, milestoneDraft],
	);

	// ---- Row reordering ----------------------------------------------------
	const [reorderRowKey, setReorderRowKey] = useState<string | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);

	const handleReorderPointerDown = useCallback(
		(event: React.PointerEvent, row: TimelineRow) => {
			if (!canEditTimelineDates) return;
			event.preventDefault();
			event.stopPropagation();
			setReorderRowKey(row.rowKey);

			const onMove = (moveEvent: PointerEvent) => {
				const el = viewportRef.current;
				if (!el) return;
				const rect = el.getBoundingClientRect();
				const y = moveEvent.clientY - rect.top + el.scrollTop - HEADER_H;
				setDropIndex(Math.max(0, Math.min(rows.length, Math.round(y / ROW_H))));
			};

			const onUp = () => {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				setReorderRowKey(null);
				setDropIndex((currentDropIndex) => {
					if (currentDropIndex !== null) {
						commitReorder(row, currentDropIndex);
					}
					return null;
				});
			};

			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		},
		// commitReorder is defined below and is stable for this callback's use.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[canEditTimelineDates, rows.length, viewportRef],
	);

	const commitReorder = useCallback(
		(row: TimelineRow, targetIndex: number) => {
			const target = rows[Math.min(targetIndex, rows.length - 1)];
			if (!target || target.rowKey === row.rowKey) return;

			if (row.kind === "feature") {
				// Features only reorder inside their own epic.
				if (target.kind === "feature" && target.epic.id !== row.epic.id) return;
				const siblings = row.epic.features ?? [];
				const previousOrderIds = siblings.map((feature) => feature.id);
				const from = previousOrderIds.indexOf(row.feature.id);
				const to =
					target.kind === "feature"
						? previousOrderIds.indexOf(target.feature.id)
						: 0;
				if (from < 0 || to < 0 || from === to) return;

				const nextOrderIds = [...previousOrderIds];
				nextOrderIds.splice(from, 1);
				nextOrderIds.splice(to, 0, row.feature.id);

				previewFeatureOrderInEpic(row.epic.id, nextOrderIds);
				const reorder: PendingReorder = {
					kind: "feature",
					epicId: row.epic.id,
					title: row.feature.title,
					previousOrderIds,
					nextOrderIds,
				};
				if (skipReorderConfirm) {
					void applyReorder(reorder);
					return;
				}
				setPendingReorder(reorder);
				return;
			}

			const previousOrderIds = sortedEpics.map((epic) => epic.id);
			const from = previousOrderIds.indexOf(row.epic.id);
			const to = previousOrderIds.indexOf(target.epic.id);
			if (from < 0 || to < 0 || from === to) return;

			const nextOrderIds = [...previousOrderIds];
			nextOrderIds.splice(from, 1);
			nextOrderIds.splice(to, 0, row.epic.id);

			previewEpicOrderInRoadmap(nextOrderIds);
			const reorder: PendingReorder = {
				kind: "epic",
				title: row.epic.title,
				previousOrderIds,
				nextOrderIds,
			};
			if (skipReorderConfirm) {
				void applyReorder(reorder);
				return;
			}
			setPendingReorder(reorder);
		},
		// applyReorder is declared below; both are stable across renders.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			rows,
			sortedEpics,
			skipReorderConfirm,
			previewFeatureOrderInEpic,
			previewEpicOrderInRoadmap,
		],
	);

	const applyReorder = useCallback(
		async (reorder: PendingReorder) => {
			setIsSaving(true);
			try {
				if (reorder.kind === "feature") {
					await reorderFeaturesInEpic(reorder.epicId, reorder.nextOrderIds);
				} else {
					await reorderEpicsInRoadmap(reorder.nextOrderIds);
				}
			} catch (error) {
				console.error("Failed to reorder", error);
				toast.error("Could not save the new order");
				if (reorder.kind === "feature") {
					previewFeatureOrderInEpic(reorder.epicId, reorder.previousOrderIds);
				} else {
					previewEpicOrderInRoadmap(reorder.previousOrderIds);
				}
			} finally {
				setIsSaving(false);
				setPendingReorder(null);
			}
		},
		[
			reorderFeaturesInEpic,
			reorderEpicsInRoadmap,
			previewFeatureOrderInEpic,
			previewEpicOrderInRoadmap,
			toast,
		],
	);

	// ---- Dependencies -------------------------------------------------------
	const roadmapId = roadmap?.id;
	const { data: dependencies = [] } = useFeatureDependenciesQuery(roadmapId);
	const addDependency = useAddFeatureDependency(roadmapId);
	const removeDependency = useRemoveFeatureDependency(roadmapId);
	const [selectedDependencyId, setSelectedDependencyId] = useState<
		string | null
	>(null);

	/**
	 * Every visible row's bar extent, resolved once. Both the bars and the
	 * arrows read from this map, which is what keeps an arrow glued to its bar
	 * through drags and pending saves.
	 */
	const geometryByRowKey = useMemo(() => {
		const map = new Map<string, BarGeometry>();
		for (const row of rows) {
			const geometry = resolveBarGeometry(
				row,
				pendingDates,
				barDrag.getDraftGeometry,
				scale.dateToPx,
			);
			if (geometry) map.set(row.rowKey, geometry);
		}
		return map;
	}, [rows, pendingDates, barDrag.getDraftGeometry, scale.dateToPx]);

	const rowIndexByRowKey = useMemo(() => {
		const map = new Map<string, number>();
		rows.forEach((row, index) => map.set(row.rowKey, index));
		return map;
	}, [rows]);

	/** Built from all epics, not just visible rows, so a collapsed epic can still roll up. */
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

	const adjacency = useMemo(() => buildAdjacency(dependencies), [dependencies]);

	const handleCreateDependency = useCallback(
		(blockingFeatureId: string, blockedFeatureId: string) => {
			addDependency.mutate(
				{ blockingFeatureId, blockedFeatureId },
				{
					onError: (error: unknown) => {
						const message =
							error instanceof Error ? error.message : "Could not link them";
						toast.error(message);
					},
				},
			);
		},
		[addDependency, toast],
	);

	const dependencyDrag = useDependencyDrag({
		rows,
		adjacency,
		geometryByRowKey,
		clientXToTimelinePx,
		clientYToTimelinePx,
		onCreate: handleCreateDependency,
		enabled: canEditTimelineDates,
	});

	const { edges: dependencyEdges, hiddenCount: hiddenDependencyCount } =
		useMemo(
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

	const handleRemoveDependency = useCallback(
		(dependencyId: string) => {
			setSelectedDependencyId(null);
			removeDependency.mutate(dependencyId, {
				onError: () => toast.error("Could not remove the link"),
			});
		},
		[removeDependency, toast],
	);

	/**
	 * Move a feature so it starts after its predecessor finishes, keeping its
	 * duration. Routed through handleBarCommit so it inherits the optimistic
	 * overlay, the confirm modal, rollback and the failure toast — no second
	 * write path.
	 */
	const handleFixSchedule = useCallback(
		(row: TimelineRow) => {
			if (row.kind !== "feature") return;
			const conflict = conflictsBySuccessorId.get(row.feature.id);
			if (!conflict) return;
			const successor = scheduledFeatureById.get(row.feature.id);
			if (!successor) return;
			const next = proposeReschedule(conflict, successor);
			if (!next) return;

			handleBarCommit({
				row,
				mode: "move",
				oldStartDate: successor.start_date ?? null,
				oldEndDate: successor.end_date ?? null,
				newStartDate: next.start_date,
				newEndDate: next.end_date,
			});
		},
		[conflictsBySuccessorId, scheduledFeatureById, handleBarCommit],
	);

	// ---- Header period navigation ------------------------------------------
	/**
	 * Labelled from the first column actually in view. Reading scrollLeft during
	 * render was both impure and a frame stale, which is how the header could
	 * claim "April" while showing June onwards.
	 */
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
			const next = addInterval(current, "month", direction);
			scrollToPx(scale.dateToPx(next));
		},
		[scale.pxToDate, scale.dateToPx, scrollToPx, viewportRef],
	);

	const handleToday = useCallback(() => {
		const el = viewportRef.current;
		const offset = el ? el.clientWidth / 2 - TASK_COL_WIDTH / 2 : 0;
		scrollToPx(scale.todayPx - offset);
	}, [scale.todayPx, scrollToPx, viewportRef]);

	/**
	 * Hold the view still when the scale re-anchors.
	 *
	 * The extent is derived from the dated epics/features, so giving anything a
	 * date can move `rangeStart` — every bar's x changes at once while
	 * scrollLeft stays put, and the content appears to jump away (drawing the
	 * first bar looked like every bar vanishing). Re-scrolling by the shift of
	 * the old origin keeps what you were looking at where it was.
	 */
	const previousAnchorRef = useRef<{
		rangeStart: number;
		granularity: Granularity;
	} | null>(null);

	useLayoutEffect(() => {
		const el = viewportRef.current;
		const previous = previousAnchorRef.current;
		previousAnchorRef.current = {
			rangeStart: scale.rangeStart.getTime(),
			granularity,
		};

		if (!el || !previous) return;
		// A granularity switch rescales everything; Today re-centres instead.
		if (previous.granularity !== granularity) return;
		if (previous.rangeStart === scale.rangeStart.getTime()) return;

		const shift = scale.dateToPx(new Date(previous.rangeStart));
		if (!Number.isFinite(shift) || shift === 0) return;
		el.scrollLeft = Math.max(0, el.scrollLeft + shift);
	}, [scale.rangeStart, scale.dateToPx, granularity, viewportRef]);

	// Centre on today the first time a usable scale exists.
	const didCentreRef = useRef(false);
	useEffect(() => {
		if (didCentreRef.current || !scale.todayInRange) return;
		didCentreRef.current = true;
		const el = viewportRef.current;
		if (!el) return;
		el.scrollLeft = Math.max(0, scale.todayPx - el.clientWidth / 3);
	}, [scale.todayInRange, scale.todayPx, viewportRef]);

	const toggleExpand = useCallback((epicId: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(epicId)) next.delete(epicId);
			else next.add(epicId);
			return next;
		});
	}, []);

	const toggleSelect = useCallback((row: TimelineRow) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(row.rowKey)) next.delete(row.rowKey);
			else next.add(row.rowKey);
			return next;
		});
	}, []);

	const openRow = useCallback(
		(row: TimelineRow) => {
			if (row.kind === "epic") {
				onOpenEpicEditor?.(row.epic.id);
				return;
			}
			onOpenFeatureEditor?.(row.feature.epic_id, row.feature.id);
		},
		[onOpenEpicEditor, onOpenFeatureEditor],
	);

	const handleBarContextMenu = useCallback(
		(event: React.MouseEvent, row: TimelineRow) => {
			event.preventDefault();
			event.stopPropagation();
			setBarContextMenu({ row, x: event.clientX, y: event.clientY });
		},
		[],
	);

	/**
	 * "Remove from timeline" clears the dates rather than deleting anything: the
	 * epic/feature stays in the tree and can be re-drawn. Both store update
	 * paths send `?? null`, so an explicit undefined clears the column.
	 */
	const handleClearDates = useCallback(
		async (row: TimelineRow) => {
			if (!canEditTimelineDates) return;

			setPendingDates((prev) => {
				const next = { ...prev };
				delete next[row.rowKey];
				return next;
			});

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
			}
		},
		[canEditTimelineDates, onUpdateFeature, onUpdateEpic, toast],
	);

	const hasEpics = sortedEpics.length > 0;

	return (
		<div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
			<TimelineToolbar
				periodLabel={periodLabel}
				query={query}
				granularity={granularity}
				isDrawMode={isDrawMode}
				canEditDates={canEditTimelineDates}
				matchCount={matchedRowKeys ? rows.length : null}
				conflictCount={conflictsByDependencyId.size}
				hiddenDependencyCount={hiddenDependencyCount}
				filters={filters}
				assignees={assigneeOptions}
				onFiltersChange={setFilters}
				onQueryChange={setQuery}
				onGranularityChange={setGranularity}
				onToggleDrawMode={() => setIsDrawMode((value) => !value)}
				onStepPeriod={handleStepPeriod}
				onToday={handleToday}
				onAddMilestone={milestoneEditor.startCreateMilestone}
			/>

			{!hasEpics ? (
				<TimelineEmptyState
					icon={ChartNoAxesGantt}
					title="Nothing scheduled yet"
					description="Add an epic, then draw dates on its features to build the timeline."
				>
					{onAddEpic && (
						<button
							type="button"
							onClick={onAddEpic}
							className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
						>
							<Plus className="h-4 w-4" />
							Add epic
						</button>
					)}
					{onLinkRoadmap && (
						<button
							type="button"
							onClick={onLinkRoadmap}
							className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
						>
							<Link2 className="h-4 w-4" />
							Link a roadmap
						</button>
					)}
				</TimelineEmptyState>
			) : rows.length === 0 ? (
				/* Epics exist, but search or filters hid every row. The toolbar
				   stays above so the filters that caused this are one click away. */
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
						className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						<FilterX className="h-4 w-4" />
						Clear filters
					</button>
				</TimelineEmptyState>
			) : (
				<div
					ref={viewportRef}
					className={`relative min-w-0 flex-1 overflow-auto ${
						isDrawMode && canEditTimelineDates
							? "cursor-pencil"
							: isPanning
								? ""
								: "cursor-grab"
					}`}
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
						canEditDates={canEditTimelineDates}
						gridBackground={scale.gridBackground}
						onMilestoneSelect={(marker) =>
							milestoneEditor.startEditMilestone(marker.milestone)
						}
						onMilestonePointerDown={handleMilestonePointerDown}
					/>

					<div
						ref={contentRef}
						className="flex"
						style={{
							width: TASK_COL_WIDTH + scale.totalWidth,
							height: totalHeight,
						}}
					>
						<TimelineTaskColumn
							rows={rows}
							rowStart={viewWindow.rowStart}
							rowEnd={viewWindow.rowEnd}
							totalHeight={totalHeight}
							selectedIds={selectedIds}
							canReorder={canEditTimelineDates}
							reorderRowKey={reorderRowKey}
							dropIndex={dropIndex}
							onToggleSelect={toggleSelect}
							onToggleExpand={toggleExpand}
							onOpenRow={openRow}
							onAddFeature={onAddFeature}
							onReorderPointerDown={handleReorderPointerDown}
						/>

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
							canEditDates={canEditTimelineDates}
							isDrawMode={isDrawMode}
							geometryByRowKey={geometryByRowKey}
							dependencyEdges={dependencyEdges}
							selectedDependencyId={selectedDependencyId}
							dependencyDraftPath={dependencyDrag.draftPath}
							dependencyDraftIsValid={dependencyDrag.draftIsValid}
							dependencyDraftTargetRowTop={dependencyDrag.draftTargetRowTop}
							onSelectDependency={setSelectedDependencyId}
							onRemoveDependency={handleRemoveDependency}
							onDependencyHandlePointerDown={dependencyDrag.beginGesture}
							onBarGesture={handleBarGesture}
							onOpenRow={openRow}
							onBarContextMenu={handleBarContextMenu}
						/>
					</div>
				</div>
			)}

			{barContextMenu && (
				<TimelineBarContextMenu
					state={barContextMenu}
					canEditDates={canEditTimelineDates}
					onEdit={openRow}
					conflictFixDate={
						barContextMenu.row.kind === "feature"
							? (conflictsBySuccessorId.get(barContextMenu.row.feature.id)
									?.earliestStart ?? null)
							: null
					}
					onFixSchedule={handleFixSchedule}
					onClearDates={(row) => {
						void handleClearDates(row);
					}}
					onClose={() => setBarContextMenu(null)}
				/>
			)}

			<FeatureDateChangeConfirmModal
				isOpen={pendingDateChange !== null}
				isSaving={isSaving}
				change={pendingDateChange?.payload ?? null}
				dontAskAgain={skipDateConfirm}
				onDontAskAgainChange={(value) => {
					setSkipDateConfirm(value);
					writeSkipFlag(DATE_CONFIRM_SKIP_KEY, value);
				}}
				onCancel={() => {
					if (pendingDateChange) {
						setPendingDates((prev) => {
							const next = { ...prev };
							delete next[pendingDateChange.commit.row.rowKey];
							return next;
						});
					}
					setPendingDateChange(null);
				}}
				onConfirm={async () => {
					if (!pendingDateChange) return;
					await persistDateChange(pendingDateChange.commit);
					setPendingDateChange(null);
				}}
			/>

			<FeatureReorderConfirmModal
				isOpen={pendingReorder?.kind === "feature"}
				isSaving={isSaving}
				featureTitle={
					pendingReorder?.kind === "feature" ? pendingReorder.title : null
				}
				dontAskAgain={skipReorderConfirm}
				onDontAskAgainChange={(value) => {
					setSkipReorderConfirm(value);
					writeSkipFlag(FEATURE_REORDER_SKIP_KEY, value);
				}}
				onCancel={() => {
					if (pendingReorder?.kind === "feature") {
						previewFeatureOrderInEpic(
							pendingReorder.epicId,
							pendingReorder.previousOrderIds,
						);
					}
					setPendingReorder(null);
				}}
				onConfirm={() => {
					if (pendingReorder) void applyReorder(pendingReorder);
				}}
			/>

			<EpicReorderConfirmModal
				isOpen={pendingReorder?.kind === "epic"}
				isSaving={isSaving}
				epicTitle={
					pendingReorder?.kind === "epic" ? pendingReorder.title : null
				}
				dontAskAgain={skipReorderConfirm}
				onDontAskAgainChange={(value) => {
					setSkipReorderConfirm(value);
					writeSkipFlag(EPIC_REORDER_SKIP_KEY, value);
				}}
				onCancel={() => {
					if (pendingReorder?.kind === "epic") {
						previewEpicOrderInRoadmap(pendingReorder.previousOrderIds);
					}
					setPendingReorder(null);
				}}
				onConfirm={() => {
					if (pendingReorder) void applyReorder(pendingReorder);
				}}
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
