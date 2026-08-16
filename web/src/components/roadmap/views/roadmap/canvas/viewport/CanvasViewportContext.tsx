import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CanvasNode } from "../model/types";

export interface CanvasViewport {
	x: number;
	y: number;
	zoom: number;
}

export interface CanvasPoint {
	x: number;
	y: number;
}

/**
 * The imperative surface a canvas renderer must provide.
 *
 * Implemented by whichever engine is mounted; consumed by the chrome that sits
 * beside it (zoom controls, collaborator cursors, deep-link focus, the toolbar
 * drop hit-test). Keeping it this narrow is what lets those pieces stay
 * renderer-agnostic.
 */
export interface CanvasViewportApi {
	getViewport(): CanvasViewport;
	setCenter(
		x: number,
		y: number,
		opts?: { zoom?: number; duration?: number },
	): void;
	fitView(opts?: { padding?: number; maxZoom?: number }): void;
	zoomIn(): void;
	zoomOut(): void;
	/**
	 * CLIENT coordinates in, canvas coordinates out. The container offset is
	 * handled internally — callers must NOT subtract bounding-rect offsets
	 * themselves. Getting this wrong shifts every remote cursor by the
	 * container's page position, which is a bug this canvas has hit before.
	 */
	screenToCanvas(point: CanvasPoint): CanvasPoint;
	/** Canvas coordinates in, CLIENT coordinates out. Inverse of the above. */
	canvasToScreen(point: CanvasPoint): CanvasPoint;
	getNode(id: string): CanvasNode | undefined;
	getNodes(): CanvasNode[];
}

/** Used before a renderer registers, and after one unmounts. */
const IDENTITY_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

const NOOP_API: CanvasViewportApi = {
	getViewport: () => IDENTITY_VIEWPORT,
	setCenter: () => {},
	fitView: () => {},
	zoomIn: () => {},
	zoomOut: () => {},
	screenToCanvas: (p) => p,
	canvasToScreen: (p) => p,
	getNode: () => undefined,
	getNodes: () => [],
};

type RegisterFn = (api: CanvasViewportApi | null) => void;

const ViewportContext = createContext<CanvasViewportApi>(NOOP_API);
const RegisterContext = createContext<RegisterFn>(() => {});
const ReadyContext = createContext<boolean>(false);

/**
 * Owns the viewport port and hands it to everything under it.
 *
 * The provider — not the renderer — owns the object the consumers see, and that
 * object is built ONCE with `useMemo(..., [])` over a ref. That stability is
 * load-bearing rather than cosmetic: `CollaborationCursorsOverlay` runs a
 * requestAnimationFrame loop in an effect keyed on `[getViewport]`, so an
 * identity that changed per viewport update would tear down and rebuild the
 * loop every frame, resetting every cursor's easing state.
 *
 * It also inverts the direction of the dependency. The renderer is a child, so
 * it cannot provide context to its siblings; instead it *registers* its
 * imperative API upward and the chrome reads it from here.
 */
export function CanvasViewportProvider({ children }: { children: ReactNode }) {
	const apiRef = useRef<CanvasViewportApi | null>(null);
	// Reactive, unlike the ref, because effects need to *re-run* once a renderer
	// registers. Without it, chrome that mounts first (deep-link focus, the
	// toolbar drop hit-test) would run against the no-op API and treat "renderer
	// not ready yet" as "node does not exist". Flips at most twice per mount.
	const [isReady, setIsReady] = useState(false);

	const register = useMemo<RegisterFn>(
		() => (api) => {
			apiRef.current = api;
			setIsReady(api !== null);
		},
		[],
	);

	// Every method delegates through the ref, so the wrapper identity never
	// changes even as the renderer mounts, remounts, or swaps.
	const api = useMemo<CanvasViewportApi>(
		() => ({
			getViewport: () => (apiRef.current ?? NOOP_API).getViewport(),
			setCenter: (x, y, opts) =>
				(apiRef.current ?? NOOP_API).setCenter(x, y, opts),
			fitView: (opts) => (apiRef.current ?? NOOP_API).fitView(opts),
			zoomIn: () => (apiRef.current ?? NOOP_API).zoomIn(),
			zoomOut: () => (apiRef.current ?? NOOP_API).zoomOut(),
			screenToCanvas: (p) => (apiRef.current ?? NOOP_API).screenToCanvas(p),
			canvasToScreen: (p) => (apiRef.current ?? NOOP_API).canvasToScreen(p),
			getNode: (id) => (apiRef.current ?? NOOP_API).getNode(id),
			getNodes: () => (apiRef.current ?? NOOP_API).getNodes(),
		}),
		[],
	);

	return (
		<RegisterContext.Provider value={register}>
			<ReadyContext.Provider value={isReady}>
				<ViewportContext.Provider value={api}>
					{children}
				</ViewportContext.Provider>
			</ReadyContext.Provider>
		</RegisterContext.Provider>
	);
}

/**
 * Whether a renderer has registered its viewport API.
 *
 * Guard effects on this the way they used to guard on `if (!reactFlowInstance)`.
 * The port itself never throws when unregistered, but "no renderer yet" and
 * "the node genuinely is not there" are different answers and some callers
 * (deep-link focus) behave differently for each.
 */
export function useCanvasViewportReady(): boolean {
	return useContext(ReadyContext);
}

/**
 * The viewport port. Safe to call before a renderer has registered — it degrades
 * to no-ops and an identity transform rather than throwing, so chrome that
 * mounts first (or a jsdom test with no real renderer) does not need guards.
 */
export function useCanvasViewport(): CanvasViewportApi {
	return useContext(ViewportContext);
}

/** Renderers call this to publish their imperative API to the shell. */
export function useRegisterCanvasViewport(): RegisterFn {
	return useContext(RegisterContext);
}
