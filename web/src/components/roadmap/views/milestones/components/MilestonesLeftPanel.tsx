import {
	ChevronDown,
	ChevronRight,
	ExternalLink,
	FolderOpen,
	GripVertical,
	Plus,
} from "lucide-react";
import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Tooltip } from "@mui/material";
import {
	DndContext,
	PointerSensor,
	closestCenter,
	type DragEndEvent,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode, RefObject } from "react";
import type { RoadmapEpic } from "@/types/roadmap";
import {
	type ExplorerSearchResult,
	RoadmapStructureHeader,
} from "../../../panels/explorer/RoadmapStructureHeader";
import {
	FIRST_EPIC_EXTRA_HEIGHT,
	LEFT_WIDTH,
	ROW_HEIGHT,
} from "../model/constants";

const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 600;
const PANEL_STORAGE_KEY = "roadmap.milestonesLeftPanel.width";

const clampWidth = (v: number) =>
	Math.min(Math.max(v, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH);

interface MilestonesLeftPanelProps {
	leftHeaderRef: RefObject<HTMLDivElement | null>;
	sortedEpics: RoadmapEpic[];
	collapsed: Set<string>;
	hasAnyExpanded: boolean;
	showCollapseToggle: boolean;
	onToggleEpic: (epicId: string) => void;
	onToggleCollapseAll: () => void;
	onSearchResultSelect: (result: ExplorerSearchResult) => void;
	setEpicRowRef: (epicId: string) => (node: HTMLDivElement | null) => void;
	setFeatureRowRef: (
		featureId: string,
	) => (node: HTMLDivElement | null) => void;
	onNavigateToEpic?: (epicId: string) => void;
	onAddFeature?: (epicId: string) => void;
	canReorderFeatures?: boolean;
	canReorderEpics?: boolean;
	onFeatureReorderDraft?: (change: {
		epicId: string;
		featureId: string;
		featureTitle: string;
		oldIndex: number;
		newIndex: number;
		previousOrderIds: string[];
		nextOrderIds: string[];
	}) => void;
	onEpicReorderDraft?: (change: {
		epicId: string;
		epicTitle: string;
		oldIndex: number;
		newIndex: number;
		previousOrderIds: string[];
		nextOrderIds: string[];
	}) => void;
}

type SortableMilestoneEpicRowProps = {
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

const SortableMilestoneEpicRow = ({
	epicId,
	canDrag,
	children,
}: SortableMilestoneEpicRowProps) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: epicId });

	return children({
		setNodeRef,
		style: {
			transform: CSS.Transform.toString(transform),
			transition,
			opacity: isDragging ? 0.72 : 1,
		},
		handleAttributes: canDrag ? attributes : {},
		handleListeners: canDrag ? listeners : {},
	});
};

type SortableMilestoneFeatureRowProps = {
	feature: NonNullable<RoadmapEpic["features"]>[number];
	taskCount: number;
	canDrag: boolean;
	onSetFeatureRowRef: (node: HTMLDivElement | null) => void;
};

const SortableMilestoneFeatureRow = ({
	feature,
	taskCount,
	canDrag,
	onSetFeatureRowRef,
}: SortableMilestoneFeatureRowProps) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: feature.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.72 : 1,
	};

	return (
		<div
			ref={(node) => {
				setNodeRef(node);
				onSetFeatureRowRef(node);
			}}
			className="relative bg-white pr-4 pl-8"
			style={{ ...style, height: ROW_HEIGHT }}
		>
			<div className="flex h-full w-full min-w-0 items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs text-gray-700 transition-all hover:border-gray-200 hover:bg-white hover:shadow-sm">
				<div
					{...(canDrag ? attributes : {})}
					{...(canDrag ? listeners : {})}
					onClick={(event) => event.stopPropagation()}
					className={`inline-flex h-5 w-4 shrink-0 items-center justify-center rounded text-gray-400 ${
						canDrag
							? "cursor-pointer hover:bg-gray-100 hover:text-gray-600"
							: "cursor-default opacity-50"
					}`}
					title="Drag to reorder feature"
					aria-label={`Drag to reorder ${feature.title}`}
				>
					<GripVertical className="h-3 w-3" />
				</div>
				<ChevronRight className="h-3 w-3 shrink-0 text-gray-400" />
				<Tooltip title={feature.title} enterDelay={600} placement="right" arrow>
					<span className="min-w-0 flex-1 truncate text-left">{feature.title}</span>
				</Tooltip>
				{taskCount > 0 && (
					<span className="pr-6 text-[10px] font-normal text-gray-500">{taskCount}</span>
				)}
			</div>
		</div>
	);
};

export const MilestonesLeftPanel = ({
	leftHeaderRef,
	sortedEpics,
	collapsed,
	hasAnyExpanded,
	showCollapseToggle,
	onToggleEpic,
	onToggleCollapseAll,
	onSearchResultSelect,
	setEpicRowRef,
	setFeatureRowRef,
	onNavigateToEpic,
	onAddFeature,
	canReorderFeatures = true,
	canReorderEpics = true,
	onFeatureReorderDraft,
	onEpicReorderDraft,
}: MilestonesLeftPanelProps) => {
	const sensors = useSensors(useSensor(PointerSensor));

	const [panelWidth, setPanelWidth] = useState(() => {
		try {
			const stored = window.localStorage.getItem(PANEL_STORAGE_KEY);
			return stored ? Number(stored) : LEFT_WIDTH;
		} catch {
			return LEFT_WIDTH;
		}
	});
	const panelRef = useRef<HTMLDivElement | null>(null);
	const panelWidthRef = useRef(panelWidth);
	const [isResizing, setIsResizing] = useState(false);

	const handleResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelWidthRef.current;

		setIsResizing(true);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		let latestWidth = startWidth;
		let pendingWidth = startWidth;
		let rafId: number | null = null;

		const flush = () => {
			rafId = null;
			latestWidth = pendingWidth;
			panelWidthRef.current = pendingWidth;
			if (panelRef.current) {
				panelRef.current.style.width = `${pendingWidth}px`;
			}
		};

		const onMouseMove = (e: MouseEvent) => {
			pendingWidth = clampWidth(startWidth + e.clientX - startX);
			if (rafId === null) rafId = window.requestAnimationFrame(flush);
		};

		const onMouseUp = () => {
			if (rafId !== null) { window.cancelAnimationFrame(rafId); flush(); }
			setIsResizing(false);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			setPanelWidth(latestWidth);
			panelWidthRef.current = latestWidth;
			try { window.localStorage.setItem(PANEL_STORAGE_KEY, String(latestWidth)); } catch {}
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

	const handleEpicDragEnd = (event: DragEndEvent) => {
		if (!canReorderEpics || !onEpicReorderDraft) return;
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const currentOrderIds = sortedEpics.map((epic) => epic.id);
		const oldIndex = currentOrderIds.indexOf(active.id as string);
		const newIndex = currentOrderIds.indexOf(over.id as string);
		if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

		const nextOrderIds = arrayMove(currentOrderIds, oldIndex, newIndex);
		const movedEpic = sortedEpics.find((epic) => epic.id === active.id);
		if (!movedEpic) return;

		onEpicReorderDraft({
			epicId: movedEpic.id,
			epicTitle: movedEpic.title,
			oldIndex,
			newIndex,
			previousOrderIds: currentOrderIds,
			nextOrderIds,
		});
	};

	const handleFeatureDragEnd = (
		epic: RoadmapEpic,
		features: NonNullable<RoadmapEpic["features"]>,
		event: DragEndEvent,
	) => {
		if (!canReorderFeatures || !onFeatureReorderDraft) return;
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const currentOrderIds = features.map((feature) => feature.id);
		const oldIndex = currentOrderIds.indexOf(active.id as string);
		const newIndex = currentOrderIds.indexOf(over.id as string);
		if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

		const nextOrderIds = arrayMove(currentOrderIds, oldIndex, newIndex);
		const movedFeature = features.find((item) => item.id === active.id);
		if (!movedFeature) return;

		onFeatureReorderDraft({
			epicId: epic.id,
			featureId: movedFeature.id,
			featureTitle: movedFeature.title,
			oldIndex,
			newIndex,
			previousOrderIds: currentOrderIds,
			nextOrderIds,
		});
	};

	return (
		<div
			ref={panelRef}
			className="relative shrink-0 border-r border-gray-200 bg-white flex flex-col"
			style={{ width: panelWidth, minWidth: PANEL_MIN_WIDTH }}
		>
			<div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
				<div ref={leftHeaderRef}>
					<RoadmapStructureHeader
						epics={sortedEpics}
						hasAnyExpanded={hasAnyExpanded}
						onToggleCollapseAll={onToggleCollapseAll}
						onSearchResultSelect={onSearchResultSelect}
						showCollapseToggle={showCollapseToggle}
						className="px-4 py-4 bg-white min-w-0"
					/>
				</div>
			</div>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleEpicDragEnd}
			>
				<SortableContext
					items={sortedEpics.map((epic) => epic.id)}
					strategy={verticalListSortingStrategy}
				>
					{sortedEpics.map((epic, epicIndex) => {
						const isCollapsed = collapsed.has(epic.id);
						const features = epic.features ?? [];
						const epicRowHeight =
							ROW_HEIGHT + (epicIndex === 0 ? FIRST_EPIC_EXTRA_HEIGHT : 0);

						return (
							<SortableMilestoneEpicRow
								key={`left-${epic.id}`}
								epicId={epic.id}
								canDrag={canReorderEpics}
							>
								{({ setNodeRef, style, handleAttributes, handleListeners }) => (
									<div
										ref={(node) => setNodeRef(node)}
										style={style}
										className="bg-white"
									>
										<div
											ref={setEpicRowRef(epic.id)}
											style={{ height: epicRowHeight }}
											className="group/epic bg-white px-3"
										>
											<div className="flex h-full min-w-0 items-center gap-1">
												<div className="relative flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 pr-10 text-xs font-semibold text-gray-900 transition-all hover:bg-white hover:shadow-sm">
													<div
														{...handleAttributes}
														{...handleListeners}
														onClick={(event) => event.stopPropagation()}
														className={`inline-flex h-5 w-4 shrink-0 items-center justify-center rounded text-gray-400 ${
															canReorderEpics
																? "cursor-pointer hover:bg-gray-100 hover:text-gray-600"
																: "cursor-default opacity-50"
														}`}
														title="Drag to reorder epic"
														aria-label={`Drag to reorder ${epic.title}`}
													>
														<GripVertical className="h-3 w-3" />
													</div>
													<button
														type="button"
														onClick={() => onToggleEpic(epic.id)}
														className="cursor-pointer rounded p-0.5 hover:bg-black/5"
														aria-label={
															isCollapsed ? "Expand epic" : "Collapse epic"
														}
													>
														{isCollapsed ? (
															<ChevronRight className="h-3.5 w-3.5 text-gray-500" />
														) : (
															<ChevronDown className="h-3.5 w-3.5 text-gray-500" />
														)}
													</button>
													<Tooltip title={epic.title} enterDelay={600} placement="right" arrow>
														<button
															type="button"
															onClick={() => onToggleEpic(epic.id)}
															className="min-w-0 flex-1 truncate text-left text-xs text-gray-900 font-semibold"
														>
															{epic.title}
														</button>
													</Tooltip>
													{features.length > 0 && (
														<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500">
															{features.length}
														</span>
													)}
													<button
														type="button"
														onClick={() => onAddFeature?.(epic.id)}
														className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 opacity-0 shadow-sm transition-all hover:border-orange-300 hover:text-orange-600 group-hover/epic:opacity-100"
														title="Add feature to epic"
														aria-label={`Add feature to ${epic.title}`}
													>
														<Plus className="h-3 w-3" />
													</button>
												</div>
												<button
													type="button"
													onClick={() => onNavigateToEpic?.(epic.id)}
													className="shrink-0 rounded-lg border border-gray-200 bg-white p-1.5 text-blue-700 transition-all hover:bg-blue-50"
													title="Navigate to epic"
													aria-label={`Navigate to ${epic.title}`}
												>
													<ExternalLink className="h-3 w-3" />
												</button>
											</div>
										</div>

										{!isCollapsed && (
											<div className="ml-5 border-l-2 border-gray-200">
												<DndContext
													sensors={sensors}
													collisionDetection={closestCenter}
													onDragEnd={(event) =>
														handleFeatureDragEnd(epic, features, event)
													}
												>
													<SortableContext
														items={features.map((feature) => feature.id)}
														strategy={verticalListSortingStrategy}
													>
														{features.map((feature) => (
															<SortableMilestoneFeatureRow
																key={`left-feature-${feature.id}`}
																feature={feature}
																taskCount={feature.tasks?.length ?? 0}
																canDrag={canReorderFeatures}
																onSetFeatureRowRef={setFeatureRowRef(feature.id)}
															/>
														))}
													</SortableContext>
												</DndContext>
											</div>
										)}
									</div>
								)}
							</SortableMilestoneEpicRow>
						);
					})}
				</SortableContext>
			</DndContext>
			{sortedEpics.length === 0 && (
				<div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
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
			)}

			{/* Resize handle */}
			<div
				className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-10 group/resizer"
				onMouseDown={handleResizeStart}
			>
				<div
					className={`absolute right-0 top-0 w-[3px] h-full rounded-full transition-colors ${
						isResizing ? "bg-orange-400" : "bg-transparent group-hover/resizer:bg-orange-300"
					}`}
				/>
			</div>
		</div>
	);
};
