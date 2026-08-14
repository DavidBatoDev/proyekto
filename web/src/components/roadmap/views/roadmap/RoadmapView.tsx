import { useQuery } from "@tanstack/react-query";
import {
	applyNodeChanges,
	Background,
	BackgroundVariant,
	type Edge,
	type Node,
	type NodeChange,
	type NodeTypes,
	ReactFlow,
	type ReactFlowInstance,
	useNodesInitialized,
} from "@xyflow/react";
import {
	type DragEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import "@xyflow/react/dist/style.css";
import { Loader2 } from "lucide-react";
import { CollaborationCursorsOverlay } from "@/components/roadmap/collaboration/CollaborationCursorsOverlay";
import { featureFlags } from "@/config/featureFlags";
import { useRecentAssignees } from "@/hooks/useRecentAssignees";
import type {
	CollaboratorInfo,
	RemoteCursor,
	RemoteDrag,
} from "@/hooks/useRoadmapCollaboration";
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
import { EpicWidget, type EpicWidgetData } from "../../widgets/EpicWidget";
import {
	FeatureWidget,
	type FeatureWidgetData,
} from "../../widgets/FeatureWidget";
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
	StructuralNodeData,
} from "./canvas/model/types";
import type { RoadmapPerformanceMode } from "./models/types";

function InitialCanvasReady({
	nodeCount,
	onReady,
}: {
	nodeCount: number;
	onReady: () => void;
}) {
	const nodesInitialized = useNodesInitialized({
		includeHiddenNodes: true,
	});

	useEffect(() => {
		if (nodeCount > 0 && !nodesInitialized) return;

		// Let React Flow commit its measured node bounds and initial viewport before
		// revealing the canvas. This prevents the empty/default-position flash seen
		// on the first visit while keeping later node updates immediate.
		const frameId = window.requestAnimationFrame(onReady);
		return () => window.cancelAnimationFrame(frameId);
	}, [nodeCount, nodesInitialized, onReady]);

	return null;
}

interface RoadmapViewProps {
	roadmap: Roadmap;
	epics: RoadmapEpic[];
	minZoom?: number;
	readOnly?: boolean;
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

export const RoadmapView = ({
	roadmap,
	epics,
	minZoom = 0.4,
	readOnly = false,
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
	const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
		Node<EpicWidgetData | FeatureWidgetData>,
		Edge
	> | null>(null);
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

	const nodeTypes: NodeTypes = useMemo(
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
		const epicNodes: Node<StructuralNodeData>[] = orderedEpics.map((epic) => ({
			id: epic.id,
			type: "epicWidget",
			data: {
				kind: "epic",
				epic,
			},
			position: { x: 0, y: 0 },
		}));

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

		const featureNodes: Node<StructuralNodeData>[] = allFeatures.map(
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

		const featureEdges: Edge[] = allFeatures.map((feature) => {
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

		const epicEdges: Edge[] = [];
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

		const { nodes: positionedNodes, edges: positionedEdges } =
			getLayoutedElements(allNodes, allEdges, orderedEpics);

		return {
			layoutedNodes: positionedNodes,
			edges: positionedEdges,
			maxTaskCount: derivedMaxTaskCount,
		};
		// layoutKey is a stable string that only changes when structure/positions
		// change — prevents full layout recalculation for task-content-only updates.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [layoutKey, edgeAnimationsEnabled]);

	// "Who is editing what": collapse the collaborator list into a node-id → editors
	// map. Keyed on a small signature so the node memo below only rebuilds when the
	// editing set actually changes — not on every unrelated presence/cursor update.
	const editorsSignature = useMemo(() => editingSignature(editors), [editors]);
	const editorsByNodeId = useMemo(() => {
		return buildEditorsByNodeId(editors);
		// editorsSignature is the meaningful change key (editors identity alone churns).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editorsSignature]);

	const nodes = useCanvasNodeData({
		layoutedNodes,
		epics,
		canEditRoadmap,
		performanceMode,
		runningTaskId,
		toolbarDraggingType,
		editorsByNodeId,
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
		if (!focusNodeId || !reactFlowInstance) {
			return;
		}

		const targetNode = reactFlowInstance.getNode(focusNodeId);
		if (!targetNode) {
			onFocusComplete?.();
			return;
		}

		const nodeWidth = Number(targetNode.width) || 500;
		const nodeHeight = Number(targetNode.height) || 220;
		const centerX = targetNode.position.x + nodeWidth / 2 + focusNodeOffsetX;
		const centerY = targetNode.position.y + nodeHeight / 2;

		const viewport = reactFlowInstance.getViewport?.();
		const nextZoom = viewport?.zoom ?? zoom;
		reactFlowInstance.setCenter(centerX, centerY, {
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
		reactFlowInstance,
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

	const onEdgesChange = useCallback(() => {
		// Handle edge changes if needed
	}, []);

	// --- Canvas drag helpers ---

	// Binds the pure `computeDragPreview` to this render's authoritative graph so
	// the local drag and the remote mirror stay on one code path. The pure
	// function lives at module scope (and is unit-tested); this only injects the
	// closure values it used to capture implicitly.
	const buildDragPreview = useCallback(
		(args: {
			ds: CanvasDragSubject;
			draggedPosition: { x: number; y: number };
			baseNodes: Node[];
			originalNodes: Node[];
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

	const onNodesChange = useCallback((changes: NodeChange[]) => {
		if (!workingNodesRef.current) return;
		const updated = applyNodeChanges(changes, workingNodesRef.current);
		workingNodesRef.current = updated;
		setWorkingNodes(updated);
	}, []);

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
			if (!reactFlowInstance) return;
			const dropPosition = reactFlowInstance.screenToFlowPosition({
				x: event.clientX,
				y: event.clientY,
			});
			if (!findEpicAtCanvasPoint(getHitTestNodes(), dropPosition)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
		},
		[getToolbarItemFromTransfer, reactFlowInstance, getHitTestNodes],
	);

	const handleCanvasDrop = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			const itemType = getToolbarItemFromTransfer(event);
			setToolbarDraggingType(null);
			if (itemType !== "epic" || !reactFlowInstance) return;
			event.preventDefault();
			const dropPosition = reactFlowInstance.screenToFlowPosition({
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
			reactFlowInstance,
			getHitTestNodes,
		],
	);

	return (
		<div
			className="w-full h-full bg-background text-foreground relative"
			// Stable hooks for e2e. These live on the shell rather than the renderer
			// so they are identical whichever canvas engine is mounted below.
			data-testid="roadmap-canvas"
			data-canvas-engine="react-flow"
			data-canvas-ready={isCanvasReady ? "true" : "false"}
			data-canvas-node-count={nodes.length}
			onDragOver={handleCanvasDragOver}
			onDrop={handleCanvasDrop}
			onPointerMove={(e) => {
				if (!reactFlowInstance || !onTrackCursor) return;
				// screenToFlowPosition expects client (page) coords — it handles
				// the container offset internally. Subtracting bounds here would be
				// a bug that shifts every remote cursor by the container's page position.
				const pos = reactFlowInstance.screenToFlowPosition({
					x: e.clientX,
					y: e.clientY,
				});
				onTrackCursor(pos.x, pos.y);
			}}
		>
			<ReactFlow
				className={`transition-opacity duration-150 ${
					isCanvasReady ? "opacity-100" : "opacity-0"
				}`}
				nodes={
					(workingNodes as Node<EpicWidgetData | FeatureWidgetData>[] | null) ??
					(remoteWorkingNodes as
						| Node<EpicWidgetData | FeatureWidgetData>[]
						| null) ??
					nodes
				}
				edges={workingEdges ?? remoteWorkingEdges ?? edges}
				nodeTypes={nodeTypes}
				// ReactFlow pauses viewport culling during a real drag (so the local
				// drag never flickers), but a remote collaborator's preview moves nodes
				// via the controlled `nodes` prop with no active drag — leaving culling
				// on makes epic/feature edges pop in and out as the reflow shifts their
				// bounding boxes. Pause culling while the remote preview is active.
				onlyRenderVisibleElements={!(remoteWorkingNodes && !workingNodes)}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeDragStart={onNodeDragStart}
				onNodeDrag={onNodeDrag}
				onNodeDragStop={onNodeDragStop}
				onMoveStart={() => {
					onPanStart?.();
				}}
				onMoveEnd={(_, viewport) => {
					setZoom(viewport.zoom);
					onPanEnd?.();
				}}
				onInit={(instance) => {
					setReactFlowInstance(instance);
					setZoom(instance.getZoom());
				}}
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
				panOnDrag={[0, 1, 2]}
				panOnScroll
				zoomOnScroll
				zoomOnPinch
				zoomOnDoubleClick={false}
				nodesDraggable={canEditRoadmap}
				defaultEdgeOptions={{
					type: "simplebezier",
				}}
			>
				<InitialCanvasReady
					nodeCount={nodes.length}
					onReady={handleCanvasReady}
				/>
				<Background
					variant={BackgroundVariant.Dots}
					bgColor="var(--background)"
					color="var(--canvas-dot)"
					gap={18}
					size={1.4}
				/>
				{featureFlags.realtimeCursors && (
					<CollaborationCursorsOverlay remoteCursors={remoteCursors} />
				)}
			</ReactFlow>

			<CanvasControls
				onZoomIn={() => reactFlowInstance?.zoomIn()}
				onZoomOut={() => reactFlowInstance?.zoomOut()}
				onFitView={() =>
					reactFlowInstance?.fitView({ padding: 0.12, maxZoom: DEFAULT_ZOOM })
				}
				zoomInDisabled={zoom >= MAX_ZOOM}
				zoomOutDisabled={zoom <= MIN_ZOOM}
			/>

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
