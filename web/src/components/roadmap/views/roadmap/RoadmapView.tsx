import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
	type DragEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { CollaborationCursorsOverlay } from "@/components/roadmap/collaboration/CollaborationCursorsOverlay";
import { featureFlags } from "@/config/featureFlags";
import { useRecentAssignees } from "@/hooks/useRecentAssignees";
import type {
	CollaboratorInfo,
	RemoteCursor,
	RemoteDrag,
} from "@/hooks/useRoadmapCollaboration";
import { useCommentSummaryByNodeId } from "@/hooks/useRoadmapCommentSummary";
import { teamTimeService } from "@/services/team-time.service";
import { useUser } from "@/stores/authStore";
import type {
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapTask,
} from "@/types/roadmap";
import { EpicReorderConfirmModal } from "../../panels/EpicReorderConfirmModal";
import { FeatureMoveConfirmModal } from "../../panels/FeatureMoveConfirmModal";
import { FeatureReorderConfirmModal } from "../../panels/FeatureReorderConfirmModal";
import { EpicWidget } from "../../widgets/EpicWidget";
import { FeatureWidget } from "../../widgets/FeatureWidget";
import { CanvasControls } from "./canvas/components/CanvasControls";
import { CanvasToolbarDock } from "./canvas/components/CanvasToolbarDock";
import { useCanvasDragReorder } from "./canvas/hooks/useCanvasDragReorder";
import { useCanvasNodeData } from "./canvas/hooks/useCanvasNodeData";
import { useRemoteDragMirror } from "./canvas/hooks/useRemoteDragMirror";
import { computeDragPreview } from "./canvas/model/dragPreview";
import { buildEditorsByNodeId, editingSignature } from "./canvas/model/editors";
import {
	computeExtraRightPadding,
	computeTranslateExtent,
} from "./canvas/model/extent";
import { findEpicAtCanvasPoint } from "./canvas/model/hitTest";
import { getLayoutedElements } from "./canvas/model/layout";
import {
	readToolbarItemFromTransfer,
	type ToolbarItemType,
	writeToolbarItemToTransfer,
} from "./canvas/model/toolbar";
import type {
	CanvasDragSubject,
	CanvasEdge,
	CanvasNode,
	StructuralNodeData,
} from "./canvas/model/types";
import { DomSvgRenderer } from "./canvas/renderers/DomSvgRenderer";
import type { CanvasRenderer } from "./canvas/renderers/types";
import {
	CanvasViewportProvider,
	useCanvasViewport,
	useCanvasViewportReady,
} from "./canvas/viewport/CanvasViewportContext";
import type { RoadmapPerformanceMode } from "./models/types";

interface RoadmapViewProps {
	roadmap: Roadmap;
	epics: RoadmapEpic[];
	minZoom?: number;
	readOnly?: boolean;
	/** Hides on-canvas chrome (zoom controls) for a clean presentation view. */
	presentationMode?: boolean;
	fitView?: boolean;
	remoteCursors?: RemoteCursor[];
	/** Collaborators present in the room; those with `editingNodeId` set render
	 * an "editing" badge on the matching epic/feature/task. */
	editors?: CollaboratorInfo[];
	onTrackCursor?: (x: number, y: number) => void;
	/** Active epic/feature drag by another collaborator (live preview). */
	remoteDrag?: RemoteDrag | null;
	onBroadcastNodeDragStart?: (p: {
		nodeId: string;
		type: "epic" | "feature";
		sourceEpicId?: string;
	}) => void;
	onBroadcastNodeDrag?: (p: {
		nodeId: string;
		type: "epic" | "feature";
		sourceEpicId?: string;
		x: number;
		y: number;
	}) => void;
	onBroadcastNodeDragEnd?: (nodeId: string, committed: boolean) => void;
	onPanStart?: () => void;
	onPanEnd?: () => void;
	onUpdateEpic: (epic: RoadmapEpic) => void;
	onDeleteEpic: (epicId: string) => void;
	onDuplicateEpic?: (epicId: string) => void;
	onUpdateFeature: (feature: RoadmapFeature) => void;
	onDeleteFeature: (featureId: string) => void;
	onDuplicateFeature?: (featureId: string) => void;
	onSelectFeature?: (feature: RoadmapFeature) => void;
	onSelectEpic?: (epicId: string) => void;
	onSelectTask?: (
		task: RoadmapTask,
		initialTab?: "details" | "comments",
	) => void;
	onAddEpicBelow?: (epicId: string) => void;
	onAddFeature?: (epicId: string) => void;
	onAddTask?: (featureId: string) => void;
	onEditFeature?: (epicId: string, featureId: string) => void;
	onNavigateToEpic?: (epicId: string) => void;
	onUpdateTask: (task: RoadmapTask) => void;
	focusNodeId?: string | null;
	focusNodeOffsetX?: number;
	focusTaskId?: string | null;
	onFocusComplete?: () => void;
	performanceMode?: RoadmapPerformanceMode;
}

/** The canvas renderer. One engine, imported directly. */
const Renderer: CanvasRenderer = DomSvgRenderer;

const RoadmapCanvasShell = ({
	roadmap,
	epics,
	minZoom = 0.4,
	readOnly = false,
	presentationMode = false,
	fitView = false,
	remoteCursors = [],
	editors,
	onTrackCursor,
	remoteDrag,
	onBroadcastNodeDragStart,
	onBroadcastNodeDrag,
	onBroadcastNodeDragEnd,
	onPanStart,
	onPanEnd,
	onUpdateEpic,
	onDeleteEpic,
	onDuplicateEpic,
	onUpdateFeature: _onUpdateFeature,
	onDeleteFeature,
	onDuplicateFeature,
	onSelectFeature,
	onSelectEpic,
	onSelectTask,
	onAddEpicBelow,
	onAddFeature,
	onAddTask,
	onEditFeature,
	onNavigateToEpic,
	onUpdateTask,
	focusNodeId,
	focusTaskId,
	onFocusComplete,
	focusNodeOffsetX = 0,
	performanceMode = "normal",
}: RoadmapViewProps) => {
	const user = useUser();
	const DEFAULT_ZOOM = 0.67;
	const [zoom, setZoom] = useState(DEFAULT_ZOOM);
	const [pulseNodeFocus, setPulseNodeFocus] = useState<{
		nodeId: string;
		token: number;
	} | null>(null);
	const [pulseTaskFocus, setPulseTaskFocus] = useState<{
		featureId: string;
		taskId: string;
		token: number;
	} | null>(null);
	// Real card sizes as measured by the renderer, fed back into layout so
	// spacing tracks actual content instead of the description-length estimate.
	const [measuredSizes, setMeasuredSizes] = useState<
		Map<string, { width: number; height: number }>
	>(new Map());
	const handleNodeSizesChange = useCallback(
		(sizes: Map<string, { width: number; height: number }>) => {
			setMeasuredSizes(sizes);
		},
		[],
	);
	// The renderer publishes its imperative API here; `viewportReady` stands in
	// for the old `if (!reactFlowInstance)` guards.
	const viewport = useCanvasViewport();
	const viewportReady = useCanvasViewportReady();
	const [readyRoadmapId, setReadyRoadmapId] = useState<string | null>(null);
	const isCanvasReady = readyRoadmapId === roadmap.id;
	const handleCanvasReady = useCallback(() => {
		setReadyRoadmapId(roadmap.id);
	}, [roadmap.id]);

	const DEFAULT_VIEWPORT_X = -50;
	const DEFAULT_VIEWPORT_Y = 0;
	const MAX_ZOOM = 1.5;
	const runningLogQuery = useQuery({
		queryKey: ["team-time", "running-log", user?.id ?? "anonymous"],
		queryFn: () => teamTimeService.getMyRunningLog(),
		enabled: Boolean(user?.id),
		// Fast 3s poll only while a timer runs (to highlight the active task);
		// lazy 30s heartbeat otherwise, and never poll a hidden tab.
		refetchInterval: (query) => (query.state.data ? 3_000 : 30_000),
		refetchIntervalInBackground: false,
		retry: 1,
	});
	const runningTaskId = runningLogQuery.data?.task_id ?? null;
	const MIN_ZOOM = minZoom;
	const isReducedMotion = performanceMode === "reducedMotion";
	const edgeAnimationsEnabled = !isReducedMotion;
	const [toolbarDraggingType, setToolbarDraggingType] =
		useState<ToolbarItemType | null>(null);

	const canEditRoadmap =
		!readOnly &&
		(!roadmap.currentUserRole ||
			roadmap.currentUserRole === "owner" ||
			roadmap.currentUserRole === "editor");

	const { avatars: assigneeAvatars } = useRecentAssignees(
		roadmap?.project_id ?? "",
	);

	const nodeComponents = useMemo(
		() => ({
			epicWidget: EpicWidget,
			featureWidget: FeatureWidget,
		}),
		[],
	);

	// Captures only the properties that affect node positions/heights.
	// Task status/title changes don't affect layout, so this key is stable
	// during those updates — preventing unnecessary full-canvas recalculations.
	const layoutKey = useMemo(
		() =>
			epics
				.map((e) =>
					[
						e.id,
						e.position,
						e.description?.length ?? 0,
						(e.features || [])
							.map(
								(f) =>
									`${f.id}:${f.position}:${f.description?.length ?? 0}:${(f.tasks || []).length}`,
							)
							.join(","),
					].join("|"),
				)
				.join(";"),
		[epics],
	);

	const { layoutedNodes, edges, maxTaskCount } = useMemo(() => {
		const orderedEpics = [...epics]
			.sort((a, b) => a.position - b.position)
			.map((epic) => ({
				...epic,
				features: [...(epic.features || [])]
					.sort((a, b) => a.position - b.position)
					.map((feature) => ({
						...feature,
						tasks: [...(feature.tasks || [])].sort(
							(a, b) => a.position - b.position,
						),
					})),
			}));

		let derivedMaxTaskCount = 0;
		const epicNodes: CanvasNode<StructuralNodeData>[] = orderedEpics.map(
			(epic) => ({
				id: epic.id,
				type: "epicWidget",
				data: {
					kind: "epic",
					epic,
				},
				position: { x: 0, y: 0 },
			}),
		);

		const allFeatures = orderedEpics.flatMap((epic) =>
			(epic.features || []).map((feature) => {
				const taskCount = feature.tasks?.length || 0;
				if (taskCount > derivedMaxTaskCount) {
					derivedMaxTaskCount = taskCount;
				}
				return {
					...feature,
					epic_id: epic.id,
				};
			}),
		);

		const featureNodes: CanvasNode<StructuralNodeData>[] = allFeatures.map(
			(feature) => ({
				id: feature.id,
				type: "featureWidget",
				data: {
					kind: "feature",
					feature,
				},
				position: { x: 0, y: 0 },
			}),
		);

		const allNodes = [...epicNodes, ...featureNodes];

		const featureEdges: CanvasEdge[] = allFeatures.map((feature) => {
			const derivedStatus = feature.status;
			return {
				id: `epic-feature-${feature.epic_id}-${feature.id}`,
				source: feature.epic_id,
				sourceHandle: "epic-right",
				target: feature.id,
				type: "simplebezier",
				animated: edgeAnimationsEnabled && derivedStatus === "in_progress",
				style: {
					stroke: "var(--canvas-edge)",
					strokeWidth: 1.75,
				},
			};
		});

		const epicEdges: CanvasEdge[] = [];
		for (let i = 0; i < orderedEpics.length - 1; i++) {
			epicEdges.push({
				id: `epic-chain-${orderedEpics[i].id}-${orderedEpics[i + 1].id}`,
				source: orderedEpics[i].id,
				sourceHandle: "epic-bottom",
				target: orderedEpics[i + 1].id,
				targetHandle: "epic-top",
				type: "simplebezier",
				animated: false,
				style: {
					stroke: "var(--canvas-edge)",
					strokeWidth: 4,
				},
			});
		}

		const allEdges = [...epicEdges, ...featureEdges];

		const measuredHeights = new Map(
			Array.from(measuredSizes, ([id, size]) => [id, size.height]),
		);
		const { nodes: positionedNodes, edges: positionedEdges } =
			getLayoutedElements(allNodes, allEdges, orderedEpics, measuredHeights);

		return {
			layoutedNodes: positionedNodes,
			edges: positionedEdges,
			maxTaskCount: derivedMaxTaskCount,
		};
		// layoutKey is a stable string that only changes when structure/positions
		// change — prevents full layout recalculation for task-content-only updates.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [layoutKey, edgeAnimationsEnabled, measuredSizes]);

	// "Who is editing what": collapse the collaborator list into a node-id → editors
	// map. Keyed on a small signature so the node memo below only rebuilds when the
	// editing set actually changes — not on every unrelated presence/cursor update.
	const editorsSignature = useMemo(() => editingSignature(editors), [editors]);
	const editorsByNodeId = useMemo(() => {
		return buildEditorsByNodeId(editors);
		// editorsSignature is the meaningful change key (editors identity alone churns).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editorsSignature]);

	// Comment badges read a sibling query rather than the epics tree. The hook
	// self-disables when the canvasCommentIndicators flag is off, so a dark
	// build issues no request and every widget just sees an empty map.
	const commentSummaryByNodeId = useCommentSummaryByNodeId(roadmap.id);

	const nodes = useCanvasNodeData({
		layoutedNodes,
		epics,
		canEditRoadmap,
		performanceMode,
		runningTaskId,
		toolbarDraggingType,
		editorsByNodeId,
		commentSummaryByNodeId,
		pulseNodeFocus,
		pulseTaskFocus,
		onUpdateEpic,
		onDeleteEpic,
		onDuplicateEpic,
		onDeleteFeature,
		onDuplicateFeature,
		onSelectFeature,
		onSelectEpic,
		onSelectTask,
		onAddEpicBelow,
		onAddFeature,
		onAddTask,
		onEditFeature,
		onNavigateToEpic,
		onUpdateTask,
	});

	useEffect(() => {
		if (!focusNodeId || !viewportReady) {
			return;
		}

		const targetNode = viewport.getNode(focusNodeId);
		if (!targetNode) {
			onFocusComplete?.();
			return;
		}

		const nodeWidth = Number(targetNode.width) || 500;
		const nodeHeight = Number(targetNode.height) || 220;
		const centerX = targetNode.position.x + nodeWidth / 2 + focusNodeOffsetX;
		const centerY = targetNode.position.y + nodeHeight / 2;

		const nextZoom = viewport.getViewport().zoom ?? zoom;
		viewport.setCenter(centerX, centerY, {
			zoom: nextZoom,
			duration: isReducedMotion ? 0 : 600,
		});

		setPulseNodeFocus((previous) => ({
			nodeId: focusNodeId,
			token:
				previous && previous.nodeId === focusNodeId ? previous.token + 1 : 1,
		}));

		if (focusTaskId) {
			setPulseTaskFocus((previous) => ({
				featureId: focusNodeId,
				taskId: focusTaskId,
				token:
					previous &&
					previous.featureId === focusNodeId &&
					previous.taskId === focusTaskId
						? previous.token + 1
						: 1,
			}));
		} else {
			setPulseTaskFocus(null);
		}

		onFocusComplete?.();
	}, [
		focusNodeId,
		focusNodeOffsetX,
		focusTaskId,
		isReducedMotion,
		onFocusComplete,
		viewport,
		viewportReady,
		zoom,
	]);

	const extraRightPadding = useMemo(
		() => computeExtraRightPadding(maxTaskCount),
		[maxTaskCount],
	);

	const translateExtent = useMemo(
		() => computeTranslateExtent(layoutedNodes, extraRightPadding),
		[extraRightPadding, layoutedNodes],
	);

	// --- Canvas drag helpers ---

	// Binds the pure `computeDragPreview` to this render's authoritative graph so
	// the local drag and the remote mirror stay on one code path. The pure
	// function lives at module scope (and is unit-tested); this only injects the
	// closure values it used to capture implicitly.
	const buildDragPreview = useCallback(
		(args: {
			ds: CanvasDragSubject;
			draggedPosition: { x: number; y: number };
			baseNodes: CanvasNode[];
			originalNodes: CanvasNode[];
			relativeYs: Map<string, number> | null;
		}) =>
			computeDragPreview({
				...args,
				epics,
				layoutedNodes,
				edges,
				edgeAnimationsEnabled,
			}),
		[epics, layoutedNodes, edges, edgeAnimationsEnabled],
	);

	const {
		workingNodes,
		workingEdges,
		workingNodesRef,
		setWorkingNodes,
		onNodeDragStart,
		onNodeDrag,
		onNodeDragStop,
		pendingCanvasDrag,
		isPersistingCanvasDrag,
		persistCanvasDrag,
		cancelPendingCanvasDrag,
		dontAskEpicReorder,
		dontAskFeatureReorder,
		dontAskFeatureMove,
		setCanvasConfirmSkip,
	} = useCanvasDragReorder({
		nodes,
		layoutedNodes,
		edges,
		epics,
		canEditRoadmap,
		buildDragPreview,
		onBroadcastNodeDragStart,
		onBroadcastNodeDrag,
		onBroadcastNodeDragEnd,
	});

	/**
	 * Read/write handle the renderer uses to apply its own node changes, keeping
	 * React Flow's NodeChange protocol out of the shell. Reading the REF rather
	 * than state is deliberate: it is written synchronously during a drag and the
	 * renderer needs the current frame within the same event cycle.
	 */
	const nodesController = useMemo(
		() => ({
			getNodes: () => workingNodesRef.current,
			setNodes: (next: CanvasNode[]) => {
				workingNodesRef.current = next;
				setWorkingNodes(next);
			},
		}),
		[workingNodesRef, setWorkingNodes],
	);

	const { remoteWorkingNodes, remoteWorkingEdges } = useRemoteDragMirror({
		remoteDrag,
		nodes,
		epics,
		layoutedNodes,
		edges,
		layoutKey,
		buildDragPreview,
	});

	const getToolbarItemFromTransfer = useCallback(
		(event: { dataTransfer: DataTransfer | null }) =>
			readToolbarItemFromTransfer(event, toolbarDraggingType),
		[toolbarDraggingType],
	);

	const handleToolbarDragStart = useCallback(
		(itemType: ToolbarItemType, event: DragEvent<HTMLElement>) => {
			writeToolbarItemToTransfer(event.dataTransfer, itemType);
			setToolbarDraggingType(itemType);
		},
		[],
	);

	const handleToolbarDragEnd = useCallback(() => {
		setToolbarDraggingType(null);
	}, []);

	/**
	 * Nodes to hit-test a toolbar drop against, mirroring exactly what the
	 * renderer currently has on screen (see the `nodes` prop below). This used to
	 * fall back to `reactFlowInstance.getNodes()`, which returned this same array
	 * by a longer route — reading it directly drops a renderer dependency from the
	 * drop path.
	 */
	// NOT memoised: `workingNodesRef` is written synchronously during a drag, so
	// the current frame's nodes must be read at call time. Caching this would
	// hit-test against pre-drag positions.
	const getHitTestNodes = useCallback(
		() => workingNodesRef.current ?? remoteWorkingNodes ?? nodes,
		[remoteWorkingNodes, nodes],
	);

	const handleCanvasDragOver = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			const itemType = getToolbarItemFromTransfer(event);
			if (itemType !== "epic") return;
			if (!viewportReady) return;
			const dropPosition = viewport.screenToCanvas({
				x: event.clientX,
				y: event.clientY,
			});
			if (!findEpicAtCanvasPoint(getHitTestNodes(), dropPosition)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
		},
		[getToolbarItemFromTransfer, viewport, viewportReady, getHitTestNodes],
	);

	const handleCanvasDrop = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			const itemType = getToolbarItemFromTransfer(event);
			setToolbarDraggingType(null);
			if (itemType !== "epic" || !viewportReady) return;
			event.preventDefault();
			const dropPosition = viewport.screenToCanvas({
				x: event.clientX,
				y: event.clientY,
			});
			const targetEpic = findEpicAtCanvasPoint(getHitTestNodes(), dropPosition);
			if (!targetEpic) return;
			onAddEpicBelow?.(targetEpic.id);
		},
		[
			getToolbarItemFromTransfer,
			onAddEpicBelow,
			viewport,
			viewportReady,
			getHitTestNodes,
		],
	);

	return (
		<div
			className="w-full h-full bg-background text-foreground relative"
			// Stable hooks for e2e. These live on the shell rather than the renderer
			// so they are identical whichever canvas engine is mounted below.
			data-testid="roadmap-canvas"
			data-canvas-engine="dom-svg"
			data-canvas-ready={isCanvasReady ? "true" : "false"}
			data-canvas-node-count={nodes.length}
			onDragOver={handleCanvasDragOver}
			onDrop={handleCanvasDrop}
			onPointerMove={(e) => {
				if (!viewportReady || !onTrackCursor) return;
				// screenToCanvas expects client (page) coords — it handles the
				// container offset internally. Subtracting bounds here would be a bug
				// that shifts every remote cursor by the container's page position.
				const pos = viewport.screenToCanvas({
					x: e.clientX,
					y: e.clientY,
				});
				onTrackCursor(pos.x, pos.y);
			}}
		>
			<Renderer
				className={`transition-opacity duration-150 ${
					isCanvasReady ? "opacity-100" : "opacity-0"
				}`}
				nodes={workingNodes ?? remoteWorkingNodes ?? nodes}
				edges={workingEdges ?? remoteWorkingEdges ?? edges}
				nodeComponents={nodeComponents}
				// A remote preview moves nodes through the controlled prop with no
				// active local drag; culling would pop edges as the reflow shifts
				// bounding boxes, so suspend it while that preview is up.
				pauseCulling={Boolean(remoteWorkingNodes && !workingNodes)}
				nodesController={nodesController}
				onNodeDragStart={onNodeDragStart}
				onNodeDrag={onNodeDrag}
				onNodeDragStop={onNodeDragStop}
				onViewportChange={(next) => setZoom(next.zoom)}
				onPanStart={() => onPanStart?.()}
				onPanEnd={() => onPanEnd?.()}
				onReady={handleCanvasReady}
				onNodeSizesChange={handleNodeSizesChange}
				defaultViewport={{
					x: DEFAULT_VIEWPORT_X,
					y: DEFAULT_VIEWPORT_Y,
					zoom: DEFAULT_ZOOM,
				}}
				minZoom={MIN_ZOOM}
				maxZoom={MAX_ZOOM}
				fitView={fitView}
				fitViewOptions={{ padding: 0.12, maxZoom: DEFAULT_ZOOM }}
				translateExtent={translateExtent}
				nodesDraggable={canEditRoadmap}
			/>

			{featureFlags.realtimeCursors && (
				<CollaborationCursorsOverlay remoteCursors={remoteCursors} />
			)}

			{!presentationMode && (
				<CanvasControls
					onZoomIn={() => viewport.zoomIn()}
					onZoomOut={() => viewport.zoomOut()}
					onFitView={() =>
						viewport.fitView({ padding: 0.12, maxZoom: DEFAULT_ZOOM })
					}
					zoomInDisabled={zoom >= MAX_ZOOM}
					zoomOutDisabled={zoom <= MIN_ZOOM}
				/>
			)}

			{!isCanvasReady && (
				<output
					className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background"
					aria-live="polite"
				>
					<div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm">
						<Loader2 className="h-4 w-4 animate-spin text-primary" />
						Preparing roadmap
					</div>
				</output>
			)}

			<EpicReorderConfirmModal
				isOpen={pendingCanvasDrag?.kind === "epicReorder"}
				isSaving={isPersistingCanvasDrag}
				epicTitle={
					pendingCanvasDrag?.kind === "epicReorder"
						? pendingCanvasDrag.epicTitle
						: null
				}
				dontAskAgain={dontAskEpicReorder}
				onDontAskAgainChange={(v) => setCanvasConfirmSkip("epicReorder", v)}
				onCancel={cancelPendingCanvasDrag}
				onConfirm={() => {
					if (pendingCanvasDrag) void persistCanvasDrag(pendingCanvasDrag);
				}}
			/>
			<FeatureReorderConfirmModal
				isOpen={pendingCanvasDrag?.kind === "featureReorder"}
				isSaving={isPersistingCanvasDrag}
				featureTitle={
					pendingCanvasDrag?.kind === "featureReorder"
						? pendingCanvasDrag.featureTitle
						: null
				}
				dontAskAgain={dontAskFeatureReorder}
				onDontAskAgainChange={(v) => setCanvasConfirmSkip("featureReorder", v)}
				onCancel={cancelPendingCanvasDrag}
				onConfirm={() => {
					if (pendingCanvasDrag) void persistCanvasDrag(pendingCanvasDrag);
				}}
			/>
			<FeatureMoveConfirmModal
				isOpen={pendingCanvasDrag?.kind === "featureMove"}
				isSaving={isPersistingCanvasDrag}
				featureTitle={
					pendingCanvasDrag?.kind === "featureMove"
						? pendingCanvasDrag.featureTitle
						: null
				}
				targetEpicTitle={
					pendingCanvasDrag?.kind === "featureMove"
						? pendingCanvasDrag.targetEpicTitle
						: null
				}
				dontAskAgain={dontAskFeatureMove}
				onDontAskAgainChange={(v) => setCanvasConfirmSkip("featureMove", v)}
				onCancel={cancelPendingCanvasDrag}
				onConfirm={() => {
					if (pendingCanvasDrag) void persistCanvasDrag(pendingCanvasDrag);
				}}
			/>

			<div className="absolute bottom-16 right-4 bg-white/90 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 shadow-sm">
				Zoom {Math.round(zoom * 100)}%
			</div>
			{canEditRoadmap && (
				<CanvasToolbarDock
					draggingType={toolbarDraggingType}
					onDragStart={handleToolbarDragStart}
					onDragEnd={handleToolbarDragEnd}
					assigneeAvatars={assigneeAvatars}
				/>
			)}
		</div>
	);
};

/**
 * Public entry point for the roadmap canvas.
 *
 * Thin on purpose: it owns the viewport provider and picks the renderer, so the
 * shell below can *consume* the port (a component cannot read a context it
 * provides in the same render). When the DOM+SVG engine lands, this is the only
 * place that changes.
 */
export const RoadmapView = (props: RoadmapViewProps) => (
	<CanvasViewportProvider>
		<RoadmapCanvasShell {...props} />
	</CanvasViewportProvider>
);
