import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	clampZoom,
	constrainTransform,
	easeInOutCubic,
	scaleBy,
} from "./transform";
import type { Point, Size, TranslateExtent, Viewport } from "./types";

/**
 * Pan, zoom, wheel and touch, with zero React renders per frame.
 *
 * The viewport lives in a ref, not state. Handlers mutate a pending value and
 * schedule ONE animation frame, which writes `transform` straight to the pane
 * element. React only hears about it when the zoom level actually changes
 * (the shell renders a zoom badge), so a pure pan costs no renders at all —
 * matching the previous renderer, which only reported on gesture end.
 */

/** Movement in px before a pointer-down becomes a pan. Below this it is a click. */
const PAN_THRESHOLD = 2;
/** d3-zoom's wheel law, so trackpad feel matches what users have today. */
const WHEEL_ZOOM_DIVISOR = 500;
const BUTTON_ZOOM_FACTOR = 1.2;

export interface WheelDecision {
	kind: "ignore" | "zoom" | "pan";
	deltaX: number;
	deltaY: number;
}

/**
 * Pure wheel-intent resolution, extracted so it can be table-tested. Wheel
 * semantics differ across browser x OS x trackpad and are miserable to debug
 * from inside an event handler.
 */
export function decideWheel(event: {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}): WheelDecision {
	// Trackpad pinch arrives as ctrl+wheel in every browser, so this single
	// branch covers both "pinch to zoom" and "ctrl+scroll to zoom" with no
	// heuristics.
	if (event.ctrlKey || event.metaKey) {
		return { kind: "zoom", deltaX: event.deltaX, deltaY: event.deltaY };
	}
	// Line/page deltas need scaling to pixels before they mean anything.
	const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
	const deltaX = event.deltaX * scale;
	const deltaY = event.deltaY * scale;
	if (deltaX === 0 && deltaY === 0) return { kind: "ignore", deltaX, deltaY };
	// Shift+wheel is the conventional "scroll sideways".
	if (event.shiftKey && deltaX === 0) {
		return { kind: "pan", deltaX: deltaY, deltaY: 0 };
	}
	return { kind: "pan", deltaX, deltaY };
}

/** Elements that must never start a canvas pan when pressed. */
const INTERACTIVE_SELECTOR =
	"input,textarea,select,button,a,[contenteditable='true']";

function startsPan(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return true;
	// `.nodrag` is load-bearing: feature cards nest dnd-kit sortable task rows
	// with their own pointer sensors, and the drag handle is inside one. Without
	// this check two drag systems fight over the same pointer.
	if (target.closest(".nodrag")) return false;
	if (target.closest(INTERACTIVE_SELECTOR)) return false;
	return true;
}

function allowsWheel(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return true;
	// `.nowheel` marks scrollable regions inside nodes (the task list). Wheeling
	// there must scroll the list, not zoom the canvas.
	return !target.closest(".nowheel");
}

export interface PanZoomOptions {
	paneRef: React.RefObject<HTMLDivElement | null>;
	containerRef: React.RefObject<HTMLDivElement | null>;
	backgroundRef: React.RefObject<HTMLDivElement | null>;
	initialViewport: Viewport;
	minZoom: number;
	maxZoom: number;
	translateExtent: TranslateExtent;
	/** Called only when the zoom level changed, coalesced to once per frame. */
	onZoomChange: (viewport: Viewport) => void;
	/**
	 * Called after every committed frame, pan included.
	 *
	 * This exists so consumers can react to movement without running their own
	 * always-on animation frame loop — an idle canvas should schedule no frames
	 * at all, which matters on battery-powered devices.
	 */
	onCommit: (viewport: Viewport) => void;
	onPanStart: () => void;
	onPanEnd: () => void;
	/** Dot spacing in flow units, for the background parallax. */
	backgroundGap: number;
	/** Dot DIAMETER in px at zoom 1. */
	backgroundDotSize: number;
}

export interface PanZoomApi {
	getViewport: () => Viewport;
	setViewport: (viewport: Viewport) => void;
	/** Animated move; `duration` 0 applies instantly. Always resolves. */
	transitionTo: (viewport: Viewport, duration: number) => void;
	zoomIn: () => void;
	zoomOut: () => void;
	getContainerRect: () => DOMRect | null;
	getContainerSize: () => Size;
}

export function usePanZoom({
	paneRef,
	containerRef,
	backgroundRef,
	initialViewport,
	minZoom,
	maxZoom,
	translateExtent,
	onZoomChange,
	onCommit,
	onPanStart,
	onPanEnd,
	backgroundGap,
	backgroundDotSize,
}: PanZoomOptions): PanZoomApi {
	const viewportRef = useRef<Viewport>(initialViewport);
	const pendingRef = useRef<Viewport | null>(null);
	const frameRef = useRef(0);
	const tweenRef = useRef(0);

	// Options change identity every render; read them through a ref so the
	// native listeners below can be attached once and never rebound.
	const optionsRef = useRef({
		minZoom,
		maxZoom,
		translateExtent,
		onZoomChange,
		onCommit,
		onPanStart,
		onPanEnd,
		backgroundGap,
		backgroundDotSize,
	});
	optionsRef.current = {
		minZoom,
		maxZoom,
		translateExtent,
		onZoomChange,
		onCommit,
		onPanStart,
		onPanEnd,
		backgroundGap,
		backgroundDotSize,
	};

	/**
	 * Cached container rect.
	 *
	 * The consumer calls screenToCanvas on EVERY pointermove (cursor tracking),
	 * and an uncached getBoundingClientRect() there forces a layout flush 60x a
	 * second over the whole canvas subtree. Refreshed on the events that can
	 * actually move the container instead.
	 */
	const rectRef = useRef<DOMRect | null>(null);
	const refreshRect = useCallback(() => {
		rectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
	}, [containerRef]);

	const commit = useCallback(() => {
		frameRef.current = 0;
		const next = pendingRef.current;
		pendingRef.current = null;
		if (!next) return;

		const previous = viewportRef.current;
		viewportRef.current = next;

		const pane = paneRef.current;
		if (pane) {
			pane.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
		}

		// The dot grid lives outside the transformed pane so it never scales its
		// own DOM; instead it is offset and resized to fake the parallax. One
		// style write, versus re-rendering a pattern.
		const background = backgroundRef.current;
		if (background) {
			const gap = optionsRef.current.backgroundGap * next.zoom;
			// The dot must shrink with the canvas, otherwise zooming out packs
			// full-size dots closer together and the grid reads as heavy texture
			// rather than a subtle reference. `backgroundDotSize` is a DIAMETER
			// (matching how the previous renderer specified it), so halve it for
			// the gradient's radius.
			const radius = Math.max(
				(optionsRef.current.backgroundDotSize / 2) * next.zoom,
				0.5,
			);
			background.style.backgroundSize = `${gap}px ${gap}px`;
			background.style.backgroundPosition = `${next.x}px ${next.y}px`;
			background.style.backgroundImage = `radial-gradient(circle at ${radius}px ${radius}px, var(--flow-dot-color, #c8ccd4) ${radius}px, transparent 0)`;
		}

		if (previous.zoom !== next.zoom) {
			optionsRef.current.onZoomChange(next);
		}
		optionsRef.current.onCommit(next);
	}, [paneRef, backgroundRef]);

	const schedule = useCallback(
		(next: Viewport) => {
			pendingRef.current = next;
			if (frameRef.current === 0) {
				frameRef.current = requestAnimationFrame(commit);
			}
		},
		[commit],
	);

	const applyConstrained = useCallback(
		(next: Viewport) => {
			const container = containerRef.current;
			const size = {
				width: container?.clientWidth ?? 0,
				height: container?.clientHeight ?? 0,
			};
			schedule(
				size.width > 0 && size.height > 0
					? constrainTransform(next, size, optionsRef.current.translateExtent)
					: next,
			);
		},
		[containerRef, schedule],
	);

	const cancelTween = useCallback(() => {
		if (tweenRef.current) {
			cancelAnimationFrame(tweenRef.current);
			tweenRef.current = 0;
		}
	}, []);

	// ── gestures ────────────────────────────────────────────────────────────
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		refreshRect();

		const pointers = new Map<number, Point>();
		let panning = false;
		let armed = false;
		let origin: Point = { x: 0, y: 0 };
		let originViewport: Viewport = viewportRef.current;
		let pinchDistance = 0;

		const handlePointerDown = (event: PointerEvent) => {
			if (!startsPan(event.target)) return;
			cancelTween();
			refreshRect();
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				pinchDistance = Math.hypot(b.x - a.x, b.y - a.y);
				return;
			}
			if (pointers.size > 2) return;

			// Buttons 0, 1 and 2 all pan — right-drag panning is easy to lose.
			if (event.button > 2) return;
			armed = true;
			origin = { x: event.clientX, y: event.clientY };
			originViewport = viewportRef.current;
		};

		const handlePointerMove = (event: PointerEvent) => {
			if (!pointers.has(event.pointerId)) return;
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				const distance = Math.hypot(b.x - a.x, b.y - a.y);
				if (pinchDistance > 0 && distance > 0) {
					const rect = rectRef.current;
					const centre = {
						x: (a.x + b.x) / 2 - (rect?.left ?? 0),
						y: (a.y + b.y) / 2 - (rect?.top ?? 0),
					};
					applyConstrained(
						scaleBy(
							viewportRef.current,
							distance / pinchDistance,
							centre,
							optionsRef.current.minZoom,
							optionsRef.current.maxZoom,
						),
					);
				}
				pinchDistance = distance;
				return;
			}

			if (!armed) return;
			const dx = event.clientX - origin.x;
			const dy = event.clientY - origin.y;

			if (!panning) {
				// Below the threshold this is still a click. Emitting pan events
				// here would broadcast spurious gestures to collaborators.
				if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) {
					return;
				}
				panning = true;
				container.classList.add("flow--panning");
				try {
					container.setPointerCapture(event.pointerId);
				} catch {
					// jsdom and some embedded webviews lack pointer capture; panning
					// still works, it just stops tracking outside the element.
				}
				optionsRef.current.onPanStart();
			}

			applyConstrained({
				x: originViewport.x + dx,
				y: originViewport.y + dy,
				zoom: originViewport.zoom,
			});
		};

		const endPointer = (event: PointerEvent) => {
			pointers.delete(event.pointerId);
			if (pointers.size < 2) pinchDistance = 0;
			if (pointers.size > 0) return;

			armed = false;
			if (!panning) return;
			panning = false;
			container.classList.remove("flow--panning");
			try {
				container.releasePointerCapture(event.pointerId);
			} catch {
				// See above.
			}
			optionsRef.current.onPanEnd();
		};

		const handleWheel = (event: WheelEvent) => {
			if (!allowsWheel(event.target)) return;
			const decision = decideWheel(event);
			if (decision.kind === "ignore") return;

			// React's synthetic wheel handler may be passive in Chromium, which
			// makes preventDefault a no-op and lets the browser page-zoom instead.
			// Hence the native non-passive listener this lives on.
			event.preventDefault();
			cancelTween();

			const rect = rectRef.current;
			if (decision.kind === "zoom") {
				const pivot = {
					x: event.clientX - (rect?.left ?? 0),
					y: event.clientY - (rect?.top ?? 0),
				};
				const factor = 2 ** (-decision.deltaY / WHEEL_ZOOM_DIVISOR);
				applyConstrained(
					scaleBy(
						viewportRef.current,
						factor,
						pivot,
						optionsRef.current.minZoom,
						optionsRef.current.maxZoom,
					),
				);
				return;
			}

			const current = viewportRef.current;
			applyConstrained({
				x: current.x - decision.deltaX,
				y: current.y - decision.deltaY,
				zoom: current.zoom,
			});
		};

		container.addEventListener("pointerdown", handlePointerDown);
		container.addEventListener("pointermove", handlePointerMove);
		container.addEventListener("pointerup", endPointer);
		container.addEventListener("pointercancel", endPointer);
		container.addEventListener("wheel", handleWheel, { passive: false });
		window.addEventListener("resize", refreshRect);
		window.addEventListener("scroll", refreshRect, true);

		return () => {
			container.removeEventListener("pointerdown", handlePointerDown);
			container.removeEventListener("pointermove", handlePointerMove);
			container.removeEventListener("pointerup", endPointer);
			container.removeEventListener("pointercancel", endPointer);
			container.removeEventListener("wheel", handleWheel);
			window.removeEventListener("resize", refreshRect);
			window.removeEventListener("scroll", refreshRect, true);
			if (frameRef.current) {
				cancelAnimationFrame(frameRef.current);
				// Must reset, not just cancel. `schedule` treats a non-zero id as
				// "a frame is already pending" — leaving a cancelled id here means
				// the next schedule silently no-ops and the transform is never
				// written. StrictMode's mount/cleanup/mount hits this on every dev
				// page load.
				frameRef.current = 0;
			}
			cancelTween();
		};
	}, [containerRef, applyConstrained, cancelTween, refreshRect]);

	return useMemo<PanZoomApi>(
		() => ({
			getViewport: () => viewportRef.current,
			setViewport: (viewport) => {
				cancelTween();
				applyConstrained(viewport);
			},
			transitionTo: (target, duration) => {
				cancelTween();
				if (duration <= 0) {
					applyConstrained(target);
					return;
				}
				const from = viewportRef.current;
				const start = performance.now();
				const step = (now: number) => {
					const progress = Math.min((now - start) / duration, 1);
					const t = easeInOutCubic(progress);
					applyConstrained({
						x: from.x + (target.x - from.x) * t,
						y: from.y + (target.y - from.y) * t,
						zoom: from.zoom + (target.zoom - from.zoom) * t,
					});
					tweenRef.current = progress < 1 ? requestAnimationFrame(step) : 0;
				};
				tweenRef.current = requestAnimationFrame(step);
			},
			zoomIn: () => {
				cancelTween();
				const container = containerRef.current;
				const pivot = {
					x: (container?.clientWidth ?? 0) / 2,
					y: (container?.clientHeight ?? 0) / 2,
				};
				applyConstrained(
					scaleBy(
						viewportRef.current,
						BUTTON_ZOOM_FACTOR,
						pivot,
						optionsRef.current.minZoom,
						optionsRef.current.maxZoom,
					),
				);
			},
			zoomOut: () => {
				cancelTween();
				const container = containerRef.current;
				const pivot = {
					x: (container?.clientWidth ?? 0) / 2,
					y: (container?.clientHeight ?? 0) / 2,
				};
				applyConstrained(
					scaleBy(
						viewportRef.current,
						1 / BUTTON_ZOOM_FACTOR,
						pivot,
						optionsRef.current.minZoom,
						optionsRef.current.maxZoom,
					),
				);
			},
			getContainerRect: () => {
				if (!rectRef.current) refreshRect();
				return rectRef.current;
			},
			getContainerSize: () => ({
				width: containerRef.current?.clientWidth ?? 0,
				height: containerRef.current?.clientHeight ?? 0,
			}),
		}),
		[applyConstrained, cancelTween, containerRef, refreshRect],
	);
}

export { clampZoom };
