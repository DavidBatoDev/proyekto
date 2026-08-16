import { useEffect, useRef } from "react";
import type { FlowNode, Point, Viewport } from "./types";

/**
 * Node dragging.
 *
 * The gesture writes the dragged element's transform DIRECTLY to the DOM and
 * reports the resulting position through `onNodeDrag`. It never sets React
 * state, so a drag costs zero renders per frame — the same reason panning is
 * fast. The consumer's own preview pass re-renders with the position we just
 * reported, so the declarative value and the imperative write agree and the
 * node never jumps.
 *
 * The reported position is ABSOLUTE canvas coordinates including the drag
 * delta, not a delta. Consumers compute ordering from it directly.
 */

/** Matches React Flow's `nodeDragThreshold` default, so short drags behave the same. */
const DRAG_THRESHOLD = 1;

export interface NodeDragCallbacks {
	onNodeDragStart?: (event: unknown, node: FlowNode) => void;
	onNodeDrag?: (event: unknown, node: FlowNode) => void;
	onNodeDragStop?: (event: unknown, node: FlowNode) => void;
}

export interface NodeDragOptions extends NodeDragCallbacks {
	containerRef: React.RefObject<HTMLDivElement | null>;
	/** Latest committed nodes. Read at gesture time, never captured. */
	nodesRef: React.RefObject<FlowNode[]>;
	getViewport: () => Viewport;
	enabled: boolean;
}

/** The node element a pointer event landed in, if any. */
function nodeElementFrom(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof Element)) return null;
	return target.closest<HTMLElement>(".flow__node");
}

function isSuppressed(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	// `.nodrag` opts a subtree out of node dragging — the canvas task rows use it
	// so their own controls stay clickable. Previously supplied by React Flow;
	// now this engine owns it.
	if (target.closest(".nodrag")) return true;
	return Boolean(
		target.closest("input,textarea,select,button,a,[contenteditable='true']"),
	);
}

export function useNodeDrag({
	containerRef,
	nodesRef,
	getViewport,
	enabled,
	onNodeDragStart,
	onNodeDrag,
	onNodeDragStop,
}: NodeDragOptions): void {
	// Everything the listeners need, read through a ref so they attach once.
	const optionsRef = useRef({
		nodesRef,
		getViewport,
		enabled,
		onNodeDragStart,
		onNodeDrag,
		onNodeDragStop,
	});
	optionsRef.current = {
		nodesRef,
		getViewport,
		enabled,
		onNodeDragStart,
		onNodeDrag,
		onNodeDragStop,
	};

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let element: HTMLElement | null = null;
		let nodeId: string | null = null;
		let pointerId: number | null = null;
		let pointerOrigin: Point = { x: 0, y: 0 };
		let nodeOrigin: Point = { x: 0, y: 0 };
		let dragging = false;
		let latest: Point = { x: 0, y: 0 };

		const nodeById = (id: string): FlowNode | undefined =>
			optionsRef.current.nodesRef.current?.find((node) => node.id === id);

		const writeTransform = (position: Point) => {
			if (element) {
				element.style.transform = `translate(${position.x}px, ${position.y}px)`;
			}
		};

		const reset = () => {
			element = null;
			nodeId = null;
			pointerId = null;
			dragging = false;
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (!optionsRef.current.enabled) return;
			if (event.button !== 0) return;
			if (isSuppressed(event.target)) return;

			const candidate = nodeElementFrom(event.target);
			const id = candidate?.dataset.id;
			if (!candidate || !id) return;

			const node = nodeById(id);
			if (!node) return;

			element = candidate;
			nodeId = id;
			pointerId = event.pointerId;
			pointerOrigin = { x: event.clientX, y: event.clientY };
			nodeOrigin = { x: node.position.x, y: node.position.y };
			latest = nodeOrigin;
			dragging = false;
		};

		const handlePointerMove = (event: PointerEvent) => {
			if (pointerId === null || event.pointerId !== pointerId) return;
			const id = nodeId;
			if (!id) return;

			const dx = event.clientX - pointerOrigin.x;
			const dy = event.clientY - pointerOrigin.y;

			if (!dragging) {
				if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
					return;
				}
				dragging = true;
				element?.classList.add("flow__node--dragging", "dragging");
				try {
					element?.setPointerCapture(event.pointerId);
				} catch {
					// jsdom and some webviews lack pointer capture; the drag still
					// tracks, it just stops if the pointer leaves the element.
				}
				const node = nodeById(id);
				if (node) optionsRef.current.onNodeDragStart?.(null, node);
			}

			// Dividing by zoom is what keeps the node under the cursor 1:1 at every
			// zoom level — without it the node drifts as soon as zoom leaves 1.
			const { zoom } = optionsRef.current.getViewport();
			latest = { x: nodeOrigin.x + dx / zoom, y: nodeOrigin.y + dy / zoom };

			writeTransform(latest);

			const node = nodeById(id);
			if (node) {
				optionsRef.current.onNodeDrag?.(null, { ...node, position: latest });
			}
		};

		const handlePointerUp = (event: PointerEvent) => {
			if (pointerId === null || event.pointerId !== pointerId) return;
			const id = nodeId;
			const wasDragging = dragging;
			const dropped = latest;
			const el = element;

			if (wasDragging) {
				el?.classList.remove("flow__node--dragging", "dragging");
				try {
					el?.releasePointerCapture(event.pointerId);
				} catch {
					// See above.
				}
			}

			reset();

			if (!wasDragging || !id) return;

			const node = nodeById(id);
			if (node) {
				optionsRef.current.onNodeDragStop?.(null, {
					...node,
					position: dropped,
				});
			}

			// Hand the element back to React.
			//
			// React only writes style properties whose VIRTUAL value changed, and it
			// never saw the imperative writes above. On a no-op drop — where the
			// consumer reverts to the pre-drag nodes and nothing re-renders — the
			// element would otherwise keep the dropped transform forever. Restoring
			// from the authoritative array closes that gap; when the consumer does
			// push new positions, the subsequent render overwrites this anyway.
			const settled = nodeById(id);
			if (settled && el) {
				el.style.transform = `translate(${settled.position.x}px, ${settled.position.y}px)`;
			}
		};

		container.addEventListener("pointerdown", handlePointerDown);
		container.addEventListener("pointermove", handlePointerMove);
		container.addEventListener("pointerup", handlePointerUp);
		container.addEventListener("pointercancel", handlePointerUp);

		return () => {
			container.removeEventListener("pointerdown", handlePointerDown);
			container.removeEventListener("pointermove", handlePointerMove);
			container.removeEventListener("pointerup", handlePointerUp);
			container.removeEventListener("pointercancel", handlePointerUp);
		};
	}, [containerRef]);
}
