import { ChevronRight, ExternalLink, FolderOpen, GripVertical, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	type DragEndEvent,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Message } from "./ChatPanel";
import { useEpics, useRoadmapStore } from "@/stores/roadmapStore";
import type { RoadmapEpic, RoadmapFeature } from "@/types/roadmap";
import { useToast } from "@/hooks/useToast";
import {
	getSortedEpics,
	type ExplorerSearchResult,
	ROADMAP_STRUCTURE_EXPLORER_CONFIG,
	RoadmapStructureHeader,
} from "./explorer/RoadmapStructureHeader";
import { FeatureReorderConfirmModal } from "./FeatureReorderConfirmModal";
import { EpicReorderConfirmModal } from "./EpicReorderConfirmModal";

export type { Message } from "./ChatPanel";

interface RoadmapLeftSidePanelProps {
	messages: Message[];
	onSendMessage: (message: string) => void;
	isGenerating?: boolean;
	isCollapsed?: boolean;
	onSelectEpic?: (epicId: string) => void;
	onSelectFeature?: (epicId: string, featureId: string) => void;
	onSelectTask?: (taskId: string) => void;
	onOpenEpicEditor?: (epicId: string) => void;
	onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
	onOpenTaskDetail?: (taskId: string) => void;
	onNavigateToNode?: (nodeId: string, options?: { offsetX?: number }) => void;
	onNavigateToEpicTab?: (epicId: string) => void;
	highlightedEpicId?: string | null;
}

const TASK_NAVIGATE_OFFSET_X = 620;
const FEATURE_REORDER_CONFIRM_SKIP_KEY =
	"roadmap.leftPanel.skipFeatureReorderConfirm";
const EPIC_REORDER_CONFIRM_SKIP_KEY = "roadmap.leftPanel.skipEpicReorderConfirm";

type PendingFeatureReorder = {
	epicId: string;
	featureId: string;
	featureTitle: string;
	oldIndex: number;
	newIndex: number;
	previousOrderIds: string[];
	nextOrderIds: string[];
};

type PendingEpicReorder = {
	epicTitle: string;
	previousOrderIds: string[];
	nextOrderIds: string[];
};

type SortableEpicRowProps = {
	epicId: string;
	canDrag: boolean;
	children: (args: {
		setNodeRef: (node: HTMLElement | null) => void;
		style: {
			transform?: string;
			transition?: string;
			opacity: number;
		};
		handleAttributes: any;
		handleListeners: any;
	}) => ReactNode;
};

function SortableEpicRow({ epicId, canDrag, children }: SortableEpicRowProps) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: epicId });

	return children({
		setNodeRef,
		style: {
			transform: CSS.Transform.toString(transform),
			transition,
			opacity: isDragging ? 0.7 : 1,
		},
		handleAttributes: canDrag ? attributes : {},
		handleListeners: canDrag ? listeners : {},
	});
}

type SortableFeatureRowProps = {
	feature: RoadmapFeature;
	epic: RoadmapEpic;
	canDrag: boolean;
	isFeatureExpanded: boolean;
	canCollapseFeature: boolean;
	taskCount: number;
	onToggleFeature: (featureId: string) => void;
	onSelectFeature?: (epicId: string, featureId: string) => void;
	onNavigateToNode?: (nodeId: string, options?: { offsetX?: number }) => void;
	onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
	onOpenAddTaskPanel: (featureId: string) => void;
	runAfterNavigationDelay: (callback: () => void) => void;
};

function SortableFeatureRow({
	feature,
	epic,
	canDrag,
	isFeatureExpanded,
	canCollapseFeature,
	taskCount,
	onToggleFeature,
	onSelectFeature,
	onNavigateToNode,
	onOpenFeatureEditor,
	onOpenAddTaskPanel,
	runAfterNavigationDelay,
}: SortableFeatureRowProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: feature.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.7 : 1,
	};

	return (
		<div ref={setNodeRef} style={style} className="min-w-0">
			<div className="group relative h-11 w-full min-w-0 flex items-center gap-1.5 px-2.5 pr-10 text-sm text-gray-700 hover:bg-white hover:shadow-sm rounded-md transition-all border border-transparent hover:border-gray-200">
				<div
					{...(canDrag ? attributes : {})}
					{...(canDrag ? listeners : {})}
					onClick={(event) => event.stopPropagation()}
					className={`inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-gray-400 ${
						canDrag
							? "cursor-grab hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
							: "cursor-default opacity-50"
					}`}
					title="Drag to reorder feature"
					aria-label={`Drag to reorder ${feature.title}`}
				>
					<GripVertical className="h-3.5 w-3.5" />
				</div>
				{canCollapseFeature ? (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onToggleFeature(feature.id);
						}}
						className="p-0.5 hover:bg-black/5 rounded cursor-pointer"
						aria-label={isFeatureExpanded ? "Collapse feature" : "Expand feature"}
					>
						<ChevronRight
							className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
								isFeatureExpanded ? "rotate-90" : ""
							}`}
						/>
					</button>
				) : (
					<div className="w-2 h-2 rounded-full bg-gray-300 ml-0.5 mr-0.5" />
				)}
				<span
					onClick={() => {
						onSelectFeature?.(epic.id, feature.id);
						onNavigateToNode?.(feature.id);
					}}
					onDoubleClick={() => {
						runAfterNavigationDelay(() => {
							onOpenFeatureEditor?.(epic.id, feature.id);
						});
					}}
					className="truncate flex-1 min-w-0 text-left hover:text-primary transition-colors cursor-pointer"
					title={feature.title}
				>
					{feature.title}
				</span>
				{taskCount > 0 && (
					<span className="text-xs font-normal text-gray-500">{taskCount}</span>
				)}
				<button
					type="button"
					onClick={() => onOpenAddTaskPanel(feature.id)}
					className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-6 h-6 text-gray-700 bg-white border border-gray-200 rounded hover:bg-gray-50 hover:border-primary hover:text-primary shadow-sm"
					title="Add task to feature"
				>
					<Plus className="w-3 h-3" />
				</button>
			</div>
		</div>
			);
		}

export function RoadmapLeftSidePanel({
	messages: _messages,
	onSendMessage: _onSendMessage,
	isGenerating: _isGenerating = false,
	isCollapsed = false,
	onSelectEpic,
	onSelectFeature,
	onSelectTask,
	onOpenEpicEditor,
	onOpenFeatureEditor,
	onOpenTaskDetail,
	onNavigateToNode,
	onNavigateToEpicTab,
	highlightedEpicId,
}: RoadmapLeftSidePanelProps) {
	return (
		<div className="h-full w-full flex bg-white">
			{/* Main Content Area - Hidden when collapsed */}
			{!isCollapsed && (
				<div className="flex-1 min-w-0 flex flex-col overflow-hidden">
					<ExplorerPanel
						onSelectEpic={onSelectEpic}
						onSelectFeature={onSelectFeature}
						onSelectTask={onSelectTask}
						onOpenEpicEditor={onOpenEpicEditor}
						onOpenFeatureEditor={onOpenFeatureEditor}
						onOpenTaskDetail={onOpenTaskDetail}
						onNavigateToNode={onNavigateToNode}
						onNavigateToEpicTab={onNavigateToEpicTab}
						highlightedEpicId={highlightedEpicId}
					/>
				</div>
			)}
		</div>
	);
}

interface ExplorerPanelProps {
	onSelectEpic?: (epicId: string) => void;
	onSelectFeature?: (epicId: string, featureId: string) => void;
	onSelectTask?: (taskId: string) => void;
	onOpenEpicEditor?: (epicId: string) => void;
	onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
	onOpenTaskDetail?: (taskId: string) => void;
	onNavigateToNode?: (nodeId: string, options?: { offsetX?: number }) => void;
	onNavigateToEpicTab?: (epicId: string) => void;
	highlightedEpicId?: string | null;
}

function ExplorerPanel({
	onSelectEpic,
	onSelectFeature,
	onSelectTask,
	onOpenEpicEditor,
	onOpenFeatureEditor,
	onOpenTaskDetail,
	onNavigateToNode,
	onNavigateToEpicTab,
	highlightedEpicId,
}: ExplorerPanelProps) {
	const NAVIGATION_OPEN_DELAY_MS = 700;
	const toast = useToast();

	// Subscribe to epics from store
	const epics = useEpics();
	const roadmap = useRoadmapStore((state) => state.roadmap);
	const {
		openAddFeatureModal,
		openAddTaskPanel,
		reorderFeaturesInEpic,
		previewFeatureOrderInEpic,
		reorderEpicsInRoadmap,
		previewEpicOrderInRoadmap,
	} = useRoadmapStore();
	const explorerConfig = ROADMAP_STRUCTURE_EXPLORER_CONFIG.roadmap;
	const delayedOpenTimeouts = useRef<number[]>([]);
	const hasInitializedEpicExpansion = useRef(false);
	const previousCollapsableEpicIds = useRef<Set<string>>(new Set());
	const previousCollapsableFeatureIds = useRef<Set<string>>(new Set());
	const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());
	const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(
		new Set(),
	);
	const [pendingFeatureReorder, setPendingFeatureReorder] =
		useState<PendingFeatureReorder | null>(null);
	const [pendingEpicReorder, setPendingEpicReorder] =
		useState<PendingEpicReorder | null>(null);
	const [isPersistingFeatureReorder, setIsPersistingFeatureReorder] =
		useState(false);
	const [isPersistingEpicReorder, setIsPersistingEpicReorder] = useState(false);
	const [dontAskFeatureReorderAgainInSession, setDontAskFeatureReorderAgainInSession] =
		useState(false);
	const [dontAskEpicReorderAgainInSession, setDontAskEpicReorderAgainInSession] =
		useState(false);
	const currentUserRole = roadmap?.currentUserRole;
	const canEditRoadmap =
		!currentUserRole ||
		currentUserRole === "owner" ||
		currentUserRole === "editor";
	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const runAfterNavigationDelay = (callback: () => void) => {
		const timeoutId = window.setTimeout(() => {
			callback();
			delayedOpenTimeouts.current = delayedOpenTimeouts.current.filter(
				(id) => id !== timeoutId,
			);
		}, NAVIGATION_OPEN_DELAY_MS);
		delayedOpenTimeouts.current.push(timeoutId);
	};

	useEffect(() => {
		return () => {
			delayedOpenTimeouts.current.forEach((timeoutId) => {
				window.clearTimeout(timeoutId);
			});
			delayedOpenTimeouts.current = [];
		};
	}, []);

	const getTaskTextClasses = (status?: string) => {
		switch (status) {
			case "done":
				return "text-gray-400 line-through";
			case "in_progress":
				return "text-blue-600";
			case "in_review":
				return "text-orange-600";
			case "blocked":
				return "text-red-600";
			case "todo":
			default:
				return "text-gray-600";
		}
	};

	const getTaskDotClasses = (status?: string) => {
		switch (status) {
			case "done":
				return "bg-gray-400";
			case "in_progress":
				return "bg-blue-500";
			case "in_review":
				return "bg-orange-500";
			case "blocked":
				return "bg-red-500";
			case "todo":
			default:
				return "bg-gray-400";
		}
	};

	const handleSearchResultClick = (result: ExplorerSearchResult) => {
		if (result.type === "epic") {
			setExpandedEpics((prev) => new Set(prev).add(result.id));
			onSelectEpic?.(result.id);
			onNavigateToNode?.(result.id);
		} else if (result.type === "feature" && result.epicId) {
			setExpandedEpics((prev) => new Set(prev).add(result.epicId));
			if (result.id) {
				setExpandedFeatures((prev) => new Set(prev).add(result.id));
			}
			onSelectFeature?.(result.epicId, result.id);
			onNavigateToNode?.(result.id);
		} else if (result.type === "task") {
			const featureId = result.featureId;
			if (result.epicId) {
				setExpandedEpics((prev) => new Set(prev).add(result.epicId));
			}
			if (featureId) {
				setExpandedFeatures((prev) => new Set(prev).add(featureId));
			}
			onSelectTask?.(result.id);
			if (featureId) {
				onNavigateToNode?.(featureId, {
					offsetX: TASK_NAVIGATE_OFFSET_X,
				});
			}
		}
	};

	const sortedEpics = getSortedEpics(epics);
	const collapsableEpicIds = sortedEpics
		.filter((epic) => (epic.features?.length || 0) > 0)
		.map((epic) => epic.id);
	const collapsableFeatureIds =
		explorerConfig.allowFeatureCollapse && explorerConfig.showTaskRows
			? sortedEpics.flatMap((epic) =>
					(epic.features || [])
						.filter((feature) => (feature.tasks?.length || 0) > 0)
						.map((feature) => feature.id),
				)
			: [];

	useEffect(() => {
		const collapsableEpicIdSet = new Set(collapsableEpicIds);
		setExpandedEpics((prev) => {
			const next = new Set(
				[...prev].filter((epicId) => collapsableEpicIdSet.has(epicId)),
			);

			if (!hasInitializedEpicExpansion.current) {
				collapsableEpicIds.forEach((epicId) => {
					next.add(epicId);
				});
				hasInitializedEpicExpansion.current = true;
			} else {
				collapsableEpicIds.forEach((epicId) => {
					if (!previousCollapsableEpicIds.current.has(epicId)) {
						next.add(epicId);
					}
				});
			}

			return next;
		});
		previousCollapsableEpicIds.current = collapsableEpicIdSet;
	}, [collapsableEpicIds]);

	useEffect(() => {
		const collapsableFeatureIdSet = new Set(collapsableFeatureIds);
		setExpandedFeatures((prev) => {
			const next = new Set(
				[...prev].filter((featureId) => collapsableFeatureIdSet.has(featureId)),
			);
			collapsableFeatureIds.forEach((featureId) => {
				if (!previousCollapsableFeatureIds.current.has(featureId)) {
					next.add(featureId);
				}
			});
			return next;
		});
		previousCollapsableFeatureIds.current = collapsableFeatureIdSet;
	}, [collapsableFeatureIds]);

	const toggleEpic = (epicId: string) => {
		setExpandedEpics((prev) => {
			const next = new Set(prev);
			if (next.has(epicId)) {
				next.delete(epicId);
			} else {
				next.add(epicId);
			}
			return next;
		});
	};

	const hasAnyExpanded =
		collapsableEpicIds.some((id) => expandedEpics.has(id)) ||
		(explorerConfig.allowFeatureCollapse &&
			collapsableFeatureIds.some((id) => expandedFeatures.has(id)));

	const handleToggleCollapseAll = () => {
		if (hasAnyExpanded) {
			setExpandedEpics(new Set());
			setExpandedFeatures(new Set());
			return;
		}
		setExpandedEpics(new Set(collapsableEpicIds));
		if (explorerConfig.allowFeatureCollapse) {
			setExpandedFeatures(new Set(collapsableFeatureIds));
		}
	};

	const handleResetToDefaultCollapse = () => {
		setExpandedEpics(new Set(collapsableEpicIds));
		setExpandedFeatures(new Set());
	};

	const toggleFeature = (featureId: string) => {
		setExpandedFeatures((prev) => {
			const next = new Set(prev);
			if (next.has(featureId)) {
				next.delete(featureId);
			} else {
				next.add(featureId);
			}
			return next;
		});
	};

	const shouldSkipFeatureReorderConfirm = () => {
		return (
			typeof window !== "undefined" &&
			window.sessionStorage.getItem(FEATURE_REORDER_CONFIRM_SKIP_KEY) === "1"
		);
	};

	const shouldSkipEpicReorderConfirm = () => {
		return (
			typeof window !== "undefined" &&
			window.sessionStorage.getItem(EPIC_REORDER_CONFIRM_SKIP_KEY) === "1"
		);
	};

	const persistFeatureReorder = async (change: PendingFeatureReorder) => {
		setIsPersistingFeatureReorder(true);
		try {
			await reorderFeaturesInEpic(change.epicId, change.nextOrderIds);
			toast.success(`Reordered "${change.featureTitle}"`);
		} catch {
			previewFeatureOrderInEpic(change.epicId, change.previousOrderIds);
		} finally {
			setIsPersistingFeatureReorder(false);
		}
	};

	const queueFeatureReorderFromDrag = (
		epic: RoadmapEpic,
		activeFeatureId: string,
		previousOrderIds: string[],
		nextOrderIds: string[],
		oldIndex: number,
		newIndex: number,
	) => {
		const feature = (epic.features ?? []).find((item) => item.id === activeFeatureId);
		if (!feature) return;

		previewFeatureOrderInEpic(epic.id, nextOrderIds);

		const change: PendingFeatureReorder = {
			epicId: epic.id,
			featureId: feature.id,
			featureTitle: feature.title,
			oldIndex,
			newIndex,
			previousOrderIds,
			nextOrderIds,
		};

		if (shouldSkipFeatureReorderConfirm()) {
			void persistFeatureReorder(change);
			return;
		}

		setDontAskFeatureReorderAgainInSession(false);
		setPendingFeatureReorder(change);
	};

	const handleFeatureDragEnd = (epic: RoadmapEpic, event: DragEndEvent) => {
		if (!canEditRoadmap) return;

		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const features = (epic.features ?? []).slice().sort((a, b) => a.position - b.position);
		const currentOrderIds = features.map((feature) => feature.id);
		const oldIndex = currentOrderIds.indexOf(active.id as string);
		const newIndex = currentOrderIds.indexOf(over.id as string);
		if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

		const nextOrderIds = arrayMove(currentOrderIds, oldIndex, newIndex);
		queueFeatureReorderFromDrag(
			epic,
			active.id as string,
			currentOrderIds,
			nextOrderIds,
			oldIndex,
			newIndex,
		);
	};

	const handleCancelFeatureReorder = () => {
		if (pendingFeatureReorder) {
			previewFeatureOrderInEpic(
				pendingFeatureReorder.epicId,
				pendingFeatureReorder.previousOrderIds,
			);
		}
		setPendingFeatureReorder(null);
		setDontAskFeatureReorderAgainInSession(false);
	};

	const handleConfirmFeatureReorder = async () => {
		if (!pendingFeatureReorder) return;
		if (dontAskFeatureReorderAgainInSession && typeof window !== "undefined") {
			window.sessionStorage.setItem(FEATURE_REORDER_CONFIRM_SKIP_KEY, "1");
		}
		const change = pendingFeatureReorder;
		setPendingFeatureReorder(null);
		setDontAskFeatureReorderAgainInSession(false);
		await persistFeatureReorder(change);
	};

	const persistEpicReorder = async (change: PendingEpicReorder) => {
		setIsPersistingEpicReorder(true);
		try {
			await reorderEpicsInRoadmap(change.nextOrderIds);
			toast.success(`Reordered epic "${change.epicTitle}"`);
		} catch {
			previewEpicOrderInRoadmap(change.previousOrderIds);
		} finally {
			setIsPersistingEpicReorder(false);
		}
	};

	const queueEpicReorderFromDrag = (
		activeEpicId: string,
		previousOrderIds: string[],
		nextOrderIds: string[],
	) => {
		const epic = sortedEpics.find((item) => item.id === activeEpicId);
		if (!epic) return;

		previewEpicOrderInRoadmap(nextOrderIds);
		const change: PendingEpicReorder = {
			epicTitle: epic.title,
			previousOrderIds,
			nextOrderIds,
		};

		if (shouldSkipEpicReorderConfirm()) {
			void persistEpicReorder(change);
			return;
		}

		setDontAskEpicReorderAgainInSession(false);
		setPendingEpicReorder(change);
	};

	const handleEpicDragEnd = (event: DragEndEvent) => {
		if (!canEditRoadmap) return;

		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const currentOrderIds = sortedEpics.map((epic) => epic.id);
		const oldIndex = currentOrderIds.indexOf(active.id as string);
		const newIndex = currentOrderIds.indexOf(over.id as string);
		if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

		const nextOrderIds = arrayMove(currentOrderIds, oldIndex, newIndex);
		queueEpicReorderFromDrag(
			active.id as string,
			currentOrderIds,
			nextOrderIds,
		);
	};

	const handleCancelEpicReorder = () => {
		if (pendingEpicReorder) {
			previewEpicOrderInRoadmap(pendingEpicReorder.previousOrderIds);
		}
		setPendingEpicReorder(null);
		setDontAskEpicReorderAgainInSession(false);
	};

	const handleConfirmEpicReorder = async () => {
		if (!pendingEpicReorder) return;
		if (dontAskEpicReorderAgainInSession && typeof window !== "undefined") {
			window.sessionStorage.setItem(EPIC_REORDER_CONFIRM_SKIP_KEY, "1");
		}
		const change = pendingEpicReorder;
		setPendingEpicReorder(null);
		setDontAskEpicReorderAgainInSession(false);
		await persistEpicReorder(change);
	};

	return (
		<div className="flex flex-col h-full min-w-0 overflow-hidden bg-white ">
			<RoadmapStructureHeader
				epics={sortedEpics}
				hasAnyExpanded={hasAnyExpanded}
				onToggleCollapseAll={handleToggleCollapseAll}
				onSearchResultSelect={handleSearchResultClick}
				footerContent={
					<button
						type="button"
						onClick={handleResetToDefaultCollapse}
						className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
						title="Reset to default collapse"
						aria-label="Reset to default collapse"
					>
						<RotateCcw className="w-3.5 h-3.5" />
					</button>
				}
			/>

			{/* Navigation Tree */}
			<div className="flex-1 overflow-y-auto px-3 pl-4 py-3 pt-2 hide-scrollbar">
				{sortedEpics.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full px-4 text-center">
						<div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
							<FolderOpen className="w-8 h-8 text-gray-400" />
						</div>
						<h3 className="text-sm font-semibold text-gray-900 mb-1">
							No roadmap structure yet
						</h3>
						<p className="text-xs text-gray-500 leading-relaxed">
							Your epics, features, and tasks will appear here once you start
							building your roadmap.
						</p>
					</div>
					) : (
						<div className="space-y-1">
							<DndContext
								sensors={sensors}
								collisionDetection={closestCenter}
								onDragEnd={handleEpicDragEnd}
							>
								<SortableContext
									items={sortedEpics.map((epic) => epic.id)}
									strategy={verticalListSortingStrategy}
								>
									{sortedEpics.map((epic) => {
										const features = (epic.features || []).sort(
											(a, b) => a.position - b.position,
										);
										const isEpicExpanded =
											features.length === 0 || expandedEpics.has(epic.id);
										const isEpicHighlighted = highlightedEpicId === epic.id;

										return (
											<SortableEpicRow
												key={epic.id}
												epicId={epic.id}
												canDrag={canEditRoadmap}
											>
												{({ setNodeRef, style, handleAttributes, handleListeners }) => (
													<div
														ref={(node) => setNodeRef(node)}
														style={style}
														className="min-w-0"
													>
														{/* Epic */}
														<div className="group relative flex items-center gap-1 min-w-0">
															<div
																className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 pr-12 text-sm font-medium rounded-lg transition-all border ${
																	isEpicHighlighted
																		? "text-primary bg-orange-50 border-orange-200 shadow-sm"
																		: "text-gray-900 bg-gray-50 border-gray-200 hover:bg-white hover:shadow-sm"
																}`}
															>
																<div
																	{...handleAttributes}
																	{...handleListeners}
																	onClick={(event) => event.stopPropagation()}
																	className={`inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-gray-400 ${
																		canEditRoadmap
																			? "cursor-grab hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
																			: "cursor-default opacity-50"
																	}`}
																	title="Drag to reorder epic"
																	aria-label={`Drag to reorder ${epic.title}`}
																>
																	<GripVertical className="h-3.5 w-3.5" />
																</div>
																{features.length > 0 ? (
																	<button
																		type="button"
																		onClick={(event) => {
																			event.stopPropagation();
																			toggleEpic(epic.id);
																		}}
																		className="p-0.5 hover:bg-black/5 rounded cursor-pointer"
																		aria-label={
																			isEpicExpanded ? "Collapse epic" : "Expand epic"
																		}
																	>
																		<ChevronRight
																			className={`w-4 h-4 transition-transform ${
																				isEpicHighlighted
																					? "text-primary"
																					: "text-gray-500"
																			} ${isEpicExpanded ? "rotate-90" : ""}`}
																		/>
																	</button>
																) : (
																	<div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
																)}
																<span
																	onClick={() => {
																		onSelectEpic?.(epic.id);
																		onNavigateToNode?.(epic.id);
																	}}
																	onDoubleClick={() => {
																		runAfterNavigationDelay(() => {
																			onOpenEpicEditor?.(epic.id);
																		});
																	}}
																	className="truncate flex-1 min-w-0 text-left hover:text-primary transition-colors cursor-pointer"
																	title={epic.title}
																>
																	{epic.title}
																</span>
																{features.length > 0 && (
																	<span className="text-xs font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
																		{features.length}
																	</span>
																)}
															</div>
															{/* Quick Add Feature Button - Absolutely positioned */}
															<button
																type="button"
																onClick={() => openAddFeatureModal(epic.id)}
																className="absolute right-10 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-7 h-7 text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:border-primary hover:text-primary shadow-sm"
																title="Add feature to epic"
															>
																<Plus className="w-3.5 h-3.5" />
															</button>
															<button
																type="button"
																onClick={() => onNavigateToEpicTab?.(epic.id)}
																className="shrink-0 inline-flex items-center gap-1 px-2 py-2 text-xs font-medium text-blue-700 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 transition-colors"
																title="Navigate to epic"
															>
																<ExternalLink className="w-3 h-3" />
															</button>
														</div>

														{/* Features */}
														{isEpicExpanded && features.length > 0 && (
															<div className="ml-6 mt-1.5 space-y-1 pl-3">
																<DndContext
																	sensors={sensors}
																	collisionDetection={closestCenter}
																	onDragEnd={(event) =>
																		handleFeatureDragEnd(epic, event)
																	}
																>
																	<SortableContext
																		items={features.map((feature) => feature.id)}
																		strategy={verticalListSortingStrategy}
																	>
																		{features.map((feature) => {
																			const isFeatureExpanded =
																				expandedFeatures.has(feature.id);
																			const tasks = (feature.tasks || []).sort(
																				(a, b) => a.position - b.position,
																			);
																			const canCollapseFeature =
																				explorerConfig.allowFeatureCollapse &&
																				explorerConfig.showTaskRows &&
																				tasks.length > 0;

																			return (
																				<div key={feature.id} className="min-w-0">
																					<SortableFeatureRow
																						feature={feature}
																						epic={epic}
																						canDrag={canEditRoadmap}
																						isFeatureExpanded={isFeatureExpanded}
																						canCollapseFeature={canCollapseFeature}
																						taskCount={tasks.length}
																						onToggleFeature={toggleFeature}
																						onSelectFeature={onSelectFeature}
																						onNavigateToNode={onNavigateToNode}
																						onOpenFeatureEditor={onOpenFeatureEditor}
																						onOpenAddTaskPanel={openAddTaskPanel}
																						runAfterNavigationDelay={
																							runAfterNavigationDelay
																						}
																					/>

																					{/* Tasks */}
																					{explorerConfig.showTaskRows &&
																						isFeatureExpanded &&
																						tasks.length > 0 && (
																							<div className="ml-5 mt-1 space-y-0.5 pl-2">
																								{tasks.map((task) => (
																									<button
																										key={task.id}
																										onClick={() => {
																											onSelectTask?.(task.id);
																											onNavigateToNode?.(
																												feature.id,
																												{
																													offsetX:
																														TASK_NAVIGATE_OFFSET_X,
																												},
																											);
																										}}
																										className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-white rounded transition-colors"
																									>
																										<div
																											className={`w-1.5 h-1.5 rounded-full ${getTaskDotClasses(task.status)}`}
																										/>
																										<span
																											onClick={(event) => {
																												event.stopPropagation();
																												onNavigateToNode?.(
																													feature.id,
																													{
																														offsetX:
																															TASK_NAVIGATE_OFFSET_X,
																													},
																												);
																											}}
																											onDoubleClick={(event) => {
																												event.stopPropagation();
																												runAfterNavigationDelay(
																													() => {
																														onOpenTaskDetail?.(
																															task.id,
																														);
																													},
																												);
																											}}
																											className={`truncate text-left flex-1 transition-colors hover:text-primary ${getTaskTextClasses(task.status)}`}
																											title="Focus in canvas"
																										>
																											{task.title}
																										</span>
																									</button>
																								))}
																							</div>
																						)}
																				</div>
																			);
																		})}
																	</SortableContext>
																</DndContext>
															</div>
														)}
													</div>
												)}
											</SortableEpicRow>
										);
									})}
								</SortableContext>
							</DndContext>
						</div>
					)}
			</div>

			<FeatureReorderConfirmModal
				isOpen={pendingFeatureReorder !== null}
				isSaving={isPersistingFeatureReorder}
				featureTitle={pendingFeatureReorder?.featureTitle ?? null}
				dontAskAgain={dontAskFeatureReorderAgainInSession}
				onDontAskAgainChange={setDontAskFeatureReorderAgainInSession}
				onCancel={handleCancelFeatureReorder}
				onConfirm={handleConfirmFeatureReorder}
			/>
			<EpicReorderConfirmModal
				isOpen={pendingEpicReorder !== null}
				isSaving={isPersistingEpicReorder}
				epicTitle={pendingEpicReorder?.epicTitle ?? null}
				dontAskAgain={dontAskEpicReorderAgainInSession}
				onDontAskAgainChange={setDontAskEpicReorderAgainInSession}
				onCancel={handleCancelEpicReorder}
				onConfirm={handleConfirmEpicReorder}
			/>
		</div>
	);
}
