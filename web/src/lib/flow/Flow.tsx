import {
	type ComponentType,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import "./flow.css";
import { FlowEdges } from "./FlowEdges";
import { FlowNodeContext, type FlowNodeContextValue } from "./FlowNodeContext";
import { HandleRegistry } from "./handles";
import {
	getNodesBounds,
	getViewportForBounds,
	rectsIntersect,
	screenToFlow,
	viewportForCenter,
	visibleRect,
} from "./transform";
import type {
	FlowEdge,
	FlowNode,
	HandleRegistration,
	Point,
	TranslateExtent,
	Viewport,
} from "./types";
import { usePanZoom } from "./usePanZoom";

/**
 * The flow engine.
 *
 * Renders absolutely-positioned DOM nodes and an SVG edge layer inside a single
 * CSS-transformed pane, and drives pan/zoom without re-rendering React.
 *
 * This slice is READ-ONLY: it draws, pans and zooms. Node dragging, selection
 * and marquee are deliberately absent.
 */

/**
 * How far beyond the viewport to keep nodes fully live, in flow units. Roughly
 * one screen at default zoom, so ordinary panning re-uses already-laid-out
 * nodes instead of thrashing.
 */
const CULL_MARGIN = 800;
/** Re-evaluate the visible set only after this much movement, in flow units. */
const CULL_HYSTERESIS = 200;

export interface FlowApi {
	getViewport: () => Viewport;
	setViewport: (viewport: Viewport) => void;
	setCenter: (
		x: number,
		y: number,
		opts?: { zoom?: number; duration?: number },
	) => void;
	fitView: (opts?: { padding?: number; maxZoom?: number }) => void;
	zoomIn: () => void;
	zoomOut: () => void;
	screenToFlowPosition: (point: Point) => Point;
	flowToScreenPosition: (point: Point) => Point;
	getNode: (id: string) => FlowNode | undefined;
	getNodes: () => FlowNode[];
}

export interface FlowProps {
	nodes: FlowNode[];
	edges: FlowEdge[];
	nodeTypes: Record<string, ComponentType<any>>;
	className?: string;
	defaultViewport: Viewport;
	minZoom: number;
	maxZoom: number;
	fitView?: boolean;
	fitViewOptions?: { padding: number; maxZoom: number };
	translateExtent: TranslateExtent;
	/** Suspends culling — every node renders regardless of visibility. */
	pauseCulling?: boolean;
	backgroundGap?: number;
	/** Dot diameter in px at zoom 1. */
	backgroundDotSize?: number;
	onViewportChange?: (viewport: Viewport) => void;
	onPanStart?: () => void;
	onPanEnd?: () => void;
	/** Fires once the first real layout is committed. */
	onReady?: () => void;
	onApi?: (api: FlowApi) => void;
}

const NOOP = () => {};

interface FlowNodeViewProps {
	node: FlowNode;
	Component: ComponentType<any>;
	registry: HandleRegistry;
	onHandlesChanged: () => void;
	culled: boolean;
}

const FlowNodeView = memo(function FlowNodeView({
	node,
	Component,
	registry,
	onHandlesChanged,
	culled,
}: FlowNodeViewProps) {
	const orderRef = useRef(0);

	const context = useMemo<FlowNodeContextValue>(
		() => ({
			nodeId: node.id,
			nextHandleOrder: () => orderRef.current++,
			registerHandle: (registration: HandleRegistration) => {
				registry.register(node.id, registration);
				onHandlesChanged();
				return () => {
					registry.unregister(node.id, registration);
					onHandlesChanged();
				};
			},
		}),
		[node.id, registry, onHandlesChanged],
	);

	if (node.hidden) return null;

	return (
		<FlowNodeContext.Provider value={context}>
			<div
				// The legacy class is kept alongside the engine's own so the app's
				// existing node styling (cursor, the remote-drag outline and its
				// colour variable) applies unchanged under either renderer.
				className={`flow__node react-flow__node${
					culled ? " flow__node--culled" : ""
				}${node.className ? ` ${node.className}` : ""}`}
				data-id={node.id}
				style={{
					transform: `translate(${node.position.x}px, ${node.position.y}px)`,
					width: node.width,
					height: node.height,
					zIndex: node.zIndex,
					containIntrinsicSize:
						culled && node.width && node.height
							? `${node.width}px ${node.height}px`
							: undefined,
					...node.style,
				}}
			>
				<Component id={node.id} data={node.data} selected={false} />
			</div>
		</FlowNodeContext.Provider>
	);
});

export function Flow({
	nodes,
	edges,
	nodeTypes,
	className,
	defaultViewport,
	minZoom,
	maxZoom,
	fitView = false,
	fitViewOptions,
	translateExtent,
	pauseCulling = false,
	backgroundGap = 18,
	backgroundDotSize = 1.4,
	onViewportChange,
	onPanStart,
	onPanEnd,
	onReady,
	onApi,
}: FlowProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const paneRef = useRef<HTMLDivElement | null>(null);
	const backgroundRef = useRef<HTMLDivElement | null>(null);

	const registryRef = useRef<HandleRegistry | null>(null);
	if (registryRef.current === null) registryRef.current = new HandleRegistry();
	const registry = registryRef.current;

	// Handles register in layout effects, i.e. after this component commits.
	// Coalesce the resulting invalidations into a single extra render rather
	// than one per handle.
	const [handleVersion, setHandleVersion] = useState(0);
	const handleFlushRef = useRef(false);
	const onHandlesChanged = useCallback(() => {
		if (handleFlushRef.current) return;
		handleFlushRef.current = true;
		queueMicrotask(() => {
			handleFlushRef.current = false;
			setHandleVersion((version) => version + 1);
		});
	}, []);

	const nodesRef = useRef(nodes);
	nodesRef.current = nodes;
	const nodeMap = useMemo(() => {
		const map = new Map<string, FlowNode>();
		for (const node of nodes) map.set(node.id, node);
		return map;
	}, [nodes]);

	// Indirection through a ref because culling needs the pan/zoom API and
	// pan/zoom needs to notify culling — the cycle has to be broken somewhere.
	const cullRef = useRef<() => void>(NOOP);

	const panZoom = usePanZoom({
		paneRef,
		containerRef,
		backgroundRef,
		initialViewport: defaultViewport,
		minZoom,
		maxZoom,
		translateExtent,
		onZoomChange: onViewportChange ?? NOOP,
		onCommit: () => cullRef.current(),
		onPanStart: onPanStart ?? NOOP,
		onPanEnd: onPanEnd ?? NOOP,
		backgroundGap,
		backgroundDotSize,
	});

	// ── culling ─────────────────────────────────────────────────────────────
	const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null);
	const lastCullRef = useRef<Viewport | null>(null);

	const evaluateCulling = useCallback(() => {
		if (pauseCulling) {
			setVisibleIds(null);
			return;
		}
		const size = panZoom.getContainerSize();
		if (size.width === 0 || size.height === 0) return;

		const viewport = panZoom.getViewport();
		const last = lastCullRef.current;
		// Hysteresis: re-evaluating every frame would churn the visible set and
		// remount feature cards mid-pan, losing task-list scroll positions.
		if (
			last &&
			last.zoom === viewport.zoom &&
			Math.abs(last.x - viewport.x) < CULL_HYSTERESIS &&
			Math.abs(last.y - viewport.y) < CULL_HYSTERESIS
		) {
			return;
		}
		lastCullRef.current = viewport;

		const view = visibleRect(viewport, size, CULL_MARGIN);
		const next = new Set<string>();
		for (const node of nodesRef.current) {
			const rect = {
				x: node.position.x,
				y: node.position.y,
				width: node.width ?? 0,
				height: node.height ?? 0,
			};
			if (rectsIntersect(view, rect)) next.add(node.id);
		}
		setVisibleIds(next);
	}, [panZoom, pauseCulling]);

	cullRef.current = evaluateCulling;

	// Re-evaluate whenever the graph or the pause flag changes. Movement-driven
	// evaluation is wired through usePanZoom's onCommit rather than an always-on
	// animation frame, so an idle canvas schedules no work at all.
	useEffect(() => {
		evaluateCulling();
	}, [evaluateCulling]);

	// ── imperative API ──────────────────────────────────────────────────────
	const api = useMemo<FlowApi>(
		() => ({
			getViewport: panZoom.getViewport,
			setViewport: panZoom.setViewport,
			setCenter: (x, y, opts) => {
				const size = panZoom.getContainerSize();
				const zoom = opts?.zoom ?? panZoom.getViewport().zoom;
				panZoom.transitionTo(
					viewportForCenter({ x, y }, size, zoom),
					opts?.duration ?? 0,
				);
			},
			fitView: (opts) => {
				const size = panZoom.getContainerSize();
				const visible = nodesRef.current.filter((node) => !node.hidden);
				if (visible.length === 0 || size.width === 0) return;
				panZoom.setViewport(
					getViewportForBounds(
						getNodesBounds(visible),
						size.width,
						size.height,
						minZoom,
						opts?.maxZoom ?? fitViewOptions?.maxZoom ?? maxZoom,
						opts?.padding ?? fitViewOptions?.padding ?? 0,
					),
				);
			},
			zoomIn: panZoom.zoomIn,
			zoomOut: panZoom.zoomOut,
			screenToFlowPosition: (point) => {
				const rect = panZoom.getContainerRect();
				return screenToFlow(
					point,
					{ left: rect?.left ?? 0, top: rect?.top ?? 0 },
					panZoom.getViewport(),
				);
			},
			flowToScreenPosition: (point) => {
				const rect = panZoom.getContainerRect();
				const viewport = panZoom.getViewport();
				return {
					x: point.x * viewport.zoom + viewport.x + (rect?.left ?? 0),
					y: point.y * viewport.zoom + viewport.y + (rect?.top ?? 0),
				};
			},
			getNode: (id) => nodesRef.current.find((node) => node.id === id),
			getNodes: () => nodesRef.current,
		}),
		[panZoom, minZoom, maxZoom, fitViewOptions],
	);

	const apiRef = useRef(api);
	apiRef.current = api;

	useEffect(() => {
		onApi?.(api);
	}, [api, onApi]);

	// ── first paint ─────────────────────────────────────────────────────────
	const readyRef = useRef(false);
	useEffect(() => {
		if (readyRef.current) return;

		// Write the initial transform immediately so the first painted frame is
		// already at the right viewport rather than at the identity transform.
		if (fitView && nodes.length > 0) {
			apiRef.current.fitView(fitViewOptions);
		} else {
			panZoom.setViewport(defaultViewport);
		}

		// One frame of slack for the transform to land, mirroring the previous
		// renderer's ready gate so the shell's fade-in timing is unchanged.
		const frame = requestAnimationFrame(() => {
			readyRef.current = true;
			onReady?.();
		});
		return () => cancelAnimationFrame(frame);
	}, [
		fitView,
		fitViewOptions,
		nodes.length,
		defaultViewport,
		panZoom,
		onReady,
	]);

	return (
		<div
			ref={containerRef}
			className={className ? `flow ${className}` : "flow"}
			data-flow-root=""
		>
			<div ref={backgroundRef} className="flow__background" />
			<div ref={paneRef} className="flow__pane" data-flow-pane="">
				<FlowEdges
					nodes={nodeMap}
					edges={edges}
					registry={registry}
					handleVersion={handleVersion}
				/>
				<div className="flow__nodes">
					{nodes.map((node) => {
						const Component = nodeTypes[node.type ?? ""];
						if (!Component) return null;
						return (
							<FlowNodeView
								key={node.id}
								node={node}
								Component={Component}
								registry={registry}
								onHandlesChanged={onHandlesChanged}
								culled={visibleIds !== null && !visibleIds.has(node.id)}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}
